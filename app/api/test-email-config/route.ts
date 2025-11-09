import { NextResponse } from "next/server"
import { verifyEmailConfig } from "@/lib/email"

/**
 * Test endpoint to verify email configuration in production
 * Access at: /api/test-email-config
 * This helps debug environment variable issues
 */
export async function GET(request: Request) {
  try {
    const config = verifyEmailConfig()
    
    // Get environment variable status (without exposing sensitive values)
    const envStatus = {
      RESERVATION_EMAIL: {
        set: !!process.env.RESERVATION_EMAIL,
        value: process.env.RESERVATION_EMAIL ? `${process.env.RESERVATION_EMAIL.substring(0, 3)}***@${process.env.RESERVATION_EMAIL.split('@')[1] || 'unknown'}` : 'NOT SET',
        length: process.env.RESERVATION_EMAIL?.length || 0
      },
      SMTP_USER: {
        set: !!process.env.SMTP_USER,
        value: process.env.SMTP_USER ? `${process.env.SMTP_USER.substring(0, 3)}***@${process.env.SMTP_USER.split('@')[1] || 'unknown'}` : 'NOT SET',
        length: process.env.SMTP_USER?.length || 0
      },
      SMTP_HOST: process.env.SMTP_HOST || 'default (smtp.gmail.com)',
      SMTP_PORT: process.env.SMTP_PORT || 'default (587)',
      SMTP_PASSWORD: {
        set: !!process.env.SMTP_PASSWORD,
        length: process.env.SMTP_PASSWORD?.length || 0
      },
      NODE_ENV: process.env.NODE_ENV || 'unknown',
      VERCEL: process.env.VERCEL ? 'YES' : 'NO',
    }
    
    return NextResponse.json({
      success: true,
      configValid: config.valid,
      configErrors: config.errors,
      environment: envStatus,
      message: config.valid 
        ? "Email configuration is valid" 
        : "Email configuration has errors - check configErrors array"
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 })
  }
}

