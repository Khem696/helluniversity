import { NextResponse } from "next/server"
import { listBookings, getBookingStatusHistory, getBookingFeeHistory } from "@/lib/bookings"
import { requireAuthorizedDomain } from "@/lib/auth"
import { createRequestLogger } from "@/lib/logger"
import { unauthorizedResponse, forbiddenResponse } from "@/lib/api-response"
import { getRequestPath } from "@/lib/api-versioning"
import { withVersioning } from "@/lib/api-version-wrapper"
import {
  transformBookingToExportRow,
  transformStatusHistoryToExportRow,
  transformFeeHistoryToExportRow,
  EXPORT_FIELDS,
  getDefaultExportFields,
  type ExportStatusHistoryRow,
  type ExportFeeHistoryRow,
} from "@/lib/booking-export"
// @ts-ignore - xlsx types may not be available
import * as XLSX from "xlsx"

/**
 * Admin Bookings Export API (v1)
 * 
 * GET /api/v1/admin/bookings/export - Export bookings as CSV or Excel
 * - Requires Google Workspace authentication
 * - Supports same filters as listBookings
 * - Returns CSV or Excel file download
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
 * Generate CSV content from data
 */
function generateCSV(headers: string[], rows: any[][]): string {
  // Escape CSV values (handle commas, quotes, newlines)
  const escapeCSV = (value: any): string => {
    if (value === null || value === undefined) return ""
    const str = String(value)
    // If contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const csvRows = [
    headers.map(escapeCSV).join(","),
    ...rows.map(row => row.map(escapeCSV).join(",")),
  ]

  // Add BOM for Excel UTF-8 compatibility
  return "\uFEFF" + csvRows.join("\n")
}

/**
 * Generate Excel workbook from data
 */
function generateExcel(
  bookings: ReturnType<typeof transformBookingToExportRow>[],
  statusHistory: ExportStatusHistoryRow[],
  feeHistory: ExportFeeHistoryRow[],
  selectedFields: string[]
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new()

  // Sheet 1: Bookings
  const bookingHeaders = selectedFields.map(field => {
    const fieldDef = EXPORT_FIELDS.find(f => f.key === field)
    return fieldDef ? fieldDef.label : field
  })
  const bookingRows = bookings.map(booking =>
    selectedFields.map(field => (booking as any)[field] || "")
  )
  const bookingSheet = XLSX.utils.aoa_to_sheet([bookingHeaders, ...bookingRows])
  
  // Set column widths (auto-size)
  const maxWidths = bookingHeaders.map((_, colIndex) => {
    const column = bookingRows.map(row => String(row[colIndex] || ""))
    const maxLength = Math.max(
      bookingHeaders[colIndex].length,
      ...column.map(cell => cell.length)
    )
    return { wch: Math.min(Math.max(maxLength + 2, 10), 50) }
  })
  bookingSheet["!cols"] = maxWidths
  
  XLSX.utils.book_append_sheet(workbook, bookingSheet, "Bookings")

  // Sheet 2: Status History (if any)
  if (statusHistory.length > 0) {
    const statusHeaders = [
      "Reference Number",
      "Booking ID",
      "Old Status",
      "New Status",
      "Changed By",
      "Change Reason",
      "Change Date",
    ]
    const statusRows = statusHistory.map(history => [
      history.referenceNumber,
      history.bookingId,
      history.oldStatus,
      history.newStatus,
      history.changedBy,
      history.changeReason,
      history.changeDate,
    ])
    const statusSheet = XLSX.utils.aoa_to_sheet([statusHeaders, ...statusRows])
    
    // Set column widths
    const statusMaxWidths = statusHeaders.map((_, colIndex) => {
      const column = statusRows.map(row => String(row[colIndex] || ""))
      const maxLength = Math.max(
        statusHeaders[colIndex].length,
        ...column.map(cell => cell.length)
      )
      return { wch: Math.min(Math.max(maxLength + 2, 10), 50) }
    })
    statusSheet["!cols"] = statusMaxWidths
    
    XLSX.utils.book_append_sheet(workbook, statusSheet, "Status History")
  }

  // Sheet 3: Fee History (if any)
  if (feeHistory.length > 0) {
    const feeHeaders = [
      "Reference Number",
      "Booking ID",
      "Old Fee Amount (THB)",
      "Old Fee Amount Original",
      "Old Fee Currency",
      "Old Conversion Rate",
      "New Fee Amount (THB)",
      "New Fee Amount Original",
      "New Fee Currency",
      "New Conversion Rate",
      "Changed By",
      "Change Reason",
      "Change Date",
      "Status At Change",
      "Is Restoration Change",
    ]
    const feeRows = feeHistory.map(history => [
      history.referenceNumber,
      history.bookingId,
      history.oldFeeAmountTHB,
      history.oldFeeAmountOriginal,
      history.oldFeeCurrency,
      history.oldFeeConversionRate,
      history.newFeeAmountTHB,
      history.newFeeAmountOriginal,
      history.newFeeCurrency,
      history.newFeeConversionRate,
      history.changedBy,
      history.changeReason,
      history.changeDate,
      history.statusAtChange,
      history.isRestorationChange,
    ])
    const feeSheet = XLSX.utils.aoa_to_sheet([feeHeaders, ...feeRows])
    
    // Set column widths
    const feeMaxWidths = feeHeaders.map((_, colIndex) => {
      const column = feeRows.map(row => String(row[colIndex] || ""))
      const maxLength = Math.max(
        feeHeaders[colIndex].length,
        ...column.map(cell => cell.length)
      )
      return { wch: Math.min(Math.max(maxLength + 2, 10), 50) }
    })
    feeSheet["!cols"] = feeMaxWidths
    
    XLSX.utils.book_append_sheet(workbook, feeSheet, "Fee History")
  }

  return workbook
}

