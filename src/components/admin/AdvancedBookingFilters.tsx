"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { X, Calendar as CalendarIcon, Filter } from "lucide-react"
import { SearchInputWithHistory } from "./SearchInputWithHistory"

interface AdvancedBookingFiltersProps {
  // Status filters
  statusFilter: string
  onStatusFilterChange: (value: string) => void
  statusFilters: string[]
  onStatusFiltersChange: (filters: string[]) => void
  
  // Search filters
  emailFilter: string
  onEmailFilterChange: (value: string) => void
  onEmailSearch?: (value: string) => void
  onEmailDebouncedSearch?: (value: string) => void // Auto-search while typing
  referenceNumberFilter: string
  onReferenceNumberFilterChange: (value: string) => void
  onReferenceNumberSearch?: (value: string) => void
  onReferenceNumberDebouncedSearch?: (value: string) => void // Auto-search while typing
  nameFilter: string
  onNameFilterChange: (value: string) => void
  onNameSearch?: (value: string) => void
  onNameDebouncedSearch?: (value: string) => void // Auto-search while typing
  phoneFilter: string
  onPhoneFilterChange: (value: string) => void
  onPhoneSearch?: (value: string) => void
  onPhoneDebouncedSearch?: (value: string) => void // Auto-search while typing
  
  // Other filters
  eventTypeFilter: string
  onEventTypeFilterChange: (value: string) => void
  showOverlappingOnly: boolean
  onShowOverlappingOnlyChange: (value: boolean) => void
  
  // Date range filters
  startDateFrom: string
  onStartDateFromChange: (value: string) => void
  startDateTo: string
  onStartDateToChange: (value: string) => void
  useDateRange: boolean
  onUseDateRangeChange: (value: boolean) => void
  
  // Sort
  sortBy: "created_at" | "start_date" | "name" | "updated_at"
  onSortByChange: (value: "created_at" | "start_date" | "name" | "updated_at") => void
  sortOrder: "ASC" | "DESC"
  onSortOrderChange: (value: "ASC" | "DESC") => void
  
  // Event types
  eventTypes: Array<{ value: string; label: string }>
  
  // Clear all
  onClearAll: () => void
  hasActiveFilters: boolean
}

const ALL_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "pending_deposit", label: "Pending Deposit" },
  { value: "paid_deposit", label: "Paid Deposit" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "finished", label: "Finished" },
]

