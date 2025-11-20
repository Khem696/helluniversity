/**
 * Booking Export Utilities
 * 
 * Handles data transformation and formatting for CSV/Excel exports
 */

import { Booking, BookingStatusHistory, BookingFeeHistory } from "./bookings"
import { format } from "date-fns"
import { TZDate } from "@date-fns/tz"

/**
 * Format timestamp to readable date (YYYY-MM-DD)
 */
export function formatExportDate(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || timestamp === 0) return ""
  try {
    const timestampMs = timestamp > 1000000000000 ? timestamp : timestamp * 1000
    const utcDate = new Date(timestampMs)
    const bangkokDate = new TZDate(utcDate.getTime(), 'Asia/Bangkok')
    return format(bangkokDate, "yyyy-MM-dd")
  } catch (error) {
    return ""
  }
}

/**
 * Format timestamp to readable datetime (YYYY-MM-DD HH:MM:SS)
 */
export function formatExportDateTime(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || timestamp === 0) return ""
  try {
    const timestampMs = timestamp > 1000000000000 ? timestamp : timestamp * 1000
    const utcDate = new Date(timestampMs)
    const bangkokDate = new TZDate(utcDate.getTime(), 'Asia/Bangkok')
    return format(bangkokDate, "yyyy-MM-dd HH:mm:ss")
  } catch (error) {
    return ""
  }
}

/**
 * Format time (HH:MM)
 */
export function formatExportTime(time: string | null | undefined): string {
  if (!time) return ""
  return time
}

/**
 * Format currency amount with 2 decimal places
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return ""
  return amount.toFixed(2)
}

/**
 * Format conversion rate with 4-6 decimal places
 */
export function formatConversionRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return ""
  return rate.toFixed(6)
}

/**
 * Combine event type with other event type
 */
export function formatEventType(eventType: string, otherEventType?: string | null): string {
  if (otherEventType) {
    return `${eventType} - ${otherEventType}`
  }
  return eventType
}

/**
 * Format user response for export
 */
export function formatUserResponse(userResponse: string | null | undefined): string {
  if (!userResponse) return ""
  
  const lower = userResponse.toLowerCase()
  if (lower.includes("accepted")) return "Accepted"
  if (lower.includes("rejected") || lower.includes("declined")) return "Rejected"
  if (lower.includes("proposed") || lower.includes("alternative")) return "Proposed Alternative"
  if (lower.includes("cancelled") || lower.includes("canceled")) return "Cancelled"
  
  return userResponse
}

/**
 * Format boolean to Yes/No
 */
export function formatBoolean(value: boolean | null | undefined): string {
  if (value === true) return "Yes"
  if (value === false) return "No"
  return ""
}

/**
 * Format status to human-readable
 */
export function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    pending: "Pending",
    pending_deposit: "Pending Deposit",
    paid_deposit: "Paid Deposit",
    confirmed: "Confirmed",
    cancelled: "Cancelled",
    finished: "Finished",
  }
  return statusMap[status] || status
}

/**
 * Transform booking to export row format
 */
export interface ExportBookingRow {
  referenceNumber: string
  name: string
  email: string
  phone: string
  eventType: string
  status: string
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  participants: string
  organizationType: string
  organizedPerson: string
  dateRangeType: string
  introduction: string
  biography: string
  specialRequests: string
  adminNotes: string
  feeAmountTHB: string
  feeCurrency: string
  feeAmountOriginal: string
  feeConversionRate: string
  feeRecordedDate: string
  feeRecordedBy: string
  feeNotes: string
  depositVerified: string
  depositVerifiedDate: string
  depositVerifiedBy: string
  depositVerifiedMethod: string
  proposedDate: string
  userResponse: string
  responseDate: string
  createdDate: string
  updatedDate: string
}

/**
 * Transform booking to export row
 */
