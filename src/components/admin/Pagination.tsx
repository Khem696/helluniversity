"use client"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

interface PaginationProps {
  currentPage: number
  totalPages: number
  itemsPerPage: number
  totalItems: number
  onPageChange: (page: number) => void
  onItemsPerPageChange: (itemsPerPage: number) => void
  itemsPerPageOptions?: number[]
  itemName?: string // e.g., "bookings", "emails", "events"
}

export function Pagination({
  currentPage,
  totalPages,
  itemsPerPage,
  totalItems,
  onPageChange,
  onItemsPerPageChange,
  itemsPerPageOptions = [10, 25, 50, 100],
  itemName = "items",
}: PaginationProps) {
  // Ensure totalPages is at least 1 to avoid division issues
  const safeTotalPages = Math.max(1, totalPages)
  const safeCurrentPage = Math.min(Math.max(1, currentPage), safeTotalPages)
  
  const startItem = totalItems === 0 ? 0 : (safeCurrentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(safeCurrentPage * itemsPerPage, totalItems)

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisible = 7

    if (safeTotalPages <= maxVisible) {
      // Show all pages if total is small
      for (let i = 1; i <= safeTotalPages; i++) {
        pages.push(i)
      }
    } else {
      // Always show first page
      pages.push(1)

      if (safeCurrentPage <= 3) {
        // Near the start
        for (let i = 2; i <= 5; i++) {
          pages.push(i)
        }
        pages.push("...")
        pages.push(safeTotalPages)
      } else if (safeCurrentPage >= safeTotalPages - 2) {
        // Near the end
        pages.push("...")
        for (let i = safeTotalPages - 4; i <= safeTotalPages; i++) {
          pages.push(i)
        }
      } else {
        // In the middle
        pages.push("...")
        for (let i = safeCurrentPage - 1; i <= safeCurrentPage + 1; i++) {
          pages.push(i)
        }
        pages.push("...")
        pages.push(safeTotalPages)
      }
    }

    return pages
  }

  const pageNumbers = getPageNumbers()

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 bg-gray-50 border-t border-gray-200">
      {/* Items per page selector and info */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700 whitespace-nowrap">Items per page:</span>
          <Select
            value={itemsPerPage.toString()}
            onValueChange={(value) => {
              const newItemsPerPage = parseInt(value)
              onItemsPerPageChange(newItemsPerPage)
              // Reset to page 1 when changing items per page
              onPageChange(1)
            }}
          >
            <SelectTrigger className="w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {itemsPerPageOptions.map((option) => (
                <SelectItem key={option} value={option.toString()}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="text-sm text-gray-700 whitespace-nowrap">
          Showing <span className="font-medium">{startItem}</span> to{" "}
          <span className="font-medium">{endItem}</span> of{" "}
          <span className="font-medium">{totalItems}</span> {itemName}
        </div>
      </div>

      {/* Page navigation */}
      {safeTotalPages > 0 && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(1)}
            disabled={safeCurrentPage === 1}
            className="h-8 w-8 p-0"
            aria-label="First page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(safeCurrentPage - 1)}
            disabled={safeCurrentPage === 1}
            className="h-8 w-8 p-0"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* Page numbers */}
          <div className="flex items-center gap-1">
            {pageNumbers.map((page, index) => {
              if (page === "...") {
                return (
                  <span
                    key={`ellipsis-${index}`}
                    className="px-2 py-1 text-sm text-gray-500"
                  >
                    ...
                  </span>
                )
              }

              const pageNum = page as number
              return (
                <Button
                  key={pageNum}
                  variant={safeCurrentPage === pageNum ? "default" : "outline"}
                  size="sm"
                  onClick={() => onPageChange(pageNum)}
                  className="h-8 w-8 p-0"
                  aria-label={`Page ${pageNum}`}
                  aria-current={safeCurrentPage === pageNum ? "page" : undefined}
                >
                  {pageNum}
                </Button>
              )
            })}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(safeCurrentPage + 1)}
            disabled={safeCurrentPage === safeTotalPages}
            className="h-8 w-8 p-0"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(safeTotalPages)}
            disabled={safeCurrentPage === safeTotalPages}
            className="h-8 w-8 p-0"
            aria-label="Last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

