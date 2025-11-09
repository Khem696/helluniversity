import { NextResponse } from "next/server"

/**
 * Test endpoint to verify email configuration in production
 * Access at: /api/test-email-config
 * This helps debug environment variable issues
 * 
 * IMPORTANT: After deploying, you may need to wait a few minutes for the route to be available
 * or trigger a new deployment by making a small change and pushing to your repo
 */
export async function GET(request: Request) {
  try {
    // Get environment variable status (without exposing sensitive values)
    const reservationEmail = process.env.RESERVATION_EMAIL?.trim()
    const smtpUser = process.env.SMTP_USER?.trim()
    
    const envStatus = {
      RESERVATION_EMAIL: {
        set: !!reservationEmail,
        value: reservationEmail 
          ? `${reservationEmail.substring(0, 3)}***@${reservationEmail.split('@')[1] || 'unknown'}` 
          : 'NOT SET',
        length: reservationEmail?.length || 0,
        rawValue: reservationEmail || null // For debugging - remove in production if security concern
      },
      SMTP_USER: {
        set: !!smtpUser,
        value: smtpUser 
          ? `${smtpUser.substring(0, 3)}***@${smtpUser.split('@')[1] || 'unknown'}` 
          : 'NOT SET',
        length: smtpUser?.length || 0
      },
      SMTP_HOST: process.env.SMTP_HOST || 'default (smtp.gmail.com)',
      SMTP_PORT: process.env.SMTP_PORT || 'default (587)',
      SMTP_PASSWORD: {
        set: !!process.env.SMTP_PASSWORD,
        length: process.env.SMTP_PASSWORD?.length || 0
      },
      NODE_ENV: process.env.NODE_ENV || 'unknown',
      VERCEL: process.env.VERCEL ? 'YES' : 'NO',
      VERCEL_ENV: process.env.VERCEL_ENV || 'unknown',
    }
    
    // Simple validation
    const configValid = !!(smtpUser && process.env.SMTP_PASSWORD)
    const configErrors: string[] = []
    
    if (!smtpUser) {
      configErrors.push('SMTP_USER is not set')
    }
    if (!process.env.SMTP_PASSWORD) {
      configErrors.push('SMTP_PASSWORD is not set')
    }
    if (!reservationEmail && !smtpUser) {
      configErrors.push('RESERVATION_EMAIL or SMTP_USER must be set')
    }
    
    return NextResponse.json({
      success: true,
      configValid,
      configErrors,
      environment: envStatus,
      message: configValid 
        ? (reservationEmail 
            ? "Email configuration is valid. RESERVATION_EMAIL is set." 
            : "Email configuration is valid, but RESERVATION_EMAIL is not set (using SMTP_USER as fallback)")
        : "Email configuration has errors - check configErrors array",
      recommendation: !reservationEmail 
        ? "Set RESERVATION_EMAIL environment variable in Vercel dashboard for dedicated admin notifications"
        : null
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      }
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : undefined) : undefined
    }, { status: 500 })
  }
}

