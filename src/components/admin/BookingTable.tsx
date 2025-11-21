"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Loader2,
  Calendar,
  Mail,
  Phone,
  Users,
  Clock,
  Eye,
  Trash2,
  AlertCircle,
} from "lucide-react"
import { SearchHighlight } from "./SearchHighlight"
import {
  formatTimeForDisplay,
  formatDate,
  formatTimestamp,
  formatFee,
  getStatusBadge,
  getBookingReferenceNumber,
} from "@/lib/booking-helpers"
import type { Booking as BookingType } from "@/hooks/useInfiniteAdminBookings"

type Booking = BookingType

interface BookingTableProps {
  bookings: Booking[]
  total: number
  loading: boolean
  hasMore: boolean
  pageSize: number
  onPageSizeChange: (size: number) => void
  onViewBooking: (bookingId: string) => Promise<void>
  onDeleteBooking: (bookingId: string) => void
  saving: boolean
  scrollSentinelRef: React.RefObject<HTMLDivElement | null>
  // Search filters for highlighting
  referenceNumberFilter: string
  nameFilter: string
  emailFilter: string
  phoneFilter: string
  // For highlighting new responses
  lastCheckedAt: number
}

export function BookingTable({
  bookings,
  total,
  loading,
  hasMore,
  pageSize,
  onPageSizeChange,
  onViewBooking,
  onDeleteBooking,
  saving,
  scrollSentinelRef,
  referenceNumberFilter,
  nameFilter,
  emailFilter,
  phoneFilter,
  lastCheckedAt,
}: BookingTableProps) {
  if (bookings.length === 0) {
    return (
      <div className="text-center py-12">
        <Calendar className="w-16 h-16 mx-auto text-gray-400 mb-4" />
        <p className="text-gray-600">No bookings found</p>
      </div>
    )
  }

  return (
    <>
      {/* Desktop Table View */}
      <div className="hidden lg:block bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                  No.
                </th>
                <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Booking Reference
                </th>
                <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Event Details
                </th>
                <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[180px]">
                  Date/Time
                </th>
                <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fee
                </th>
                <th className="px-6 xl:px-8 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 xl:px-8 py-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {bookings.map((booking, index) => {
                const hasNewResponse = booking.user_response && booking.response_date && 
                  (booking.response_date * 1000) > lastCheckedAt - 300000 // New if within last 5 minutes
                
                return (
                  <tr 
                    key={booking.id} 
                    className={`hover:bg-gray-50 ${hasNewResponse ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
                  >
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap text-sm text-gray-500">
                      {index + 1}
                    </td>
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        <SearchHighlight
                          text={getBookingReferenceNumber(booking)}
                          searchTerm={referenceNumberFilter}
                        />
                      </div>
                    </td>
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-gray-900">
                          <SearchHighlight
                            text={booking.name}
                            searchTerm={nameFilter}
                          />
                        </div>
                        {booking.user_response && (
                          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Response
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                        <Mail className="w-3 h-3" />
                        <SearchHighlight
                          text={booking.email}
                          searchTerm={emailFilter}
                        />
                      </div>
                      <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                        <Phone className="w-3 h-3" />
                        <SearchHighlight
                          text={booking.phone}
                          searchTerm={phoneFilter}
                        />
                      </div>
                    </td>
                    <td className="px-6 xl:px-8 py-4">
                      <div className="text-sm text-gray-900">{booking.event_type}</div>
                      {booking.organization_type && (
                        <div className="text-sm text-gray-500">{booking.organization_type}</div>
                      )}
                      {booking.participants && (
                        <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                          <Users className="w-3 h-3" />
                          {booking.participants} participants
                        </div>
                      )}
                    </td>
                    <td className="px-6 xl:px-8 py-4 min-w-[180px]">
                      <div className="text-sm text-gray-900">
                        {formatDate(booking.start_date)}
                        {booking.end_date && booking.end_date !== booking.start_date && (
                          <span> - {formatDate(booking.end_date)}</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 flex items-center gap-1 mt-1.5">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span className="whitespace-normal break-words">{formatTimeForDisplay(booking.start_time)} - {formatTimeForDisplay(booking.end_time)}</span>
                      </div>
                    </td>
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap">
                      {getStatusBadge(booking.status)}
                    </td>
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap">
                      {formatFee(booking)}
                    </td>
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatTimestamp(booking.created_at)}
                    </td>
                    <td className="px-6 xl:px-8 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onViewBooking(booking.id)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onDeleteBooking(booking.id)}
                          disabled={saving}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {/* Page size selector and total count */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-700">
            Showing <span className="font-medium">{bookings.length}</span> of <span className="font-medium">{total}</span> bookings
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700">Items per page:</span>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => onPageSizeChange(parseInt(value))}
            >
              <SelectTrigger className="w-20 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {/* Infinite scroll sentinel */}
        {hasMore && (
          <div ref={scrollSentinelRef} className="py-4 flex justify-center">
            {loading && <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
          </div>
        )}
        {!hasMore && bookings.length > 0 && (
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-center text-sm text-gray-500">
            No more bookings to load
          </div>
        )}
      </div>

      {/* Mobile/Tablet Card View */}
      <div className="lg:hidden space-y-4">
        {bookings.map((booking, index) => {
          const hasNewResponse = booking.user_response && booking.response_date && 
            (booking.response_date * 1000) > lastCheckedAt - 300000
          
          return (
            <div
              key={booking.id}
              className={`bg-white rounded-lg shadow p-4 sm:p-6 ${hasNewResponse ? 'border-l-4 border-l-blue-500' : ''}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-500">#{index + 1}</span>
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900">{booking.name}</h3>
                    {booking.user_response && (
                      <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Response
                      </Badge>
                    )}
                  </div>
                  <div className="mb-2">
                    <div className="text-xs font-medium text-gray-500 mb-0.5">Booking Reference</div>
                    <div className="text-sm font-medium text-gray-900">{getBookingReferenceNumber(booking)}</div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                    <div className="flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {booking.email}
                    </div>
                    <div className="flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {booking.phone}
                    </div>
                  </div>
                </div>
                <div className="ml-2">
                  {getStatusBadge(booking.status)}
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">Event</div>
                  <div className="text-sm text-gray-900">{booking.event_type}</div>
                  {booking.organization_type && (
                    <div className="text-xs text-gray-500 mt-0.5">{booking.organization_type}</div>
                  )}
                  {booking.participants && (
                    <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                      <Users className="w-3 h-3" />
                      {booking.participants} participants
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">Date/Time</div>
                  <div className="text-sm text-gray-900">
                    {formatDate(booking.start_date)}
                    {booking.end_date && booking.end_date !== booking.start_date && (
                      <span> - {formatDate(booking.end_date)}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    {formatTimeForDisplay(booking.start_time)} - {formatTimeForDisplay(booking.end_time)}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">Fee</div>
                  <div className="text-sm text-gray-900">{formatFee(booking)}</div>
                </div>

                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">Created</div>
                  <div className="text-sm text-gray-500">{formatTimestamp(booking.created_at)}</div>
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => onViewBooking(booking.id)}
                >
                  <Eye className="w-4 h-4 mr-1" />
                  View
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  onClick={() => onDeleteBooking(booking.id)}
                  disabled={saving}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete
                </Button>
              </div>
            </div>
          )
        })}
        {/* Page size selector and total count for mobile */}
        <div className="bg-white rounded-lg shadow px-4 py-3 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-700">
            Showing <span className="font-medium">{bookings.length}</span> of <span className="font-medium">{total}</span>
          </div>
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => onPageSizeChange(parseInt(value))}
          >
            <SelectTrigger className="w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Infinite scroll sentinel */}
        {hasMore && (
          <div ref={scrollSentinelRef} className="py-4 flex justify-center">
            {loading && <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
          </div>
        )}
        {!hasMore && bookings.length > 0 && (
          <div className="bg-white rounded-lg shadow px-4 py-3 text-center text-sm text-gray-500">
            No more bookings to load
          </div>
        )}
      </div>
    </>
  )
}

