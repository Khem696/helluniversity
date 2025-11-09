import { NextResponse } from "next/server"
import { sendReservationEmails, verifyEmailConfig } from "@/lib/email"

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

    // Validate required booking data
    if (!bookingData.name || !bookingData.email || !bookingData.startDate) {
      return NextResponse.json(
        { success: false, error: "Missing required booking information" },
        { status: 400 }
      )
    }

    // Verify email configuration first
    const emailConfigCheck = verifyEmailConfig()
    if (!emailConfigCheck.valid) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Email service is not configured. Please contact support.",
          details: emailConfigCheck.errors
        },
        { status: 500 }
      )
    }

    // Send emails - booking fails if email fails (blocking)
    try {
      const emailStatus = await sendReservationEmails(bookingData)
      
      // Check if both emails were sent successfully
      if (!emailStatus.adminSent || !emailStatus.userSent) {
        const errorMessages = emailStatus.errors.join("; ")
        console.error("Email sending failed:", errorMessages)
        
        return NextResponse.json(
          { 
            success: false, 
            error: "Failed to send confirmation emails. Please try again.",
            details: errorMessages,
            emailStatus: {
              adminNotification: emailStatus.adminSent,
              userConfirmation: emailStatus.userSent,
            }
          },
          { status: 500 }
        )
      }

      // Log successful booking
      console.log("Booking received and emails sent successfully:", bookingData)

      // Return success only if emails were sent successfully
      return NextResponse.json({
        success: true,
        message: "Booking request received successfully. Confirmation emails have been sent.",
      })
    } catch (emailError) {
      // Email sending failed - booking fails
      const errorMessage = emailError instanceof Error ? emailError.message : "Unknown email error"
      console.error("Email sending error - booking failed:", emailError)
      
      return NextResponse.json(
        { 
          success: false, 
          error: "Failed to send confirmation emails. Please check your connection and try again.",
          details: errorMessage
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error("Booking submission error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}

