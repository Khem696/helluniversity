/**
 * Admin Bookings API v1
 * 
 * Versioned endpoint for admin booking management
 * 
 * GET /api/v1/admin/bookings - List all bookings with filters
 * - Requires Google Workspace authentication
 */

import { NextResponse } from "next/server"
import { listBookings } from "@/lib/bookings"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, ErrorCodes } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"
import { createBangkokTimestamp } from "@/lib/timezone"

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

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('Admin bookings list request received')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin bookings list request rejected: authentication failed')
      return authError
    }

    const { searchParams } = new URL(request.url)
    
    // Parse query parameters
    const archive = searchParams.get("archive") === "true"
    const status = searchParams.get("status") as
      | "pending"
      | "pending_deposit"
      | "confirmed"
      | "cancelled"
      | "finished"
      | null
    // CRITICAL: Validate and clamp limit/offset to prevent DoS
    const rawLimit = parseInt(searchParams.get("limit") || "50")
    const rawOffset = parseInt(searchParams.get("offset") || "0")
    const limit = isNaN(rawLimit) ? 50 : Math.max(1, Math.min(1000, rawLimit))
    const offset = isNaN(rawOffset) ? 0 : Math.max(0, Math.min(1000000, rawOffset))
    const email = searchParams.get("email") || undefined
    const referenceNumber = searchParams.get("referenceNumber") || undefined
    const name = searchParams.get("name") || undefined
    const phone = searchParams.get("phone") || undefined
    const eventType = searchParams.get("eventType") || undefined
    const sortBy = (searchParams.get("sortBy") as "created_at" | "start_date" | "name" | "updated_at") || undefined
    const sortOrder = (searchParams.get("sortOrder") as "ASC" | "DESC") || undefined
    const showOverlappingOnly = searchParams.get("showOverlappingOnly") === "true"

    // Parse date filters (Unix timestamps)
    const startDateFrom = searchParams.get("startDateFrom")
      ? parseInt(searchParams.get("startDateFrom")!)
      : undefined
    const startDateTo = searchParams.get("startDateTo")
      ? parseInt(searchParams.get("startDateTo")!)
      : undefined

    await logger.debug('List bookings filters', {
      archive,
      status,
      limit,
      offset,
      hasEmail: !!email,
      hasReferenceNumber: !!referenceNumber,
      hasName: !!name,
      hasPhone: !!phone,
      hasEventType: !!eventType,
      hasDateFilters: !!(startDateFrom || startDateTo),
      sortBy,
      sortOrder
    })
    
    const result = await listBookings({
      status: status || undefined,
      statuses: archive ? ["finished", "cancelled"] : undefined,
      excludeArchived: !archive, // Exclude archived when not requesting archive
      limit,
      offset,
      email,
      referenceNumber,
      name,
      phone,
      eventType,
      startDateFrom,
      startDateTo,
      sortBy,
      sortOrder,
      showOverlappingOnly,
    })
    
    await logger.info('Bookings list retrieved', { 
      count: result.bookings.length, 
      total: result.total,
      archive 
    })

    // Transform bookings to match frontend interface (convert date strings to Unix timestamps)
    // CRITICAL: Use createBangkokTimestamp to handle YYYY-MM-DD strings in Bangkok timezone
    const transformedBookings = result.bookings.map((booking) => ({
      id: booking.id,
      reference_number: booking.referenceNumber || null,
      name: booking.name,
      email: booking.email,
      phone: booking.phone,
      participants: booking.participants,
      event_type: booking.eventType,
      other_event_type: booking.otherEventType,
      date_range: booking.dateRange ? 1 : 0,
      start_date: booking.startDate ? createBangkokTimestamp(booking.startDate) : 0,
      end_date: booking.endDate ? createBangkokTimestamp(booking.endDate) : null,
      start_time: booking.startTime || "",
      end_time: booking.endTime || "",
      organization_type: booking.organizationType,
      organized_person: booking.organizedPerson,
      introduction: booking.introduction,
      biography: booking.biography,
      special_requests: booking.specialRequests,
      status: booking.status,
      admin_notes: booking.adminNotes,
      response_token: booking.responseToken,
      token_expires_at: booking.tokenExpiresAt,
      proposed_date: booking.proposedDate ? createBangkokTimestamp(booking.proposedDate) : null,
      proposed_end_date: booking.proposedEndDate ? createBangkokTimestamp(booking.proposedEndDate) : null,
      user_response: booking.userResponse,
      response_date: booking.responseDate,
      deposit_evidence_url: booking.depositEvidenceUrl,
      deposit_verified_at: booking.depositVerifiedAt,
      deposit_verified_by: booking.depositVerifiedBy,
      // Preserve boolean value correctly - use explicit check to avoid undefined -> false conversion
      deposit_verified_from_other_channel: booking.depositVerifiedFromOtherChannel === true,
      created_at: booking.createdAt,
      updated_at: booking.updatedAt,
    }))

    return successResponse(
      {
        bookings: transformedBookings,
        pagination: {
          total: result.total,
          limit,
          offset,
          hasMore: offset + limit < result.total,
        },
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

