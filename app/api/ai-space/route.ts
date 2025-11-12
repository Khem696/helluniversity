import { NextResponse } from "next/server"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"

// Helper function to convert image path to full URL
function getImageUrl(imagePath: string): string {
  // If it's already a full URL, return as is
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath
  }
  
  // Get base URL from environment or use localhost for development
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
  
  // Normalize the path
  const normalizedPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`
  
  return `${baseUrl}${basePath}${normalizedPath}`
}

// Helper function to convert image URL to base64 (for BFL API)
// BFL API accepts base64 encoded image without data URI prefix, or image URL
async function imageUrlToBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url)
    const buffer = await response.arrayBuffer()
    // BFL API expects base64 without data URI prefix
    const base64 = Buffer.from(buffer).toString('base64')
    return base64
  } catch (error) {
    console.error(`Failed to convert image to base64: ${url}`, error)
    throw new Error(`Failed to process image: ${url}`)
  }
}

// Helper function to make BFL API requests with proper error handling and retry logic
// Implements recommendations from: https://docs.bfl.ai/api_integration/integration_guidelines#best-practices
// API Documentation: https://docs.bfl.ai/kontext/kontext_image_editing#flux-1-kontext-image-editing-parameters
async function makeBFLRequest(
  url: string,
  apiKey: string,
  requestBody: any,
  batchNumber: number,
  maxRetries: number = 3
): Promise<{ success: boolean; data?: any; error?: string; status?: number; details?: any }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-key": apiKey, // BFL API uses x-key header, not Authorization Bearer
          "accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })

      // Handle rate limiting (429) with exponential backoff
      if (response.status === 429) {
        const waitTime = Math.pow(2, attempt) // Exponential backoff: 1s, 2s, 4s
        console.warn(`Rate limit exceeded (batch ${batchNumber}), retrying in ${waitTime}s (attempt ${attempt + 1}/${maxRetries})`)
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
        continue
      }

      // Handle insufficient credits (402)
      if (response.status === 402) {
        return {
          success: false,
          error: "Insufficient credits. Please add credits to your account.",
          status: 402,
        }
      }

      // Handle other errors
      if (!response.ok) {
        const errorText = await response.text()
        let errorData: any = {}
        
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = { message: errorText || response.statusText }
        }
        
        console.error(`BlackForest Lab API error (batch ${batchNumber}):`, {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
          url: url,
          attempt: attempt + 1,
        })
        
        return {
          success: false,
          error: errorData.error?.message || errorData.message || response.statusText,
          status: response.status,
          details: errorData,
        }
      }

      // Success - parse response
      const responseText = await response.text()
      let data: any = {}
      
      try {
        data = JSON.parse(responseText)
      } catch (error) {
        console.error(`Failed to parse API response as JSON (batch ${batchNumber}):`, responseText)
        return {
          success: false,
          error: `Invalid response format from AI service`,
          status: 500,
        }
      }

      // Check if response contains polling_url (for async requests)
      // Per BFL docs: Initial response contains id and polling_url
      // https://docs.bfl.ai/kontext/kontext_image_editing#create-request
      if (data.polling_url && data.id) {
        // Handle async polling - poll until status is "Ready"
        return await pollForResult(data.polling_url, apiKey, batchNumber)
      }

      // If no polling_url, assume synchronous response (shouldn't happen with BFL API)
      return { success: true, data }
      
    } catch (error) {
      if (attempt === maxRetries - 1) {
        console.error(`Request failed after ${maxRetries} attempts (batch ${batchNumber}):`, error)
        return {
          success: false,
          error: error instanceof Error ? error.message : "Network error occurred",
          status: 500,
        }
      }
      
      // Wait before retry
      const waitTime = Math.pow(2, attempt)
      await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries} attempts`,
    status: 500,
  }
}

