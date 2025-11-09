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
    
    // Log received booking data for debugging (using error so it shows in production)
    console.error('='.repeat(60))
    console.error('📥 RECEIVED BOOKING DATA FROM FORM:')
    console.error('='.repeat(60))
    console.error('Name:', bookingData.name || 'MISSING')
    console.error('Email:', bookingData.email || 'MISSING')
    console.error('Phone:', bookingData.phone || 'MISSING')
    console.error('Participants:', bookingData.participants || 'MISSING')
    console.error('Event Type:', bookingData.eventType || 'MISSING')
    console.error('Other Event Type:', bookingData.otherEventType || 'N/A')
    console.error('Date Range:', bookingData.dateRange ? 'YES' : 'NO')
    console.error('Start Date:', bookingData.startDate || 'MISSING')
    console.error('End Date:', bookingData.endDate || 'MISSING')
    console.error('Start Time:', bookingData.startTime || 'MISSING')
    console.error('End Time:', bookingData.endTime || 'MISSING')
    console.error('Organization Type:', bookingData.organizationType || 'MISSING')
    console.error('Introduction:', bookingData.introduction ? `${bookingData.introduction.substring(0, 50)}...` : 'MISSING')
    console.error('Biography:', bookingData.biography ? `${bookingData.biography.substring(0, 50)}...` : 'N/A')
    console.error('Special Requests:', bookingData.specialRequests ? `${bookingData.specialRequests.substring(0, 50)}...` : 'N/A')
    console.error('='.repeat(60))

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

    // Send emails - prioritize user confirmation
    try {
      // Use console.error so logs appear in production (console.log is removed)
      console.error("=".repeat(60))
      console.error("STARTING EMAIL SENDING PROCESS")
      console.error("=".repeat(60))
      console.error("Environment Variables Check (API Route):")
      console.error("  RESERVATION_EMAIL:", process.env.RESERVATION_EMAIL ? `✅ SET (${process.env.RESERVATION_EMAIL})` : "❌ NOT SET")
      console.error("  SMTP_USER:", process.env.SMTP_USER ? `✅ SET (${process.env.SMTP_USER})` : "❌ NOT SET")
      console.error("  SMTP_HOST:", process.env.SMTP_HOST || "default (smtp.gmail.com)")
      console.error("  SMTP_PORT:", process.env.SMTP_PORT || "default (587)")
      console.error("  NODE_ENV:", process.env.NODE_ENV || "unknown")
      console.error("  VERCEL:", process.env.VERCEL ? "YES" : "NO")
      console.error("=".repeat(60))
      
      // Validate RESERVATION_EMAIL is set before proceeding
      if (!process.env.RESERVATION_EMAIL) {
        console.error("⚠️ WARNING: RESERVATION_EMAIL is not set!")
        console.error("⚠️ Admin notifications will use SMTP_USER as fallback:", process.env.SMTP_USER || "NOT SET")
      }
      
      // Normalize booking data to ensure all fields are properly formatted
      const normalizedBookingData = {
        name: String(bookingData.name || "").trim(),
        email: String(bookingData.email || "").trim(),
        phone: String(bookingData.phone || "").trim(),
        participants: bookingData.participants ? String(bookingData.participants).trim() : undefined,
        eventType: String(bookingData.eventType || "").trim(),
        otherEventType: bookingData.otherEventType ? String(bookingData.otherEventType).trim() : undefined,
        dateRange: Boolean(bookingData.dateRange),
        startDate: bookingData.startDate ? String(bookingData.startDate).trim() : null,
        endDate: bookingData.endDate ? String(bookingData.endDate).trim() : null,
        startTime: bookingData.startTime ? String(bookingData.startTime).trim() : undefined,
        endTime: bookingData.endTime ? String(bookingData.endTime).trim() : undefined,
        organizationType: (bookingData.organizationType as "Tailor Event" | "Space Only" | "") || "",
        introduction: String(bookingData.introduction || "").trim(),
        biography: bookingData.biography ? String(bookingData.biography).trim() : "",
        specialRequests: bookingData.specialRequests ? String(bookingData.specialRequests).trim() : "",
      }
      
      // Validate normalized data
      if (!normalizedBookingData.name || !normalizedBookingData.email || !normalizedBookingData.startDate) {
        return NextResponse.json(
          { success: false, error: "Missing required booking information after normalization" },
          { status: 400 }
        )
      }
      
      console.error("📦 Normalized booking data:", {
        name: normalizedBookingData.name,
        email: normalizedBookingData.email,
        phone: normalizedBookingData.phone,
        participants: normalizedBookingData.participants,
        eventType: normalizedBookingData.eventType,
        startDate: normalizedBookingData.startDate,
        endDate: normalizedBookingData.endDate,
        startTime: normalizedBookingData.startTime,
        endTime: normalizedBookingData.endTime,
        introduction: normalizedBookingData.introduction ? `${normalizedBookingData.introduction.substring(0, 30)}...` : "empty",
        biography: normalizedBookingData.biography ? `${normalizedBookingData.biography.substring(0, 30)}...` : "empty",
        specialRequests: normalizedBookingData.specialRequests ? `${normalizedBookingData.specialRequests.substring(0, 30)}...` : "empty",
      })
      
      const emailStatus = await sendReservationEmails(normalizedBookingData)
      
      console.error("Email sending results:", {
        adminSent: emailStatus.adminSent,
        userSent: emailStatus.userSent,
        errors: emailStatus.errors
      })
      
      // If user confirmation was sent, consider it a success (user got their email)
      // Both emails must succeed - if admin email fails, user email is not sent
      if (emailStatus.adminSent && emailStatus.userSent) {
        console.error("✅ Both admin notification and user confirmation sent successfully")
        console.error("Booking received and emails sent:", bookingData)

        return NextResponse.json({
          success: true,
          message: "Booking request received successfully. Confirmation email has been sent.",
          emailStatus: {
            adminNotification: emailStatus.adminSent,
            userConfirmation: emailStatus.userSent,
          }
        })
      }
      
      // If either email failed, return error
      const errorMessages = emailStatus.errors.join("; ")
      console.error("❌ Email sending failed:", errorMessages)
      console.error("Admin sent:", emailStatus.adminSent, "User sent:", emailStatus.userSent)
      
      // Determine appropriate error message
      let errorMessage = "Failed to send confirmation emails. Please try again."
      if (!emailStatus.adminSent && !emailStatus.userSent) {
        errorMessage = "Failed to process your booking request. Please try again later."
      } else if (!emailStatus.adminSent) {
        errorMessage = "Failed to process your booking request. Please try again later."
      } else if (!emailStatus.userSent) {
        errorMessage = "Failed to send confirmation email. Please try again."
      }
      
      return NextResponse.json(
        { 
          success: false, 
          error: errorMessage,
          details: errorMessages,
          emailStatus: {
            adminNotification: emailStatus.adminSent,
            userConfirmation: emailStatus.userSent,
          }
        },
        { status: 500 }
      )
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

