import { ConditionalHeader } from "./ConditionalHeader"
import { getBookingEnabledStatus } from "@/lib/server-data"

/**
 * Server Component wrapper for ConditionalHeader
 * Fetches booking status server-side for instant display
 */
export async function ConditionalHeaderWrapper() {
  const bookingEnabled = await getBookingEnabledStatus()
  
  return <ConditionalHeader initialBookingEnabled={bookingEnabled} />
}