// Helper function to poll for async results using polling_url
// Required when using api.bfl.ai endpoint per: https://docs.bfl.ai/api_integration/integration_guidelines#polling-url-usage
async function pollForResult(
  pollingUrl: string,
  apiKey: string,
  batchNumber: number,
  maxAttempts: number = 120, // Increased to 60 seconds max (0.5s intervals) for image generation
  pollInterval: number = 500 // 500ms between polls
): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(pollingUrl, {
        method: "GET",
        headers: {
          "x-key": apiKey, // BFL API uses x-key header, not Authorization Bearer
          "accept": "application/json",
        },
        // Prevent caching issues
        cache: 'no-store',
      })

      if (!response.ok) {
        // Don't fail immediately on non-OK status, might be temporary
        if (response.status >= 500 && attempt < maxAttempts - 1) {
          // Server error, wait and retry
          await new Promise(resolve => setTimeout(resolve, pollInterval))
          continue
        }
        return {
          success: false,
          error: `Polling failed: ${response.statusText}`,
          status: response.status,
        }
      }

      const result = await response.json()

      if (result.status === 'Ready') {
        return { success: true, data: result }
      } else if (result.status === 'Error' || result.status === 'Failed') {
        return {
          success: false,
          error: result.error || result.message || 'Generation failed',
          status: 500,
        }
      }

      // Still processing, wait and retry
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      
    } catch (error) {
      // Handle network errors more gracefully
      if (error instanceof Error) {
        // If it's a network error and we haven't reached max attempts, retry
        if (error.message.includes('fetch') && attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, pollInterval))
          continue
        }
      }
      
      if (attempt === maxAttempts - 1) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Polling error occurred",
          status: 500,
        }
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }
  }

  return {
    success: false,
    error: "Polling timeout - request took too long",
    status: 408,
  }
}

// Custom prompts for each event type
// Optimized for Flux 1 Kontext to preserve original image and add event-themed decorations
const EVENT_TYPE_PROMPTS: Record<string, string> = {
  "Arts & Design Coaching": "Preserve the original image structure and layout completely. Add decorative elements on top of the existing space for an Arts & Design Coaching Workshop: artistic wall decorations, creative design posters, color palette displays, inspirational art pieces, and design tools arranged as decorative accents on furniture and table. Maintain all original architectural features, furniture positions, and room structure. Only overlay event-themed decorations that complement the existing space without altering the base image.",
  "Seminar & Workshop": "Preserve the original image structure and layout completely. Add decorative elements on top of the existing space for a Seminar & Workshop: professional presentation materials, workshop banners, educational posters, seminar signage, and organized learning materials as decorative accents. Maintain all original architectural features, furniture positions, and room structure. Only overlay event-themed decorations that complement the existing space without altering the base image.",
  "Family Gathering": "Preserve the original image structure and layout completely. Add decorative elements on top of the existing space for a Family Gathering: warm family photos, cozy decorative pillows, festive table settings, family celebration banners, and welcoming home decorations. Maintain all original architectural features, furniture positions, and room structure. Only overlay event-themed decorations that complement the existing space without altering the base image.",
  "Holiday Festive": "Preserve the original image structure and layout completely. Add decorative elements on top of the existing space for a Holiday Festive event: holiday-themed decorations, festive garlands, seasonal ornaments, holiday lighting accents, and celebratory banners. Maintain all original architectural features, furniture positions, and room structure. Only overlay event-themed decorations that complement the existing space without altering the base image.",
}

