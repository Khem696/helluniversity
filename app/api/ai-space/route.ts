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

// Helper function to convert image URL to base64 (for API if needed)
async function imageUrlToBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url)
    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    return `data:${contentType};base64,${base64}`
  } catch (error) {
    console.error(`Failed to convert image to base64: ${url}`, error)
    throw new Error(`Failed to process image: ${url}`)
  }
}

// Helper function to make BFL API requests with proper error handling and retry logic
// Implements recommendations from: https://docs.bfl.ai/api_integration/integration_guidelines#best-practices
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
          "Authorization": `Bearer ${apiKey}`,
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
      if (data.polling_url && data.status && data.status !== 'Ready') {
        // Handle async polling if needed
        return await pollForResult(data.polling_url, apiKey, batchNumber)
      }

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
  maxAttempts: number = 60, // 30 seconds max (0.5s intervals)
  pollInterval: number = 500 // 500ms between polls
): Promise<{ success: boolean; data?: any; error?: string; status?: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(pollingUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "accept": "application/json",
        },
      })

      if (!response.ok) {
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
          error: result.error || 'Generation failed',
          status: 500,
        }
      }

      // Still processing, wait and retry
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      
    } catch (error) {
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

    // Verify token with Cloudflare
    const turnstileResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          secret: secretKey,
          response: token,
        }),
      }
    )

    const turnstileData = await turnstileResponse.json()

    if (!turnstileData.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Turnstile verification failed",
          "error-codes": turnstileData["error-codes"],
        },
        { status: 400 }
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

    // Convert image paths to full URLs
    const imageUrls = selectedImages.map(getImageUrl)

    // Split images into batches of 4 (BlackForest Lab API limit)
    const MAX_IMAGES_PER_REQUEST = 4
    const batches: string[][] = []
    for (let i = 0; i < imageUrls.length; i += MAX_IMAGES_PER_REQUEST) {
      batches.push(imageUrls.slice(i, i + MAX_IMAGES_PER_REQUEST))
    }

    console.log(`Processing ${selectedImages.length} images in ${batches.length} batch(es)`)

    // Use primary global endpoint per BFL documentation: https://docs.bfl.ai/api_integration/integration_guidelines
    // Options: api.bfl.ai (global), api.eu.bfl.ai (EU), api.us.bfl.ai (US)
    const bflApiUrl = process.env.BFL_API_URL || "https://api.bfl.ai/v1/flux-kontext-pro"
    const allGeneratedImages: string[] = []

    // Process each batch sequentially
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]
      console.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} image(s)`)

      // Convert images to base64 format for the API
      const imageBase64Promises = batch.map(imageUrlToBase64)
      const imageBase64Array = await Promise.all(imageBase64Promises)

      // Prepare request body - adjust fields based on actual API requirements
      const requestBody: any = {
        prompt: prompt,
      }

      // Add image(s) based on count
      if (imageBase64Array.length === 1) {
        // Single image: use 'image' field
        requestBody.image = imageBase64Array[0]
      } else {
        // Multiple images (up to 4): use 'images' array
        requestBody.images = imageBase64Array
      }

      // Optional parameters that may be supported
      // Uncomment and adjust based on actual API documentation
      // requestBody.num_images = 1
      // requestBody.aspect_ratio = "16:9"
      // requestBody.output_format = "jpeg"
      // requestBody.output_quality = 90
      // requestBody.seed = undefined // Optional seed for reproducibility
      // requestBody.guidance_scale = 3.5 // Optional guidance scale
      
      // Make API request with retry logic and proper error handling
      const bflResponse = await makeBFLRequest(bflApiUrl, apiKey, requestBody, batchIndex + 1)

      if (!bflResponse.success) {
        // If one batch fails, return error but include any images generated so far
        return NextResponse.json(
          {
            success: false,
            error: `Batch ${batchIndex + 1} failed: ${bflResponse.error}`,
            images: allGeneratedImages.length > 0 ? allGeneratedImages : undefined,
            details: process.env.NODE_ENV === 'development' ? bflResponse.details : undefined,
          },
          { status: bflResponse.status || 500 }
        )
      }

      const bflData = bflResponse.data

      console.log(`BlackForest Lab API response (batch ${batchIndex + 1}):`, {
        keys: Object.keys(bflData),
        hasData: !!bflData.data,
        hasImages: !!bflData.images,
        hasUrl: !!bflData.url,
        hasImageUrl: !!bflData.image_url,
        hasResult: !!bflData.result,
      })

      // Extract generated image URLs from the response
      // Per BFL docs: result.sample contains delivery URL (expires in 10 minutes)
      // https://docs.bfl.ai/api_integration/integration_guidelines#content-delivery-and-storage-guidelines
      let batchGeneratedImages: string[] = []

      // Handle async polling result format (result.sample)
      if (bflData.result && bflData.result.sample) {
        batchGeneratedImages = Array.isArray(bflData.result.sample) 
          ? bflData.result.sample 
          : [bflData.result.sample]
      } 
      // Handle direct response format
      else if (bflData.data && Array.isArray(bflData.data)) {
        batchGeneratedImages = bflData.data
          .map((item: any) => {
            if (typeof item === 'string') return item
            return item.url || item.image_url || item.image || item.output_url || item.sample
          })
          .filter(Boolean)
      } else if (bflData.data && typeof bflData.data === 'object') {
        const item = bflData.data
        const url = item.url || item.image_url || item.image || item.output_url || item.sample
        if (url) batchGeneratedImages = [url]
      } else if (bflData.image_url || bflData.sample) {
        batchGeneratedImages = [bflData.image_url || bflData.sample]
      } else if (bflData.images && Array.isArray(bflData.images)) {
        batchGeneratedImages = bflData.images.map((img: any) => 
          typeof img === 'string' ? img : (img.url || img.image_url || img.sample || img)
        ).filter(Boolean)
      } else if (bflData.url) {
        batchGeneratedImages = [bflData.url]
      } else if (bflData.output) {
        batchGeneratedImages = Array.isArray(bflData.output) ? bflData.output : [bflData.output]
      } else {
        console.warn(`Unexpected API response format (batch ${batchIndex + 1}). Full response:`, JSON.stringify(bflData, null, 2))
        throw new Error(`Unexpected response format from AI service (batch ${batchIndex + 1}). Check API documentation for correct format.`)
      }

      // Note: Delivery URLs expire after 10 minutes and don't support CORS
      // For production, download images immediately and serve from your own infrastructure
      // See: https://docs.bfl.ai/api_integration/integration_guidelines#recommended-image-handling

      // Add batch results to overall results
      allGeneratedImages.push(...batchGeneratedImages)
      
      console.log(`Batch ${batchIndex + 1} completed: ${batchGeneratedImages.length} image(s) generated`)
    }

    if (allGeneratedImages.length === 0) {
      throw new Error("No images were generated from any batch")
    }

    console.log(`All batches completed: ${allGeneratedImages.length} total image(s) generated`)

    return NextResponse.json({
      success: true,
      images: allGeneratedImages,
      batchesProcessed: batches.length,
      totalImages: allGeneratedImages.length,
    })
  } catch (error) {
    console.error("AI space generation error:", error)
    
    const errorMessage = error instanceof Error 
      ? error.message 
      : "Internal server error"
    
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}

