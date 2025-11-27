/**
 * Booking SSE Data Preparation
 * 
 * Shared utility for preparing booking data for SSE broadcasts.
 * Ensures consistent data format across all SSE events.
 */

/**
 * Prepare booking data from database row for SSE broadcast
 * Converts database row (with Unix timestamps) to SSE payload format
 * 
 * @param dbRow - Raw database row from bookings table
 * @returns Booking data object ready for SSE broadcast
 */
export function prepareBookingDataForSSE(dbRow: any): {
  id: string
  reference_number: string | null
  name: string
  email: string
  phone: string | null
  participants: number | null
  event_type: string
  other_event_type: string | null
  date_range: number
  start_date: number | null
  end_date: number | null
  start_time: string | null
  end_time: string | null
  organization_type: string | null
  organized_person: string | null
  introduction: string | null
  biography: string | null
  special_requests: string | null
  status: string
  admin_notes: string | null
  response_token: string | null
  token_expires_at: number | null
  proposed_date: number | null
  proposed_end_date: number | null
  user_response: string | null
  response_date: number | null
  deposit_evidence_url: string | null
  deposit_verified_at: number | null
  deposit_verified_by: string | null
  deposit_verified_from_other_channel: boolean
  fee_amount: number | null
  fee_amount_original: number | null
  fee_currency: string | null
  fee_conversion_rate: number | null
  fee_rate_date: number | null
  fee_recorded_at: number | null
  fee_recorded_by: string | null
  fee_notes: string | null
  created_at: number
  updated_at: number
} {
  // FIXED: Add fallbacks for required fields to prevent type violations (Bug #80)
  // While these should always exist in database rows, defensive fallbacks prevent runtime errors
  const now = Math.floor(Date.now() / 1000)
  return {
    id: dbRow.id || '',
    reference_number: dbRow.reference_number ?? null,
    name: dbRow.name || '',
    email: dbRow.email || '',
    phone: dbRow.phone ?? null,
    participants: dbRow.participants ?? null,
    event_type: dbRow.event_type || '',
    other_event_type: dbRow.other_event_type ?? null,
    date_range: dbRow.date_range ?? 0,
    start_date: dbRow.start_date ?? null,
    end_date: dbRow.end_date ?? null,
    start_time: dbRow.start_time ?? null,
    end_time: dbRow.end_time ?? null,
    organization_type: dbRow.organization_type ?? null,
    organized_person: dbRow.organized_person ?? null,
    introduction: dbRow.introduction ?? null,
    biography: dbRow.biography ?? null,
    special_requests: dbRow.special_requests ?? null,
    status: dbRow.status || '',
    admin_notes: dbRow.admin_notes ?? null,
    response_token: dbRow.response_token ?? null,
    token_expires_at: dbRow.token_expires_at ?? null,
    proposed_date: dbRow.proposed_date ?? null,
    proposed_end_date: dbRow.proposed_end_date ?? null,
    user_response: dbRow.user_response ?? null,
    response_date: dbRow.response_date ?? null,
    deposit_evidence_url: dbRow.deposit_evidence_url ?? null,
    deposit_verified_at: dbRow.deposit_verified_at ?? null,
    deposit_verified_by: dbRow.deposit_verified_by ?? null,
    deposit_verified_from_other_channel: dbRow.deposit_verified_from_other_channel ?? false,
    fee_amount: dbRow.fee_amount ?? null,
    fee_amount_original: dbRow.fee_amount_original ?? null,
    fee_currency: dbRow.fee_currency ?? null,
    fee_conversion_rate: dbRow.fee_conversion_rate ?? null,
    fee_rate_date: dbRow.fee_rate_date ?? null,
    fee_recorded_at: dbRow.fee_recorded_at ?? null,
    fee_recorded_by: dbRow.fee_recorded_by ?? null,
    fee_notes: dbRow.fee_notes ?? null,
    created_at: dbRow.created_at || now,
    updated_at: dbRow.updated_at || now,
  }
}


