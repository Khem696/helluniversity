import { NextResponse } from "next/server"

// Helper function to get client IP address
function getClientIP(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")
  const realIP = request.headers.get("x-real-ip")
  const cfConnectingIP = request.headers.get("cf-connecting-ip") // Cloudflare

  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(",")[0].trim()
  }

  if (realIP) {
    return realIP
  }

  if (cfConnectingIP) {
    return cfConnectingIP
  }

  return null
}

export async function POST(request: Request) {
  try {
    const { token } = await request.json()

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Token is required" },
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
    const remoteip = getClientIP(request)

    // Verify token with Cloudflare using FormData (as per Cloudflare documentation)
    const formData = new FormData()
    formData.append("secret", secretKey)
    formData.append("response", token)
    if (remoteip) {
      formData.append("remoteip", remoteip)
    }

    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
      }
    )

    // Check if HTTP response is OK
    if (!response.ok) {
      console.error("Turnstile API HTTP error:", response.status, response.statusText)
      return NextResponse.json(
        {
          success: false,
          error: "Turnstile verification service error",
        },
        { status: 500 }
      )
    }

    // Parse JSON response
    let data: any
    try {
      data = await response.json()
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
    if (!data || typeof data.success !== "boolean") {
      console.error("Invalid Turnstile response structure:", data)
      return NextResponse.json(
        {
          success: false,
          error: "Invalid verification response",
        },
        { status: 500 }
      )
    }

    // Check if verification was successful
    if (!data.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Turnstile verification failed",
          "error-codes": data["error-codes"] || [],
        },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Turnstile verification error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}