export async function POST(request: Request) {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, '/api/ai-space')
    
    await logger.info('AI space generation request received')
    
    const body = await request.json()
    const { token, eventType } = body
    
    await logger.debug('AI space generation parameters', { hasToken: !!token, eventType })

    // Validate reCAPTCHA token
    if (!token) {
      await logger.warn('AI space generation rejected: missing reCAPTCHA token')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "reCAPTCHA token is required",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate inputs
    if (!eventType) {
      await logger.warn('AI space generation rejected: missing event type')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Event type is required",
        undefined,
        400,
        { requestId }
      )
    }

    // Validate event type
    if (!EVENT_TYPE_PROMPTS[eventType]) {
      await logger.warn('AI space generation rejected: invalid event type', { eventType })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid event type",
        undefined,
        400,
        { requestId }
      )
    }

    const secretKey = process.env.RECAPTCHA_SECRET_KEY

    if (!secretKey) {
      await logger.error('RECAPTCHA_SECRET_KEY is not set', new Error('RECAPTCHA_SECRET_KEY is not set'))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Server configuration error",
        undefined,
        500,
        { requestId }
      )
    }

    // Get client IP address for verification
    const forwarded = request.headers.get("x-forwarded-for")
    const realIP = request.headers.get("x-real-ip")
    const cfConnectingIP = request.headers.get("cf-connecting-ip") // Cloudflare
    let remoteip: string | null = null

    if (forwarded) {
      remoteip = forwarded.split(",")[0].trim()
    } else if (realIP) {
      remoteip = realIP
    } else if (cfConnectingIP) {
      remoteip = cfConnectingIP
    }

    // Verify token with Google reCAPTCHA API
    const params = new URLSearchParams()
    params.append("secret", secretKey)
    params.append("response", token)
    if (remoteip) {
      params.append("remoteip", remoteip)
    }

    const recaptchaResponse = await fetch(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    )

    // Check if HTTP response is OK
    if (!recaptchaResponse.ok) {
      const errorText = await recaptchaResponse.text()
      await logger.error('reCAPTCHA API HTTP error', new Error(`HTTP ${recaptchaResponse.status}: ${recaptchaResponse.statusText}`), {
        status: recaptchaResponse.status,
        statusText: recaptchaResponse.statusText
      })
      return errorResponse(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        "reCAPTCHA verification service error",
        `HTTP ${recaptchaResponse.status}: ${recaptchaResponse.statusText}`,
        500,
        { requestId }
      )
    }

    // Parse JSON response
    let recaptchaData: any
    try {
      recaptchaData = await recaptchaResponse.json()
    } catch (jsonError) {
      await logger.error('Failed to parse reCAPTCHA response', jsonError instanceof Error ? jsonError : new Error(String(jsonError)))
      return errorResponse(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        "Invalid response from verification service",
        undefined,
        500,
        { requestId }
      )
    }

    // Validate response structure and success field
    if (!recaptchaData || typeof recaptchaData.success !== "boolean") {
      await logger.error('Invalid reCAPTCHA response structure', new Error('Invalid response structure'))
      return errorResponse(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        "Invalid verification response",
        undefined,
        500,
        { requestId }
      )
    }

    // Check if verification was successful
    if (!recaptchaData.success) {
      await logger.warn('reCAPTCHA verification failed', {
        errorCodes: recaptchaData["error-codes"] || []
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "reCAPTCHA verification failed",
        undefined,
        400,
        { requestId },
        { "error-codes": recaptchaData["error-codes"] || [] }
      )
    }
    
    await logger.info('reCAPTCHA verification successful')

    // Rate limiting check (uses IP + User-Agent fingerprint for better device tracking)
    // Device fingerprint combines IP + User-Agent + Accept-Language + Accept-Encoding
    // This provides similar functionality to MAC address tracking but using available HTTP headers
    const { checkRateLimit, getRateLimitIdentifier } = await import("@/lib/rate-limit")
    const identifier = getRateLimitIdentifier(request) // Uses env var or defaults to fingerprint
    const rateLimitResult = await checkRateLimit(identifier, "ai-space")

    if (!rateLimitResult.success) {
      await logger.warn('AI space generation rejected: rate limit exceeded', {
        limit: rateLimitResult.limit,
        remaining: rateLimitResult.remaining,
        reset: rateLimitResult.reset
      })
      const response = errorResponse(
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        "Rate limit exceeded. Please try again later.",
        {
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
          reset: rateLimitResult.reset,
        },
        429,
        { requestId }
      )
      // Add rate limit headers
      response.headers.set("X-RateLimit-Limit", rateLimitResult.limit.toString())
      response.headers.set("X-RateLimit-Remaining", rateLimitResult.remaining.toString())
      response.headers.set("X-RateLimit-Reset", rateLimitResult.reset.toString())
      response.headers.set("Retry-After", (rateLimitResult.reset - Math.floor(Date.now() / 1000)).toString())
      return response
    }

    // Check for BlackForest Lab API key
    const apiKey = process.env.PROVIDER_API_KEY

    if (!apiKey) {
      await logger.error('PROVIDER_API_KEY is not set', new Error('PROVIDER_API_KEY is not set'))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "AI service is not configured. Please contact administrator.",
        undefined,
        500,
        { requestId }
      )
    }

    // Get database client
    const { getTursoClient } = await import("@/lib/turso")
    const db = getTursoClient()

    // Get custom prompt for the event type
    const prompt = EVENT_TYPE_PROMPTS[eventType]

    // Get studio images (aispace_studio category) for generation
    // Admin controls which images are used by selecting them (ai_selected = 1)
    // Only selected images will be used, ordered by ai_order (admin selection order)
    const studioImagesResult = await db.execute({
      sql: `
        SELECT blob_url
        FROM images
        WHERE category = 'aispace_studio' AND ai_selected = 1
        ORDER BY ai_order ASC, display_order ASC, created_at ASC
      `,
      args: [],
    })
    
    if (studioImagesResult.rows.length === 0) {
      await logger.warn('AI space generation rejected: no studio images selected')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "No studio images selected for AI generation. Please select images in the admin panel.",
        undefined,
        400,
        { requestId }
      )
    }

    const selectedImages = studioImagesResult.rows.map((row: any) => row.blob_url)
    
    await logger.info('Studio images selected for AI generation', {
      count: selectedImages.length,
      eventType
    })

    // Convert image URLs (they're already blob URLs, so just ensure they're valid)
    const imageUrls = selectedImages.map((url: string) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url
      }
      return getImageUrl(url)
    })

    await logger.info('Starting AI image generation', {
      imageCount: selectedImages.length,
      eventType
    })

    // Use primary global endpoint per BFL documentation: https://docs.bfl.ai/api_integration/integration_guidelines
    // API Reference: https://docs.bfl.ai/kontext/kontext_image_editing#flux-1-kontext-image-editing-parameters
    // Options: api.bfl.ai (global), api.eu.bfl.ai (EU), api.us.bfl.ai (US)
    const bflApiUrl = process.env.BFL_API_URL || "https://api.bfl.ai/v1/flux-kontext-pro"
    const allGeneratedImages: string[] = []

    // Process each image separately (FLUX.1 Kontext Pro only accepts one input_image per request)
    // Per BFL docs: input_image can be base64 encoded image or URL (up to 20MB or 20 megapixels)
    for (let imageIndex = 0; imageIndex < imageUrls.length; imageIndex++) {
      const imageUrl = imageUrls[imageIndex]
      await logger.debug(`Processing image ${imageIndex + 1}/${imageUrls.length}`)

      // Convert image to base64 format for the API
      // BFL API accepts base64 encoded image (without data URI prefix) or image URL
      const imageBase64 = await imageUrlToBase64(imageUrl)

      // Prepare request body according to BFL API documentation
      // Required: prompt (string), input_image (string - base64 or URL)
      // Optional: aspect_ratio, seed, prompt_upsampling, safety_tolerance, output_format, webhook_url, webhook_secret
      const requestBody: any = {
        prompt: prompt,
        input_image: imageBase64, // Base64 encoded image (without data URI prefix)
      }

      // Optional parameters per BFL API documentation
      // aspect_ratio: string | null (default: "1:1", supports 3:7 to 7:3)
      // seed: integer | null (default: null, random seed if omitted)
      // prompt_upsampling: boolean (default: false)
      // safety_tolerance: integer (default: 2, range 0-6)
      // output_format: string (default: "jpeg", can be "jpeg" or "png")
      // webhook_url: string | null (default: null)
      // webhook_secret: string | null (default: null)
      
      // Make API request with retry logic and proper error handling
      const bflResponse = await makeBFLRequest(bflApiUrl, apiKey, requestBody, imageIndex + 1)

      if (!bflResponse.success) {
        // If one image fails, return error but include any images generated so far
        await logger.error(`Image ${imageIndex + 1} generation failed`, new Error(bflResponse.error || 'Unknown error'), {
          imageIndex: imageIndex + 1,
          totalImages: imageUrls.length,
          generatedSoFar: allGeneratedImages.length
        })
        return errorResponse(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          `Image ${imageIndex + 1} failed: ${bflResponse.error}`,
          {
            images: allGeneratedImages.length > 0 ? allGeneratedImages : undefined,
            details: process.env.NODE_ENV === 'development' ? bflResponse.details : undefined,
          },
          bflResponse.status || 500,
          { requestId }
        )
      }

      const bflData = bflResponse.data

      await logger.debug(`BFL API response received`, {
        imageIndex: imageIndex + 1,
        hasPollingUrl: !!bflData.polling_url,
        hasId: !!bflData.id,
        hasResult: !!bflData.result,
        status: bflData.status,
      })

      // Extract generated image URL from the response
      // Per BFL docs: After polling, result.sample contains delivery URL (expires in 10 minutes)
      // https://docs.bfl.ai/kontext/kontext_image_editing#poll-for-result
      // https://docs.bfl.ai/api_integration/integration_guidelines#content-delivery-and-storage-guidelines
      let generatedImageUrl: string | null = null

      // Handle polling result format (result.sample)
      if (bflData.result && bflData.result.sample) {
        generatedImageUrl = typeof bflData.result.sample === 'string' 
          ? bflData.result.sample 
          : bflData.result.sample.url || bflData.result.sample
      } 
      // Handle direct response format (shouldn't happen with async API, but handle just in case)
      else if (bflData.sample) {
        generatedImageUrl = typeof bflData.sample === 'string' ? bflData.sample : bflData.sample.url
      } else if (bflData.result && typeof bflData.result === 'string') {
        generatedImageUrl = bflData.result
      } else {
        await logger.warn(`Unexpected API response format`, {
          imageIndex: imageIndex + 1,
          responseKeys: Object.keys(bflData)
        })
        throw new Error(`Unexpected response format from AI service (image ${imageIndex + 1}). Check API documentation for correct format.`)
      }

      if (!generatedImageUrl) {
        await logger.error(`No image URL returned`, new Error('No image URL in response'), {
          imageIndex: imageIndex + 1
        })
        throw new Error(`No image URL returned for image ${imageIndex + 1}`)
      }

      // Note: Delivery URLs expire after 10 minutes and don't support CORS
      // For production, download images immediately and serve from your own infrastructure
      // See: https://docs.bfl.ai/api_integration/integration_guidelines#recommended-image-handling

      // Add result to overall results
      allGeneratedImages.push(generatedImageUrl)
      
      await logger.info(`Image ${imageIndex + 1} generated successfully`, {
        imageIndex: imageIndex + 1,
        totalImages: imageUrls.length
      })
    }

    if (allGeneratedImages.length === 0) {
      await logger.error('No images were generated', new Error('No images were generated'))
      throw new Error("No images were generated")
    }

    await logger.info('All images processed successfully', {
      totalGenerated: allGeneratedImages.length,
      eventType
    })

    return successResponse(
      {
        images: allGeneratedImages,
        totalImages: allGeneratedImages.length,
      },
      { requestId }
    )
  }, { endpoint: '/api/ai-space' })
}

