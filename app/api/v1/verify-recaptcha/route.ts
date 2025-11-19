/**
 * reCAPTCHA Verification API v1
 * 
 * Versioned endpoint for reCAPTCHA verification
 * Maintains backward compatibility with /api/verify-recaptcha
 * 
 * POST /api/v1/verify-recaptcha - Verify reCAPTCHA token
 */

import { NextResponse } from "next/server"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"

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

export const POST = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('reCAPTCHA verification request received')
    
    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    // reCAPTCHA tokens are typically small, but we still need a limit
    let body: any
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 10240) // 10KB limit for reCAPTCHA token
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await logger.warn('Request body parsing failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        errorMessage.includes('too large') 
          ? 'Request body is too large. Please check your reCAPTCHA token.'
          : 'Invalid request format. Please check your input and try again.',
        undefined,
        400,
        { requestId }
      )
    }
    
    const { token } = body

    if (!token) {
      await logger.warn('reCAPTCHA verification rejected: missing token')
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Token is required",
        undefined,
        400,
        { requestId }
      )
    }

    const secretKey = process.env.RECAPTCHA_SECRET_KEY

    if (!secretKey) {
      await logger.error('RECAPTCHA_SECRET_KEY is not set', new Error('RECAPTCHA_SECRET_KEY is not set'))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Server configuration error",
        undefined,
        500,
        { requestId }
      )
    }

    // Get client IP address for verification
    const remoteip = getClientIP(request)

    // Log verification attempt (without exposing sensitive data)
    await logger.debug('reCAPTCHA verification attempt', {
      hasToken: !!token,
      tokenLength: token?.length,
      hasRemoteIP: !!remoteip
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
      await logger.error('reCAPTCHA API HTTP error', new Error(`HTTP ${response.status}: ${response.statusText}`), {
        status: response.status,
        statusText: response.statusText
      })
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "reCAPTCHA verification service error",
        `HTTP ${response.status}: ${response.statusText}`,
        500,
        { requestId }
      )
    }

    // Parse JSON response
    let data: any
    try {
      data = await response.json()
    } catch (jsonError) {
      await logger.error('Failed to parse reCAPTCHA response', jsonError instanceof Error ? jsonError : new Error(String(jsonError)))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Invalid response from verification service",
        undefined,
        500,
        { requestId }
      )
    }

    // Validate response structure and success field
    if (!data || typeof data.success !== "boolean") {
      await logger.error('Invalid reCAPTCHA response structure', new Error('Invalid response structure'))
      return errorResponse(
        ErrorCodes.INTERNAL_ERROR,
        "Invalid verification response",
        undefined,
        500,
        { requestId }
      )
    }

    // Check if verification was successful
    if (!data.success) {
      await logger.warn('reCAPTCHA verification failed', {
        errorCodes: data["error-codes"] || [],
        challengeTs: data["challenge_ts"],
        hostname: data.hostname
      })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "reCAPTCHA verification failed",
        undefined,
        400,
        { requestId, "error-codes": data["error-codes"] || [] }
      )
    }

    await logger.info('reCAPTCHA verification successful', {
      challengeTs: data["challenge_ts"],
      hostname: data.hostname
    })

    return successResponse({ verified: true }, { requestId })
  }, { endpoint: getRequestPath(request) })
})

