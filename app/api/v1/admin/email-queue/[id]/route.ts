/**
 * Admin Email Queue Item API v1
 * 
 * Versioned endpoint for individual email queue item management
 * Maintains backward compatibility with /api/admin/email-queue/[id]
 * 
 * GET /api/v1/admin/email-queue/[id] - Get email queue item details
 * POST /api/v1/admin/email-queue/[id] - Retry specific email
 * DELETE /api/v1/admin/email-queue/[id] - Delete email queue item
 */

import { NextResponse } from "next/server"
import { requireAuthorizedDomain } from "@/lib/auth"
import { getEmailQueueItem, retryEmail, cancelEmail, deleteEmail } from "@/lib/email-queue"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, notFoundResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"

/**
 * Admin Email Queue Item Management API
 * 
 * GET /api/admin/email-queue/[id] - Get specific email queue item
 * POST /api/admin/email-queue/[id] - Retry specific email
 * PATCH /api/admin/email-queue/[id] - Update email status (cancel/retry)
 * DELETE /api/admin/email-queue/[id] - Delete email from queue
 * - All routes require Google Workspace authentication
 */

async function checkAuth(requestId: string) {
  try {
    await requireAuthorizedDomain()
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return unauthorizedResponse("Authentication required", { requestId })
    }
    return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain", { requestId })
  }
  return null
}

/**
 * GET /api/admin/email-queue/[id]
 * Get specific email queue item
 */
export const GET = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin get email queue item request', { emailId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin get email queue item rejected: authentication failed', { emailId: id })
      return authError
    }

    const email = await getEmailQueueItem(id)

    if (!email) {
      await logger.warn('Email queue item not found', { emailId: id })
      return notFoundResponse('Email queue item', { requestId })
    }
    
    await logger.info('Email queue item retrieved', { emailId: id })

    return successResponse(
      {
        email,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

/**
 * POST /api/admin/email-queue/[id]/retry
 * Manually retry a specific email
 */
export const POST = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin retry email request', { emailId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin retry email rejected: authentication failed', { emailId: id })
      return authError
    }

    const result = await retryEmail(id)

    if (!result.success) {
      await logger.warn('Email retry failed', { emailId: id, error: result.error })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        result.error || "Failed to retry email",
        undefined,
        400,
        { requestId }
      )
    }
    
    await logger.info('Email retried successfully', { emailId: id })

    return successResponse(
      {
        message: "Email retried successfully",
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

/**
 * DELETE /api/admin/email-queue/[id]
 * Delete an email from queue
 */
export const DELETE = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin delete email request', { emailId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin delete email rejected: authentication failed', { emailId: id })
      return authError
    }

    await deleteEmail(id)
    
    await logger.info('Email deleted successfully', { emailId: id })

    return successResponse(
      {
        message: "Email deleted successfully",
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

/**
 * PATCH /api/admin/email-queue/[id]
 * Update email status (cancel)
 */
export const PATCH = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin update email request', { emailId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin update email rejected: authentication failed', { emailId: id })
      return authError
    }

    let body: { action?: string } = {}
    try {
      body = await request.json()
    } catch (jsonError) {
      await logger.warn('Invalid request body', { emailId: id })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid request body",
        undefined,
        400,
        { requestId }
      )
    }
    
    const { action } = body
    
    await logger.debug('Email update action', { emailId: id, action })

    if (action === "cancel") {
      await logger.info('Cancelling email', { emailId: id })
      await cancelEmail(id)
      await logger.info('Email cancelled successfully', { emailId: id })
      return successResponse(
        {
          message: "Email cancelled successfully",
        },
        { requestId }
      )
    } else if (action === "retry") {
      await logger.info('Retrying email', { emailId: id })
      const result = await retryEmail(id)
      if (!result.success) {
        await logger.warn('Email retry failed', { emailId: id, error: result.error })
        return errorResponse(
          ErrorCodes.VALIDATION_ERROR,
          result.error || "Failed to retry email",
          undefined,
          400,
          { requestId }
        )
      }
      await logger.info('Email retried successfully', { emailId: id })
      return successResponse(
        {
          message: "Email retried successfully",
        },
        { requestId }
      )
    }

    await logger.warn('Invalid action provided', { emailId: id, action })
    return errorResponse(
      ErrorCodes.VALIDATION_ERROR,
      "Invalid action. Expected 'cancel' or 'retry'",
      undefined,
      400,
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