export const GET = withVersioning(async (request: Request) => {
  const requestId = crypto.randomUUID()
  const endpoint = getRequestPath(request)
  const logger = createRequestLogger(requestId, endpoint)
  
  try {
    await logger.info('Admin bookings export request received (v1)')
    
    const authError = await checkAuth(requestId)
    if (authError) {
      await logger.warn('Admin bookings export request rejected: authentication failed')
      return authError
    }

    const { searchParams } = new URL(request.url)
    
    // Parse export format
    const format = searchParams.get("format") || "csv"
    if (format !== "csv" && format !== "excel") {
      return NextResponse.json(
        { 
          success: false, 
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid format. Must be 'csv' or 'excel'"
          }
        },
        { status: 400 }
      )
    }

    // Parse field selection
    const fieldsParam = searchParams.get("fields")
    const selectedFields = fieldsParam
      ? fieldsParam.split(",").filter(f => EXPORT_FIELDS.some(def => def.key === f))
      : getDefaultExportFields()

    // Parse include history flags
    const includeStatusHistory = searchParams.get("includeStatusHistory") === "true"
    const includeFeeHistory = searchParams.get("includeFeeHistory") === "true"

    // Parse filters (same as listBookings)
    const archive = searchParams.get("archive") === "true"
    const status = searchParams.get("status") as
      | "pending"
      | "pending_deposit"
      | "paid_deposit"
      | "confirmed"
      | "cancelled"
      | "finished"
      | null
    const email = searchParams.get("email") || undefined
    const referenceNumber = searchParams.get("referenceNumber") || undefined
    const name = searchParams.get("name") || undefined
    const phone = searchParams.get("phone") || undefined
    const eventType = searchParams.get("eventType") || undefined
    const sortBy = (searchParams.get("sortBy") as "created_at" | "start_date" | "name" | "updated_at") || undefined
    const sortOrder = (searchParams.get("sortOrder") as "ASC" | "DESC") || undefined
    const showOverlappingOnly = searchParams.get("showOverlappingOnly") === "true"

    // Parse date filters
    const startDateFrom = searchParams.get("startDateFrom")
      ? parseInt(searchParams.get("startDateFrom")!)
      : undefined
    const startDateTo = searchParams.get("startDateTo")
      ? parseInt(searchParams.get("startDateTo")!)
      : undefined

    await logger.debug('Export filters', {
      format,
      selectedFieldsCount: selectedFields.length,
      includeStatusHistory,
      includeFeeHistory,
      archive,
      status,
      hasEmail: !!email,
      hasReferenceNumber: !!referenceNumber,
      hasName: !!name,
      hasPhone: !!phone,
      hasEventType: !!eventType,
    })

    // Fetch all bookings matching filters (no pagination limit for export)
    // Use a high limit to get all bookings
    const result = await listBookings({
      status: status || undefined,
      statuses: archive ? ["finished", "cancelled"] : undefined,
      excludeArchived: !archive,
      limit: 10000, // High limit for export
      offset: 0,
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

    await logger.info('Bookings fetched for export', {
      count: result.bookings.length,
      total: result.total,
    })

    // Transform bookings to export rows
    const exportBookings = result.bookings.map(transformBookingToExportRow)

    // Prepare headers
    const headers = selectedFields.map(field => {
      const fieldDef = EXPORT_FIELDS.find(f => f.key === field)
      return fieldDef ? fieldDef.label : field
    })

    // Prepare rows
    const rows = exportBookings.map(booking =>
      selectedFields.map(field => (booking as any)[field] || "")
    )

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5)
    const filename = `bookings_${timestamp}.${format === "excel" ? "xlsx" : "csv"}`

    if (format === "csv") {
      // Generate CSV
      const csvContent = generateCSV(headers, rows)

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      })
    } else {
      // Generate Excel with history if requested
      let statusHistoryRows: ExportStatusHistoryRow[] = []
      let feeHistoryRows: ExportFeeHistoryRow[] = []

      if (includeStatusHistory || includeFeeHistory) {
        // Fetch history for all bookings
        const historyPromises = result.bookings.map(async (booking) => {
          const [statusHistory, feeHistory] = await Promise.all([
            includeStatusHistory ? getBookingStatusHistory(booking.id) : Promise.resolve([]),
            includeFeeHistory ? getBookingFeeHistory(booking.id) : Promise.resolve([]),
          ])

          return {
            bookingId: booking.id,
            referenceNumber: booking.referenceNumber || "",
            statusHistory,
            feeHistory,
          }
        })

        const historyResults = await Promise.all(historyPromises)

        // Transform history
        if (includeStatusHistory) {
          statusHistoryRows = historyResults.flatMap(result =>
            result.statusHistory.map(history =>
              transformStatusHistoryToExportRow(history, result.referenceNumber)
            )
          )
        }

        if (includeFeeHistory) {
          feeHistoryRows = historyResults.flatMap(result =>
            result.feeHistory.map(history =>
              transformFeeHistoryToExportRow(history, result.referenceNumber)
            )
          )
        }
      }

      // Generate Excel workbook
      const workbook = generateExcel(exportBookings, statusHistoryRows, feeHistoryRows, selectedFields)

      // Convert to buffer
      const excelBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })

      return new NextResponse(excelBuffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      })
    }
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error))
    await logger.error('Export error', errorObj)
    return NextResponse.json(
      { 
        success: false, 
        error: {
          code: "EXPORT_ERROR",
          message: errorObj.message || "Failed to export bookings"
        }
      },
      { status: 500 }
    )
  }
})

