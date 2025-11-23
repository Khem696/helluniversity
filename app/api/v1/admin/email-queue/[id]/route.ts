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

    // Get admin info from session
    let adminEmail: string | undefined
    let adminName: string | undefined
    try {
      const { getAuthSession } = await import('@/lib/auth')
      const session = await getAuthSession()
      if (session?.user) {
        adminEmail = session.user.email || undefined
        adminName = session.user.name || undefined
      }
    } catch (sessionError) {
      await logger.warn("Could not get session for admin action logging", { error: sessionError instanceof Error ? sessionError.message : String(sessionError) })
    }

    // CRITICAL: Acquire action lock to prevent concurrent retries
    let actionLockId: string | null = null
    if (adminEmail) {
      try {
        const { acquireActionLock, releaseActionLock } = await import('@/lib/action-lock')
        actionLockId = await acquireActionLock('email', id, 'retry', adminEmail, adminName)
        
        if (!actionLockId) {
          await logger.warn('Action lock acquisition failed: another admin is performing this action', {
            emailId: id,
            action: 'retry',
            adminEmail
          })
          return errorResponse(
            ErrorCodes.CONFLICT,
            "Another admin is currently performing this action on this email. Please wait a moment and try again.",
            undefined,
            409,
            { requestId }
          )
        }
        await logger.debug('Action lock acquired', { emailId: id, action: 'retry', lockId: actionLockId })
      } catch (lockError) {
        await logger.warn('Failed to acquire action lock, falling back to optimistic locking', {
          error: lockError instanceof Error ? lockError.message : String(lockError),
          emailId: id
        })
      }
    }
    
    // Ensure lock is released even if retry fails
    const releaseLock = async () => {
      if (actionLockId && adminEmail) {
        try {
          const { releaseActionLock } = await import('@/lib/action-lock')
          await releaseActionLock(actionLockId, adminEmail)
          await logger.debug('Action lock released', { emailId: id, lockId: actionLockId })
        } catch (releaseError) {
          await logger.warn('Failed to release action lock', {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
            emailId: id,
            lockId: actionLockId
          })
        }
      }
    }

    try {
      const result = await retryEmail(id)

      if (!result.success) {
        await releaseLock()
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
      await releaseLock()

      return successResponse(
        {
          message: "Email retried successfully",
        },
        { requestId }
      )
    } catch (error) {
      await releaseLock()
      throw error
    }
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

    // Get admin info from session
    let adminEmail: string | undefined
    let adminName: string | undefined
    try {
      const { getAuthSession } = await import('@/lib/auth')
      const session = await getAuthSession()
      if (session?.user) {
        adminEmail = session.user.email || undefined
        adminName = session.user.name || undefined
      }
    } catch (sessionError) {
      await logger.warn("Could not get session for admin action logging", { error: sessionError instanceof Error ? sessionError.message : String(sessionError) })
    }

    // CRITICAL: Acquire action lock to prevent concurrent deletions
    let actionLockId: string | null = null
    if (adminEmail) {
      try {
        const { acquireActionLock, releaseActionLock } = await import('@/lib/action-lock')
        actionLockId = await acquireActionLock('email', id, 'delete', adminEmail, adminName)
        
        if (!actionLockId) {
          await logger.warn('Action lock acquisition failed: another admin is performing this action', {
            emailId: id,
            action: 'delete',
            adminEmail
          })
          return errorResponse(
            ErrorCodes.CONFLICT,
            "Another admin is currently performing this action on this email. Please wait a moment and try again.",
            undefined,
            409,
            { requestId }
          )
        }
        await logger.debug('Action lock acquired', { emailId: id, action: 'delete', lockId: actionLockId })
      } catch (lockError) {
        await logger.warn('Failed to acquire action lock, falling back to optimistic locking', {
          error: lockError instanceof Error ? lockError.message : String(lockError),
          emailId: id
        })
      }
    }
    
    // Ensure lock is released even if deletion fails
    const releaseLock = async () => {
      if (actionLockId && adminEmail) {
        try {
          const { releaseActionLock } = await import('@/lib/action-lock')
          await releaseActionLock(actionLockId, adminEmail)
          await logger.debug('Action lock released', { emailId: id, lockId: actionLockId })
        } catch (releaseError) {
          await logger.warn('Failed to release action lock', {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
            emailId: id,
            lockId: actionLockId
          })
        }
      }
    }

    try {
      await deleteEmail(id)
      await logger.info('Email deleted successfully', { emailId: id })
      await releaseLock()
    } catch (error) {
      await releaseLock()
      throw error
    }

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

    // CRITICAL: Use safe JSON parsing with size limits to prevent DoS
    let body: { action?: string } = {}
    try {
      const { safeParseJSON } = await import('@/lib/safe-json-parse')
      body = await safeParseJSON(request, 10240) // 10KB limit for email queue action data
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await logger.warn('Request body parsing failed', new Error(errorMessage))
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        errorMessage.includes('too large') 
          ? 'Request body is too large. Please reduce the size of your submission.'
          : 'Invalid request format. Please check your input and try again.',
        undefined,
        400,
        { requestId }
      )
    }
    
    const { action } = body
    
    await logger.debug('Email update action', { emailId: id, action })

    // Get admin info from session
    let adminEmail: string | undefined
    let adminName: string | undefined
    try {
      const { getAuthSession } = await import('@/lib/auth')
      const session = await getAuthSession()
      if (session?.user) {
        adminEmail = session.user.email || undefined
        adminName = session.user.name || undefined
      }
    } catch (sessionError) {
      await logger.warn("Could not get session for admin action logging", { error: sessionError instanceof Error ? sessionError.message : String(sessionError) })
    }

    // CRITICAL: Acquire action lock to prevent concurrent actions
    let actionLockId: string | null = null
    if (adminEmail) {
      try {
        const { acquireActionLock, releaseActionLock } = await import('@/lib/action-lock')
        const actionType = action || 'update'
        actionLockId = await acquireActionLock('email', id, actionType, adminEmail, adminName)
        
        if (!actionLockId) {
          await logger.warn('Action lock acquisition failed: another admin is performing this action', {
            emailId: id,
            action: actionType,
            adminEmail
          })
          return errorResponse(
            ErrorCodes.CONFLICT,
            "Another admin is currently performing this action on this email. Please wait a moment and try again.",
            undefined,
            409,
            { requestId }
          )
        }
        await logger.debug('Action lock acquired', { emailId: id, action: actionType, lockId: actionLockId })
      } catch (lockError) {
        await logger.warn('Failed to acquire action lock, falling back to optimistic locking', {
          error: lockError instanceof Error ? lockError.message : String(lockError),
          emailId: id
        })
      }
    }
    
    // Ensure lock is released even if action fails
    const releaseLock = async () => {
      if (actionLockId && adminEmail) {
        try {
          const { releaseActionLock } = await import('@/lib/action-lock')
          await releaseActionLock(actionLockId, adminEmail)
          await logger.debug('Action lock released', { emailId: id, lockId: actionLockId })
        } catch (releaseError) {
          await logger.warn('Failed to release action lock', {
            error: releaseError instanceof Error ? releaseError.message : String(releaseError),
            emailId: id,
            lockId: actionLockId
          })
        }
      }
    }

    try {
      if (action === "cancel") {
      await logger.info('Cancelling email', { emailId: id })
      await cancelEmail(id)
        await logger.info('Email cancelled successfully', { emailId: id })
        await releaseLock()
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
          await releaseLock()
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
        await releaseLock()
        return successResponse(
          {
            message: "Email retried successfully",
          },
          { requestId }
        )
      }

      await releaseLock()
      await logger.warn('Invalid action provided', { emailId: id, action })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        "Invalid action. Expected 'cancel' or 'retry'",
        undefined,
        400,
        { requestId }
      )
    } catch (error) {
      await releaseLock()
      throw error
    }
  }, { endpoint: getRequestPath(request) })
})

