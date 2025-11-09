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

    const secretKey = process.env.RECAPTCHA_SECRET_KEY

    if (!secretKey) {
      console.error("RECAPTCHA_SECRET_KEY is not set")
      return NextResponse.json(
        { success: false, error: "Server configuration error" },
        { status: 500 }
      )
    }

    // Get client IP address for verification
    const remoteip = getClientIP(request)

    // Log verification attempt (without exposing sensitive data)
    console.log("reCAPTCHA verification attempt:", {
      hasToken: !!token,
      tokenLength: token?.length,
      hasSecretKey: !!secretKey,
      hasRemoteIP: !!remoteip,
      remoteip: remoteip || "not available"
    })

    // Verify token with Google reCAPTCHA API
    const params = new URLSearchParams()
    params.append("secret", secretKey)
    params.append("response", token)
    if (remoteip) {
      params.append("remoteip", remoteip)
    }

    const response = await fetch(
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
    if (!response.ok) {
      const errorText = await response.text()
      console.error("reCAPTCHA API HTTP error:", {
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText
      })
      return NextResponse.json(
        {
          success: false,
          error: "reCAPTCHA verification service error",
          details: `HTTP ${response.status}: ${response.statusText}`
        },
        { status: 500 }
      )
    }

    // Parse JSON response
    let data: any
    try {
      data = await response.json()
    } catch (jsonError) {
      console.error("Failed to parse reCAPTCHA response:", jsonError)
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
      console.error("Invalid reCAPTCHA response structure:", data)
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
      console.error("reCAPTCHA verification failed:", {
        success: data.success,
        errorCodes: data["error-codes"] || [],
        challengeTs: data["challenge_ts"],
        hostname: data.hostname
      })
      return NextResponse.json(
        {
          success: false,
          error: "reCAPTCHA verification failed",
          "error-codes": data["error-codes"] || [],
        },
        { status: 400 }
      )
    }

    console.log("reCAPTCHA verification successful:", {
      challengeTs: data["challenge_ts"],
      hostname: data.hostname
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("reCAPTCHA verification error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}

