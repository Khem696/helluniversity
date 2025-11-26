"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"
import {
  getAvailableActions,
  getActionDefinition,
  mapActionToStatus,
  type AdminAction,
  type BookingStatus,
  type ActionDefinition,
} from "@/lib/booking-state-machine"
import type { ValidationResult } from "@/lib/booking-action-validation"
import { API_PATHS } from "@/lib/api-config"

interface Booking {
  id: string
  status: BookingStatus
  start_date: number
  end_date: number | null
  start_time: string | null
  end_time: string | null
  proposed_date: number | null
  proposed_end_date: number | null
  response_date: number | null
  deposit_evidence_url: string | null
  deposit_verified_at: number | null
  deposit_verified_by: string | null
}

interface UseBookingActionsOptions {
  // FIXED: Support async callbacks for proper async flow (Bug #49)
  onSuccess?: (updatedBooking?: Booking) => void | Promise<void>
  onError?: (error: string) => void
}

export function useBookingActions(options?: UseBookingActionsOptions) {
  const [isLoading, setIsLoading] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<AdminAction | null>(null)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)

  /**
   * Get available actions for a booking
   * FIXED: Corrected parameter order to match function signature (CRITICAL-3)
   */
  const getActions = useCallback((booking: Booking): ActionDefinition[] => {
    // Calculate isDateInPast properly from start_date timestamp
    const isDateInPast = booking.start_date 
      ? (booking.start_date * 1000) < Date.now()
      : false
    
    return getAvailableActions(
      booking.status,
      Boolean(booking.deposit_evidence_url), // hasDepositEvidence (position 2)
      isDateInPast,                           // isDateInPast (position 3)
      true,                                   // isAdmin (always true for admin pages, position 4)
      booking                                 // booking object for context-aware filtering (position 5)
    )
  }, [])

  /**
   * Validate an action before execution
   */
  const validateActionBeforeExecution = useCallback(
    async (action: AdminAction, booking: Booking): Promise<ValidationResult> => {
      const targetStatus = mapActionToStatus(action, booking.status)
      
      try {
        const validateUrl = API_PATHS.adminBookingValidate(booking.id)
        
        // Debug logging (development only)
        if (process.env.NODE_ENV === 'development') {
          import('@/lib/logger').then(({ logDebug }) => {
            logDebug('Calling validation API', {
              url: validateUrl,
              action,
              targetStatus,
              bookingId: booking.id,
            }).catch(() => {
              // Fallback if logger fails
            })
          }).catch(() => {
            // Fallback if logger import fails
          })
        }
        
        // Call server-side validation API
        const response = await fetch(validateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, targetStatus }),
        })

        if (!response.ok) {
          // If response is not ok, try to get error message
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`
          try {
            const errorData = await response.json()
            errorMessage = errorData.error?.message || errorData.error || errorMessage
          } catch {
            // If JSON parsing fails, use status text
          }
          
          // Use structured logger for errors
          import('@/lib/logger').then(({ logError }) => {
            logError('Validation API error', {
              error: errorMessage,
              bookingId: booking.id,
              action,
              targetStatus,
            }).catch(() => {
              // Fallback if logger fails
            })
          }).catch(() => {
            // Fallback if logger import fails
          })
          const validation: ValidationResult = {
            valid: true, // Allow proceeding even if validation fails
            warnings: [`Could not verify booking validation: ${errorMessage}. Please check manually.`],
            errors: [],
          }
          setValidationResult(validation)
          return validation
        }

        const data = await response.json()

        if (!data.success) {
          // If validation API fails, return a warning but allow proceeding
          // Use structured logger for errors
          import('@/lib/logger').then(({ logError }) => {
            logError('Validation API error', {
              error: data.error,
              bookingId: booking.id,
              action,
              targetStatus,
            }).catch(() => {
              // Fallback if logger fails
            })
          }).catch(() => {
            // Fallback if logger import fails
          })
          const validation: ValidationResult = {
            valid: true, // Allow proceeding even if validation fails
            warnings: ["Could not verify booking validation. Please check manually."],
            errors: [],
          }
          setValidationResult(validation)
          return validation
        }

        const validation = data.data as ValidationResult
        setValidationResult(validation)
        return validation
      } catch (error) {
        // Enhanced error logging with structured logger
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorDetails = error instanceof Error ? error.stack : String(error)
        import('@/lib/logger').then(({ logError }) => {
          logError('Error calling validation API', {
            error: errorMessage,
            details: errorDetails,
            bookingId: booking.id,
            action,
            targetStatus,
            url: API_PATHS.adminBookingValidate(booking.id),
          }, error instanceof Error ? error : new Error(String(error))).catch(() => {
            // Fallback if logger fails
          })
        }).catch(() => {
          // Fallback if logger import fails
        })
        
        // If API call fails, return a warning but allow proceeding
        const validation: ValidationResult = {
          valid: true, // Allow proceeding even if validation fails
          warnings: [`Could not verify booking validation: ${errorMessage}. Please check manually.`],
          errors: [],
        }
        setValidationResult(validation)
        return validation
      }
    },
    []
  )

  /**
   * Execute an action with validation
   */
  const executeAction = useCallback(
    async (
      action: AdminAction,
      booking: Booking,
      additionalData?: {
        changeReason?: string
        adminNotes?: string
        depositVerifiedBy?: string
        proposedDate?: string | null
      }
    ): Promise<boolean> => {
      // Prevent duplicate actions
      if (actionInProgress === action) {
        toast.error("Action already in progress. Please wait.")
        return false
      }

      setIsLoading(true)
      setActionInProgress(action)

      try {
        // Validate action is allowed
        // FIXED: Corrected parameter order to match function signature (CRITICAL-4)
        const isDateInPast = booking.start_date 
          ? (booking.start_date * 1000) < Date.now()
          : false
        
        const actionDef = getActionDefinition(
          action,
          booking.status,
          Boolean(booking.deposit_evidence_url), // hasDepositEvidence (position 3)
          isDateInPast,                          // isDateInPast (position 4)
          true,                                  // isAdmin (always true for admin pages, position 5)
          booking                                // booking object for context (position 6)
        )

        if (!actionDef) {
          toast.error(`Action "${action}" is not available for status "${booking.status}"`)
          return false
        }

        // Run pre-action validation if required
        if (actionDef.requiresValidation) {
          const validation = await validateActionBeforeExecution(action, booking)

          if (!validation.valid) {
            // Show errors
            validation.errors.forEach((error) => {
              toast.error(error)
            })
            return false
          }

          // Show warnings but allow proceeding
          if (validation.warnings.length > 0) {
            // Warnings will be shown in confirmation dialog
            // Store validation result for dialog
            setValidationResult(validation)
          }
        }

        // Map action to status
        const targetStatus = mapActionToStatus(action, booking.status)

        // Prepare request body
        // FIXED: Add action parameter for backend state machine validation (CRITICAL-1, HIGH-3)
        const requestBody: any = {
          action,              // Add action parameter for backend state machine validation
          status: targetStatus,
          changeReason: additionalData?.changeReason || null,
          adminNotes: additionalData?.adminNotes || null,
        }

        // Handle special cases for deposit verification
        if (action === "accept_deposit" || action === "accept_deposit_other_channel") {
          requestBody.depositVerifiedBy =
            additionalData?.depositVerifiedBy || "Admin"
        }

        // Make API call
        const response = await fetch(API_PATHS.adminBooking(booking.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        })

        const data = await response.json()

        // Helper function to extract error message from API response
        const getErrorMessage = (error: any, defaultMsg: string): string => {
          if (!error) return defaultMsg
          if (typeof error === 'string') return error
          if (typeof error === 'object') {
            if (error.message) return error.message
            if (Array.isArray(error.errors)) {
              return error.errors.join(', ')
            }
            if (error.details) {
              if (typeof error.details === 'string') return error.details
              if (Array.isArray(error.details.errors)) {
                return error.details.errors.join(', ')
              }
            }
            return JSON.stringify(error)
          }
          return defaultMsg
        }

        if (!response.ok || !data.success) {
          throw new Error(getErrorMessage(data.error, "Failed to update booking"))
        }

        toast.success(`Booking ${actionDef.label.toLowerCase()} successfully. Email notification sent.`)
        
        // Extract updated booking from response
        const updatedBooking = data.data?.booking || data.booking || undefined
        
        // Call success callback with updated booking
        // FIXED: Await the callback to properly support async callbacks (Bug #50)
        if (options?.onSuccess) {
          await options.onSuccess(updatedBooking)
        }

        return true
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to update booking"
        toast.error(errorMessage)
        
        // Call error callback
        if (options?.onError) {
          options.onError(errorMessage)
        }

        return false
      } finally {
        setIsLoading(false)
        setActionInProgress(null)
        setValidationResult(null)
      }
    },
    [actionInProgress, validateActionBeforeExecution, options]
  )

  /**
   * Execute deposit verification (special case)
   */
  const verifyDeposit = useCallback(
    async (
      booking: Booking,
      verifiedBy: string,
      changeReason?: string,
      adminNotes?: string
    ): Promise<boolean> => {
      if (!verifiedBy.trim()) {
        toast.error("Please enter 'Verified By' field")
        return false
      }

      return executeAction("accept_deposit", booking, {
        depositVerifiedBy: verifiedBy,
        changeReason,
        adminNotes,
      })
    },
    [executeAction]
  )

  /**
   * Execute deposit rejection (special case)
   */
  const rejectDeposit = useCallback(
    async (
      booking: Booking,
      changeReason?: string,
      adminNotes?: string
    ): Promise<boolean> => {
      return executeAction("reject_deposit", booking, {
        changeReason: changeReason || "Deposit evidence rejected by admin",
        adminNotes,
      })
    },
    [executeAction]
  )

  return {
    isLoading,
    actionInProgress,
    validationResult,
    getActions,
    validateActionBeforeExecution,
    executeAction,
    verifyDeposit,
    rejectDeposit,
  }
}