export function AdvancedBookingFilters({
  statusFilter,
  onStatusFilterChange,
  statusFilters,
  onStatusFiltersChange,
  emailFilter,
  onEmailFilterChange,
  onEmailSearch,
  onEmailDebouncedSearch,
  referenceNumberFilter,
  onReferenceNumberFilterChange,
  onReferenceNumberSearch,
  onReferenceNumberDebouncedSearch,
  nameFilter,
  onNameFilterChange,
  onNameSearch,
  onNameDebouncedSearch,
  phoneFilter,
  onPhoneFilterChange,
  onPhoneSearch,
  onPhoneDebouncedSearch,
  eventTypeFilter,
  onEventTypeFilterChange,
  showOverlappingOnly,
  onShowOverlappingOnlyChange,
  startDateFrom,
  onStartDateFromChange,
  startDateTo,
  onStartDateToChange,
  useDateRange,
  onUseDateRangeChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  eventTypes,
  onClearAll,
  hasActiveFilters,
}: AdvancedBookingFiltersProps) {
  const [showMultiStatus, setShowMultiStatus] = useState(false)

  const toggleStatus = (status: string) => {
    if (statusFilters.includes(status)) {
      onStatusFiltersChange(statusFilters.filter((s) => s !== status))
      if (statusFilters.length === 1) {
        setShowMultiStatus(false)
        onStatusFilterChange("all")
      }
    } else {
      onStatusFiltersChange([...statusFilters, status])
      setShowMultiStatus(true)
      onStatusFilterChange("all")
    }
  }

  return (
    <div 
      className="mb-6 space-y-4"
      onKeyDown={(e) => {
        // Prevent form submission on Enter key in input fields
        if (e.key === "Enter") {
          const target = e.target as HTMLElement
          if (target.tagName === "INPUT" && target.getAttribute("type") !== "submit") {
            e.preventDefault()
            e.stopPropagation()
            return false
          }
        }
      }}
      onSubmit={(e) => {
        // Prevent any form submission
        e.preventDefault()
        e.stopPropagation()
        return false
      }}
    >
      {/* First Row: Status, Event Type, Sort By, Sort Order */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Status Filter - Single or Multiple */}
        <div className="relative w-full sm:w-48">
          {!showMultiStatus ? (
            <Select value={statusFilter} onValueChange={onStatusFilterChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {ALL_STATUSES.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
                <SelectItem value="multi">Select Multiple...</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div className="border border-gray-300 rounded-md p-2 min-h-[40px] flex flex-wrap gap-1">
              {statusFilters.length === 0 ? (
                <span className="text-sm text-gray-500">Select statuses...</span>
              ) : (
                statusFilters.map((status) => {
                  const statusLabel = ALL_STATUSES.find((s) => s.value === status)?.label || status
                  return (
                    <Badge key={status} variant="secondary" className="flex items-center gap-1">
                      {statusLabel}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => toggleStatus(status)}
                      />
                    </Badge>
                  )
                })
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs ml-auto"
                onClick={() => {
                  setShowMultiStatus(false)
                  onStatusFiltersChange([])
                  onStatusFilterChange("all")
                }}
              >
                Clear
              </Button>
            </div>
          )}
          {showMultiStatus && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-2">
              <div className="space-y-1">
                {ALL_STATUSES.map((status) => (
                  <label
                    key={status.value}
                    className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                  >
                    <Checkbox
                      checked={statusFilters.includes(status.value)}
                      onCheckedChange={() => toggleStatus(status.value)}
                    />
                    <span className="text-sm">{status.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <Select value={eventTypeFilter} onValueChange={onEventTypeFilterChange}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filter by event type" />
          </SelectTrigger>
          <SelectContent>
            {eventTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(value) => onSortByChange(value as typeof sortBy)}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at">Created Date</SelectItem>
            <SelectItem value="start_date">Start Date</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="updated_at">Updated Date</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortOrder} onValueChange={(value) => onSortOrderChange(value as typeof sortOrder)}>
          <SelectTrigger className="w-full sm:w-32">
            <SelectValue placeholder="Order" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DESC">Descending</SelectItem>
            <SelectItem value="ASC">Ascending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Second Row: Search Fields */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="w-full sm:w-48">
          <SearchInputWithHistory
            value={referenceNumberFilter}
            onChange={onReferenceNumberFilterChange}
            onSearch={onReferenceNumberSearch}
            debouncedOnSearch={onReferenceNumberDebouncedSearch}
            placeholder="Search reference number..."
            storageKey="booking-search-ref"
            className="w-full"
          />
        </div>
        <div className="w-full sm:w-48">
          <SearchInputWithHistory
            value={nameFilter}
            onChange={onNameFilterChange}
            onSearch={onNameSearch}
            debouncedOnSearch={onNameDebouncedSearch}
            placeholder="Search name..."
            storageKey="booking-search-name"
            className="w-full"
          />
        </div>
        <div className="w-full sm:w-48">
          <SearchInputWithHistory
            value={phoneFilter}
            onChange={onPhoneFilterChange}
            onSearch={onPhoneSearch}
            debouncedOnSearch={onPhoneDebouncedSearch}
            placeholder="Search phone..."
            storageKey="booking-search-phone"
            className="w-full"
          />
        </div>
        <div className="w-full sm:w-64">
          <SearchInputWithHistory
            value={emailFilter}
            onChange={onEmailFilterChange}
            onSearch={onEmailSearch}
            debouncedOnSearch={onEmailDebouncedSearch}
            placeholder="Search email..."
            storageKey="booking-search-email"
            className="w-full"
          />
        </div>
      </div>

      {/* Third Row: Date Range and Other Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="use-date-range"
            checked={useDateRange}
            onChange={(e) => onUseDateRangeChange(e.target.checked)}
            className="w-4 h-4"
          />
          <Label htmlFor="use-date-range" className="text-sm cursor-pointer">
            Filter by date range
          </Label>
        </div>
        {useDateRange && (
          <div className="flex flex-col sm:flex-row gap-4 flex-1">
            <div className="flex-1">
              <Label htmlFor="start-date-from" className="text-sm font-medium text-gray-700 mb-1 block">
                Start Date From
              </Label>
              <Input
                id="start-date-from"
                type="date"
                value={startDateFrom}
                onChange={(e) => onStartDateFromChange(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="start-date-to" className="text-sm font-medium text-gray-700 mb-1 block">
                Start Date To
              </Label>
              <Input
                id="start-date-to"
                type="date"
                value={startDateTo}
                onChange={(e) => onStartDateToChange(e.target.value)}
                className="w-full"
              />
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="show-overlapping"
            checked={showOverlappingOnly}
            onChange={(e) => onShowOverlappingOnlyChange(e.target.checked)}
            className="w-4 h-4"
          />
          <Label htmlFor="show-overlapping" className="text-sm cursor-pointer">
            Show Overlapping Only
          </Label>
        </div>
      </div>

      {/* Clear All Filters */}
      {hasActiveFilters && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClearAll}
            className="text-xs"
          >
            <X className="w-3 h-3 mr-1" />
            Clear All Filters
          </Button>
        </div>
      )}
    </div>
  )
}