export function transformBookingToExportRow(booking: Booking): ExportBookingRow {
  // Helper to convert date string (YYYY-MM-DD) or timestamp to date string
  const normalizeDate = (date: string | number | null | undefined): string => {
    if (!date) return ""
    if (typeof date === 'string') {
      // Already a date string (YYYY-MM-DD), return as-is
      return date
    }
    // It's a timestamp, convert to date string
    return formatExportDate(date)
  }

  return {
    referenceNumber: booking.referenceNumber || "",
    name: booking.name || "",
    email: booking.email || "",
    phone: booking.phone || "",
    eventType: formatEventType(booking.eventType, booking.otherEventType),
    status: formatStatus(booking.status),
    startDate: normalizeDate(booking.startDate as any),
    endDate: normalizeDate(booking.endDate as any),
    startTime: formatExportTime(booking.startTime),
    endTime: formatExportTime(booking.endTime),
    participants: booking.participants || "",
    organizationType: booking.organizationType || "",
    organizedPerson: booking.organizedPerson || "",
    dateRangeType: booking.dateRange ? "Multiple Days" : "Single Day",
    introduction: booking.introduction || "",
    biography: booking.biography || "",
    specialRequests: booking.specialRequests || "",
    adminNotes: booking.adminNotes || "",
    feeAmountTHB: formatCurrency(booking.feeAmount),
    feeCurrency: booking.feeCurrency || "",
    feeAmountOriginal: formatCurrency(booking.feeAmountOriginal),
    feeConversionRate: formatConversionRate(booking.feeConversionRate),
    feeRecordedDate: formatExportDateTime(booking.feeRecordedAt),
    feeRecordedBy: booking.feeRecordedBy || "",
    feeNotes: booking.feeNotes || "",
    depositVerified: formatBoolean(booking.depositEvidenceUrl ? true : false),
    depositVerifiedDate: formatExportDateTime(booking.depositVerifiedAt),
    depositVerifiedBy: booking.depositVerifiedBy || "",
    depositVerifiedMethod: booking.depositVerifiedFromOtherChannel ? "Other Channel" : (booking.depositVerifiedAt ? "System Upload" : ""),
    proposedDate: normalizeDate(booking.proposedDate as any),
    userResponse: formatUserResponse(booking.userResponse),
    responseDate: formatExportDateTime(booking.responseDate),
    createdDate: formatExportDateTime(booking.createdAt),
    updatedDate: formatExportDateTime(booking.updatedAt),
  }
}

/**
 * Export field definitions
 */
export interface ExportField {
  key: keyof ExportBookingRow
  label: string
  category: "essential" | "financial" | "operational" | "content"
}

export const EXPORT_FIELDS: ExportField[] = [
  // Essential
  { key: "referenceNumber", label: "Reference Number", category: "essential" },
  { key: "name", label: "Name", category: "essential" },
  { key: "email", label: "Email", category: "essential" },
  { key: "phone", label: "Phone", category: "essential" },
  { key: "eventType", label: "Event Type", category: "essential" },
  { key: "status", label: "Status", category: "essential" },
  { key: "startDate", label: "Start Date", category: "essential" },
  { key: "endDate", label: "End Date", category: "essential" },
  { key: "startTime", label: "Start Time", category: "essential" },
  { key: "endTime", label: "End Time", category: "essential" },
  { key: "createdDate", label: "Created Date", category: "essential" },
  { key: "updatedDate", label: "Updated Date", category: "essential" },
  
  // Financial
  { key: "feeAmountTHB", label: "Fee Amount (THB)", category: "financial" },
  { key: "feeCurrency", label: "Fee Currency", category: "financial" },
  { key: "feeAmountOriginal", label: "Fee Amount Original", category: "financial" },
  { key: "feeConversionRate", label: "Fee Conversion Rate", category: "financial" },
  { key: "feeRecordedDate", label: "Fee Recorded Date", category: "financial" },
  { key: "feeRecordedBy", label: "Fee Recorded By", category: "financial" },
  { key: "feeNotes", label: "Fee Notes", category: "financial" },
  
  // Operational
  { key: "participants", label: "Participants", category: "operational" },
  { key: "organizationType", label: "Organization Type", category: "operational" },
  { key: "organizedPerson", label: "Organized Person", category: "operational" },
  { key: "dateRangeType", label: "Date Range Type", category: "operational" },
  { key: "depositVerified", label: "Deposit Verified", category: "operational" },
  { key: "depositVerifiedDate", label: "Deposit Verified Date", category: "operational" },
  { key: "depositVerifiedBy", label: "Deposit Verified By", category: "operational" },
  { key: "depositVerifiedMethod", label: "Deposit Verified Method", category: "operational" },
  { key: "proposedDate", label: "Proposed Date", category: "operational" },
  { key: "userResponse", label: "User Response", category: "operational" },
  { key: "responseDate", label: "Response Date", category: "operational" },
  
  // Content
  { key: "introduction", label: "Introduction", category: "content" },
  { key: "biography", label: "Biography", category: "content" },
  { key: "specialRequests", label: "Special Requests", category: "content" },
  { key: "adminNotes", label: "Admin Notes", category: "content" },
]

