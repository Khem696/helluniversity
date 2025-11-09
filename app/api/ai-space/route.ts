import { NextResponse } from "next/server"

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

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { token, selectedImages, prompt } = body

    // Validate Turnstile token
    if (!token) {
      return NextResponse.json(
        { success: false, error: "Turnstile token is required" },
        { status: 400 }
      )
    }

    // Validate inputs
    if (!selectedImages || selectedImages.length === 0) {
      return NextResponse.json(
        { success: false, error: "Please select at least one image" },
        { status: 400 }
      )
    }

    if (!prompt || prompt.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Please provide a prompt" },
        { status: 400 }
      )
    }

    const secretKey = process.env.TURNSTILE_SECRET_KEY

    if (!secretKey) {
      console.error("TURNSTILE_SECRET_KEY is not set")
      return NextResponse.json(
        { success: false, error: "Server configuration error" },
        { status: 500 }
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

    // Verify token with Cloudflare using FormData (as per Cloudflare documentation)
    const formData = new FormData()
    formData.append("secret", secretKey)
    formData.append("response", token)
    if (remoteip) {
      formData.append("remoteip", remoteip)
    }

    const turnstileResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
      }
    )

    // Check if HTTP response is OK
    if (!turnstileResponse.ok) {
      console.error("Turnstile API HTTP error:", turnstileResponse.status, turnstileResponse.statusText)
      return NextResponse.json(
        {
          success: false,
          error: "Turnstile verification service error",
        },
        { status: 500 }
      )
    }

    // Parse JSON response
    let turnstileData: any
    try {
      turnstileData = await turnstileResponse.json()
    } catch (jsonError) {
      console.error("Failed to parse Turnstile response:", jsonError)
      return NextResponse.json(
        {
          success: false,
          error: "Invalid response from verification service",
        },
        { status: 500 }
      )
    }

    // Validate response structure and success field
    if (!turnstileData || typeof turnstileData.success !== "boolean") {
      console.error("Invalid Turnstile response structure:", turnstileData)
      return NextResponse.json(
        {
          success: false,
          error: "Invalid verification response",
        },
        { status: 500 }
      )
    }

    // Check if verification was successful
    if (!turnstileData.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Turnstile verification failed",
          "error-codes": turnstileData["error-codes"] || [],
        },
        { status: 400 }
      )
    }

    // Rate limiting check (uses IP + User-Agent fingerprint for better device tracking)
    // Device fingerprint combines IP + User-Agent + Accept-Language + Accept-Encoding
    // This provides similar functionality to MAC address tracking but using available HTTP headers
    const { checkRateLimit, getRateLimitIdentifier } = await import("@/lib/rate-limit")
    const identifier = getRateLimitIdentifier(request) // Uses env var or defaults to fingerprint
    const rateLimitResult = await checkRateLimit(identifier, "ai-space")

    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Rate limit exceeded. Please try again later.",
          rateLimit: {
            limit: rateLimitResult.limit,
            remaining: rateLimitResult.remaining,
            reset: rateLimitResult.reset,
          },
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": rateLimitResult.limit.toString(),
            "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
            "X-RateLimit-Reset": rateLimitResult.reset.toString(),
            "Retry-After": (rateLimitResult.reset - Math.floor(Date.now() / 1000)).toString(),
          },
        }
      )
    }

    // Check for BlackForest Lab API key
    const apiKey = process.env.PROVIDER_API_KEY

    if (!apiKey) {
      console.error("PROVIDER_API_KEY is not set")
      return NextResponse.json(
        { success: false, error: "AI service is not configured. Please contact administrator." },
        { status: 500 }
      )
    }

    // Validate that all images are from the allowed studio directory
    const studioImagePrefix = "/aispaces/studio/"
    const invalidImages = selectedImages.filter(
      (path: string) => !path.startsWith(studioImagePrefix) && !path.includes(studioImagePrefix)
    )
    
    if (invalidImages.length > 0) {
      return NextResponse.json(
        { success: false, error: "All images must be from the studio directory" },
        { status: 400 }
      )
    }

    // Convert image paths to full URLs
    const imageUrls = selectedImages.map(getImageUrl)

    console.log(`Processing ${selectedImages.length} image(s) for AI space generation`)

    // Use primary global endpoint per BFL documentation: https://docs.bfl.ai/api_integration/integration_guidelines
    // API Reference: https://docs.bfl.ai/kontext/kontext_image_editing#flux-1-kontext-image-editing-parameters
    // Options: api.bfl.ai (global), api.eu.bfl.ai (EU), api.us.bfl.ai (US)
    const bflApiUrl = process.env.BFL_API_URL || "https://api.bfl.ai/v1/flux-kontext-pro"
    const allGeneratedImages: string[] = []

    // Process each image separately (FLUX.1 Kontext Pro only accepts one input_image per request)
    // Per BFL docs: input_image can be base64 encoded image or URL (up to 20MB or 20 megapixels)
    for (let imageIndex = 0; imageIndex < imageUrls.length; imageIndex++) {
      const imageUrl = imageUrls[imageIndex]
      console.log(`Processing image ${imageIndex + 1}/${imageUrls.length}`)

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
        return NextResponse.json(
          {
            success: false,
            error: `Image ${imageIndex + 1} failed: ${bflResponse.error}`,
            images: allGeneratedImages.length > 0 ? allGeneratedImages : undefined,
            details: process.env.NODE_ENV === 'development' ? bflResponse.details : undefined,
          },
          { status: bflResponse.status || 500 }
        )
      }

      const bflData = bflResponse.data

      console.log(`BlackForest Lab API response (image ${imageIndex + 1}):`, {
        keys: Object.keys(bflData),
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
        console.warn(`Unexpected API response format (image ${imageIndex + 1}). Full response:`, JSON.stringify(bflData, null, 2))
        throw new Error(`Unexpected response format from AI service (image ${imageIndex + 1}). Check API documentation for correct format.`)
      }

      if (!generatedImageUrl) {
        throw new Error(`No image URL returned for image ${imageIndex + 1}`)
      }

      // Note: Delivery URLs expire after 10 minutes and don't support CORS
      // For production, download images immediately and serve from your own infrastructure
      // See: https://docs.bfl.ai/api_integration/integration_guidelines#recommended-image-handling

      // Add result to overall results
      allGeneratedImages.push(generatedImageUrl)
      
      console.log(`Image ${imageIndex + 1} completed: generated successfully`)
    }

    if (allGeneratedImages.length === 0) {
      throw new Error("No images were generated")
    }

    console.log(`All images processed: ${allGeneratedImages.length} total image(s) generated`)

    return NextResponse.json({
      success: true,
      images: allGeneratedImages,
      totalImages: allGeneratedImages.length,
    })
  } catch (error) {
    console.error("AI space generation error:", error)
    
    let errorMessage = "Internal server error"
    let statusCode = 500
    
    if (error instanceof Error) {
      errorMessage = error.message
      
      // Handle specific error types
      if (error.message.includes("timeout")) {
        statusCode = 408
        errorMessage = "Request timed out. Image generation is taking longer than expected. Please try again."
      } else if (error.message.includes("fetch") || error.message.includes("network")) {
        statusCode = 503
        errorMessage = "Network error occurred. Please try again."
      }
    }
    
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: statusCode }
    )
  }
}

