/**
 * Test Email Configuration Endpoint v1
 * 
 * Test endpoint to verify email configuration in production
 * Access at: /api/v1/test-email-config
 * This helps debug environment variable issues
 * 
 * IMPORTANT: After deploying, you may need to wait a few minutes for the route to be available
 * or trigger a new deployment by making a small change and pushing to your repo
 */

import { NextResponse } from "next/server"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Email config test request received')
    
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
    
    await logger.info('Email config test completed', {
      reservationEmailSet: !!reservationEmail,
      smtpUserSet: !!smtpUser,
      smtpPasswordSet: !!process.env.SMTP_PASSWORD,
    })

    return successResponse(
      {
        message: "Email configuration test",
        envStatus,
        timestamp: new Date().toISOString(),
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

