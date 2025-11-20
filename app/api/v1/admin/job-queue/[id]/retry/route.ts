/**
 * Admin Job Queue Retry Endpoint v1
 * 
 * Allows admins to manually retry failed jobs (e.g., blob cleanup failures)
 * POST /api/v1/admin/job-queue/[id]/retry - Manually retry a failed job
 */

import { NextResponse } from "next/server"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { retryJob } from "@/lib/job-queue"
import crypto from "crypto"

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
 * POST /api/v1/admin/job-queue/[id]/retry
 * Manually retry a failed job
 */
export const POST = withVersioning(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  return withErrorHandling(async () => {
    const { id } = await params
    const requestId = crypto.randomUUID()
    const logger = createRequestLogger(requestId, getRequestPath(request))
    
    await logger.info('Admin retry job request', { jobId: id })
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin retry job rejected: authentication failed', { jobId: id })
      return authError
    }

    const result = await retryJob(id)

    if (!result.success) {
      await logger.warn('Job retry failed', { jobId: id, error: result.error })
      return errorResponse(
        ErrorCodes.VALIDATION_ERROR,
        result.error || "Failed to retry job",
        undefined,
        400,
        { requestId }
      )
    }
    
    await logger.info('Job retried successfully', { jobId: id })

    return successResponse(
      {
        message: "Job retried successfully",
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