/**
 * Get default fields for export (essential + financial)
 */
export function getDefaultExportFields(): string[] {
  return EXPORT_FIELDS
    .filter(field => field.category === "essential" || field.category === "financial")
    .map(field => field.key)
}

/**
 * Transform status history to export row
 */
export interface ExportStatusHistoryRow {
  referenceNumber: string
  bookingId: string
  oldStatus: string
  newStatus: string
  changedBy: string
  changeReason: string
  changeDate: string
}

export function transformStatusHistoryToExportRow(
  history: BookingStatusHistory,
  referenceNumber: string
): ExportStatusHistoryRow {
  return {
    referenceNumber: referenceNumber || "",
    bookingId: history.bookingId,
    oldStatus: formatStatus(history.oldStatus || ""),
    newStatus: formatStatus(history.newStatus),
    changedBy: history.changedBy || "",
    changeReason: history.changeReason || "",
    changeDate: formatExportDateTime(history.createdAt),
  }
}

/**
 * Transform fee history to export row
 */
export interface ExportFeeHistoryRow {
  referenceNumber: string
  bookingId: string
  oldFeeAmountTHB: string
  oldFeeAmountOriginal: string
  oldFeeCurrency: string
  oldFeeConversionRate: string
  newFeeAmountTHB: string
  newFeeAmountOriginal: string
  newFeeCurrency: string
  newFeeConversionRate: string
  changedBy: string
  changeReason: string
  changeDate: string
  statusAtChange: string
  isRestorationChange: string
}

export function transformFeeHistoryToExportRow(
  history: BookingFeeHistory,
  referenceNumber: string
): ExportFeeHistoryRow {
  return {
    referenceNumber: referenceNumber || "",
    bookingId: history.bookingId,
    oldFeeAmountTHB: formatCurrency(history.oldFeeAmount),
    oldFeeAmountOriginal: formatCurrency(history.oldFeeAmountOriginal),
    oldFeeCurrency: history.oldFeeCurrency || "",
    oldFeeConversionRate: formatConversionRate(history.oldFeeConversionRate),
    newFeeAmountTHB: formatCurrency(history.newFeeAmount),
    newFeeAmountOriginal: formatCurrency(history.newFeeAmountOriginal),
    newFeeCurrency: history.newFeeCurrency || "",
    newFeeConversionRate: formatConversionRate(history.newFeeConversionRate),
    changedBy: history.changedBy,
    changeReason: history.changeReason || "",
    changeDate: formatExportDateTime(history.createdAt),
    statusAtChange: formatStatus(history.bookingStatusAtChange),
    isRestorationChange: formatBoolean(history.isRestorationChange),
  }
}

