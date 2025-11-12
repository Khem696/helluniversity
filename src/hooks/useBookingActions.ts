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
  onSuccess?: () => void
  onError?: (error: string) => void
}

export function useBookingActions(options?: UseBookingActionsOptions) {
  const [isLoading, setIsLoading] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<AdminAction | null>(null)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)

  /**
   * Get available actions for a booking
   */
  const getActions = useCallback((booking: Booking): ActionDefinition[] => {
    return getAvailableActions(
      booking.status,
      Boolean(booking.proposed_date),
      Boolean(booking.deposit_evidence_url)
    )
  }, [])

  /**
   * Validate an action before execution
   */
  const validateActionBeforeExecution = useCallback(
    async (action: AdminAction, booking: Booking): Promise<ValidationResult> => {
      const targetStatus = mapActionToStatus(action, booking.status)
      
      try {
        // Call server-side validation API
        const response = await fetch(`/api/admin/bookings/${booking.id}/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, targetStatus }),
        })

        const data = await response.json()

        if (!response.ok || !data.success) {
          // If validation API fails, return a warning but allow proceeding
          console.error("Validation API error:", data.error)
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
        console.error("Error calling validation API:", error)
        // If API call fails, return a warning but allow proceeding
        const validation: ValidationResult = {
          valid: true, // Allow proceeding even if validation fails
          warnings: ["Could not verify booking validation. Please check manually."],
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
        const actionDef = getActionDefinition(
          action,
          booking.status,
          Boolean(booking.proposed_date)
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
        const requestBody: any = {
          status: targetStatus,
          changeReason: additionalData?.changeReason || null,
          adminNotes: additionalData?.adminNotes || null,
        }

        // Handle special cases
        if (action === "verify_deposit" || action === "check_in") {
          requestBody.depositVerifiedBy =
            additionalData?.depositVerifiedBy || "Admin"
        }

        if (action === "postpone") {
          // For postpone, don't send proposedDate (admin doesn't propose dates)
          requestBody.proposedDate = null
        }

        // Make API call
        const response = await fetch(`/api/admin/bookings/${booking.id}`, {
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
        
        // Call success callback
        if (options?.onSuccess) {
          options.onSuccess()
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

      return executeAction("verify_deposit", booking, {
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

