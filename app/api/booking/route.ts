import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { token, ...bookingData } = body

    // Validate Turnstile token
    if (!token) {
      return NextResponse.json(
        { success: false, error: "Turnstile token is required" },
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

    // Here you would typically save the booking to your database
    // For now, we'll just log it and return success
    console.log("Booking received:", bookingData)

    return NextResponse.json({
      success: true,
      message: "Booking request received successfully",
    })
  } catch (error) {
    console.error("Booking submission error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}

