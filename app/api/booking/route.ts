import { NextResponse } from "next/server"
import { sendReservationEmails, verifyEmailConfig } from "@/lib/email"

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
    const body = await request.json()
    const { token, ...bookingData } = body

    // Validate reCAPTCHA token
    if (!token) {
      return NextResponse.json(
        { success: false, error: "reCAPTCHA token is required" },
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
      console.error("reCAPTCHA API HTTP error:", {
        status: recaptchaResponse.status,
        statusText: recaptchaResponse.statusText,
        errorBody: errorText
      })
      return NextResponse.json(
        {
          success: false,
          error: "reCAPTCHA verification service error",
          details: `HTTP ${recaptchaResponse.status}: ${recaptchaResponse.statusText}`
        },
        { status: 500 }
      )
    }

    // Parse JSON response
    let recaptchaData: any
    try {
      recaptchaData = await recaptchaResponse.json()
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
    if (!recaptchaData || typeof recaptchaData.success !== "boolean") {
      console.error("Invalid reCAPTCHA response structure:", recaptchaData)
      return NextResponse.json(
        {
          success: false,
          error: "Invalid verification response",
        },
        { status: 500 }
      )
    }

    // Check if verification was successful
    if (!recaptchaData.success) {
      return NextResponse.json(
        {
          success: false,
          error: "reCAPTCHA verification failed",
          "error-codes": recaptchaData["error-codes"] || [],
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

