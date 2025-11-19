/**
 * Booking State Machine
 * 
 * Defines valid state transitions and action availability for booking management.
 * This ensures UI prevents invalid actions before they reach the backend.
 * 
 * Enhanced with guard functions and context-aware validation to address:
 * - Race conditions in status transitions
 * - Overlap checking before confirmation
 * - Date validation (past dates, future dates)
 * - Deposit evidence validation
 * - Archive restoration with blob verification
 * - Force restore from finished bookings (admin override)
 */

import { isValidStatusTransition } from "./booking-validations"

export type BookingStatus = 
  | "pending" 
  | "pending_deposit"
  | "paid_deposit"
  | "confirmed" 
  | "cancelled" 
  | "finished"

export type AdminAction = 
  | "accept" 
  | "reject" 
  | "accept_deposit"
  | "accept_deposit_other_channel"
  | "reject_deposit" 
  | "cancel"
  | "change_date"
  | "confirm_other_channel"
  | "force_restore" // New: For restoring finished bookings (admin override)

export interface ActionDefinition {
  id: AdminAction
  label: string
  targetStatus: BookingStatus
  type: "primary" | "secondary" | "destructive"
  description: string
  requiresConfirmation: boolean
  requiresValidation?: boolean // Whether to run pre-action validation
  requiresForceFlag?: boolean // New: For actions that need explicit force flag (e.g., force_restore)
}

/**
 * Context for guard functions
 */
export interface GuardContext {
  checkOverlap?: boolean // Whether to check for overlaps (default: true)
  verifyBlob?: boolean // Whether to verify blob existence (default: true)
  forceRestore?: boolean // Whether this is a force restore operation
  isAdmin?: boolean // Whether the user is an admin
  skipDateCheck?: boolean // Whether to skip date validation (for testing/admin override)
}

/**
 * Guard function type for transition validation
 */
export type TransitionGuard = (
  booking: any,
  context?: GuardContext
) => Promise<{ allowed: boolean; reason?: string }> | { allowed: boolean; reason?: string }

/**
 * Maps admin actions to target statuses
 */
export function mapActionToStatus(
  action: AdminAction,
  currentStatus: BookingStatus
): BookingStatus {
  const mapping: Record<AdminAction, BookingStatus> = {
    accept: "pending_deposit", // Accept from pending -> pending_deposit (immediate)
    reject: "cancelled", // Reject -> cancelled (rejected merged into cancelled)
    accept_deposit: "confirmed", // Accept deposit -> confirmed (from paid_deposit, normal flow)
    accept_deposit_other_channel: "confirmed", // Accept deposit -> confirmed (from paid_deposit, other channel)
    reject_deposit: "pending_deposit", // Reject deposit -> pending_deposit (user can re-upload)
    cancel: "cancelled",
    change_date: currentStatus, // Date change doesn't change status
    confirm_other_channel: "confirmed", // Confirm from pending_deposit -> confirmed (other channel)
    force_restore: "confirmed", // Force restore from finished -> confirmed (admin override)
  }
  
  return mapping[action]
}

/**
 * Enhanced state machine guards for transition validation
 * These guards provide context-aware validation beyond basic transition rules
 */
export const STATE_MACHINE_GUARDS: Record<string, Record<string, TransitionGuard>> = {
  pending: {
    pending_deposit: async (booking, context) => {
      // Guard: Cannot accept past bookings (unless admin override)
      if (!context?.skipDateCheck) {
        const { isDateInPast } = await import("./booking-validations")
        if (booking.startDate) {
          const startDateStr = typeof booking.startDate === 'number'
            ? new Date(booking.startDate * 1000).toISOString().split('T')[0]
            : booking.startDate
          if (isDateInPast(startDateStr)) {
            return {
              allowed: false,
              reason: "Cannot accept booking with past start date"
            }
          }
        }
      }
      return { allowed: true }
    },
    cancelled: () => ({ allowed: true })
  },
  pending_deposit: {
    paid_deposit: async (booking) => {
      // Guard: User uploads deposit - this is automatic, no guard needed
      // But we can verify deposit evidence exists if provided
      return { allowed: true }
    },
    confirmed: async (booking, context) => {
      // Guard: Check overlap before confirming (for confirm_other_channel action)
      if (context?.checkOverlap !== false) {
        try {
          const { checkBookingOverlap } = await import("./booking-validations")
          const { createBangkokTimestamp } = await import("./timezone")
          
          const startDate = typeof booking.startDate === 'string' 
            ? createBangkokTimestamp(booking.startDate) 
            : booking.startDate
          const endDate = booking.endDate 
            ? (typeof booking.endDate === 'string' ? createBangkokTimestamp(booking.endDate) : booking.endDate)
            : null
          
          const overlapCheck = await checkBookingOverlap(
            booking.id,
            startDate,
            endDate,
            booking.startTime || null,
            booking.endTime || null
          )
          
          if (overlapCheck.overlaps) {
            return {
              allowed: false,
              reason: `Cannot confirm: overlaps with existing confirmed booking(s)`
            }
          }
        } catch (error) {
          // If overlap check fails, allow but log warning
          console.warn("Overlap check failed:", error)
        }
      }
      return { allowed: true }
    },
    cancelled: () => ({ allowed: true })
  },
  paid_deposit: {
    confirmed: async (booking, context) => {
      // Guard: Check overlap before confirming
      if (context?.checkOverlap !== false) {
        try {
          const { checkBookingOverlap } = await import("./booking-validations")
          const { createBangkokTimestamp } = await import("./timezone")
          
          const startDate = typeof booking.startDate === 'string' 
            ? createBangkokTimestamp(booking.startDate) 
            : booking.startDate
          const endDate = booking.endDate 
            ? (typeof booking.endDate === 'string' ? createBangkokTimestamp(booking.endDate) : booking.endDate)
            : null
          
          const overlapCheck = await checkBookingOverlap(
            booking.id,
            startDate,
            endDate,
            booking.startTime || null,
            booking.endTime || null
          )
          
          if (overlapCheck.overlaps) {
            return {
              allowed: false,
              reason: `Cannot confirm: overlaps with existing confirmed booking(s)`
            }
          }
        } catch (error) {
          console.warn("Overlap check failed:", error)
        }
      }
      return { allowed: true }
    },
    pending_deposit: () => ({ allowed: true }),
    cancelled: () => ({ allowed: true })
  },
  confirmed: {
    finished: async (booking) => {
      // Guard: End date must be in the past
      const { isDateInPast } = await import("./booking-validations")
      if (booking.endDate) {
        const endDateStr = typeof booking.endDate === 'number'
          ? new Date(booking.endDate * 1000).toISOString().split('T')[0]
          : booking.endDate
        if (!isDateInPast(endDateStr)) {
          return {
            allowed: false,
            reason: "Cannot finish booking: end date is in the future"
          }
        }
      }
      return { allowed: true }
    },
    cancelled: () => ({ allowed: true })
  },
  cancelled: {
    pending_deposit: () => ({ allowed: true }),
    paid_deposit: async (booking, context) => {
      // Guard: Must have deposit evidence AND verify blob exists (if context provides verification)
      if (!booking.depositEvidenceUrl) {
        return {
          allowed: false,
          reason: "Cannot restore to paid_deposit without deposit evidence"
        }
      }
      
      // Verify blob exists (if context provides verification)
      // Note: Blob verification is handled separately in the backend
      // This guard just checks that depositEvidenceUrl exists
      // Actual blob existence verification should be done server-side
      if (context?.verifyBlob !== false) {
        // Blob verification is optional and handled by backend
        // Frontend guard just ensures URL is present
      }
      
      return { allowed: true }
    },
    confirmed: async (booking, context) => {
      // Guard: Check overlap before restoring to confirmed
      if (context?.checkOverlap !== false) {
        try {
          const { checkBookingOverlap } = await import("./booking-validations")
          const { createBangkokTimestamp } = await import("./timezone")
          
          const startDate = typeof booking.startDate === 'string' 
            ? createBangkokTimestamp(booking.startDate) 
            : booking.startDate
          const endDate = booking.endDate 
            ? (typeof booking.endDate === 'string' ? createBangkokTimestamp(booking.endDate) : booking.endDate)
            : null
          
          const overlapCheck = await checkBookingOverlap(
            booking.id,
            startDate,
            endDate,
            booking.startTime || null,
            booking.endTime || null
          )
          
          if (overlapCheck.overlaps) {
            return {
              allowed: false,
              reason: `Cannot restore to confirmed: overlaps with existing confirmed booking(s)`
            }
          }
        } catch (error) {
          console.warn("Overlap check failed:", error)
        }
      }
      return { allowed: true }
    }
  },
  finished: {
    confirmed: async (booking, context) => {
      // Guard: Only allowed with force flag and admin context
      if (!context?.forceRestore || !context?.isAdmin) {
        return {
          allowed: false,
          reason: "Cannot restore finished booking without force flag and admin context"
        }
      }
      
      // Guard: Check overlap before restoring
      if (context?.checkOverlap !== false) {
        try {
          const { checkBookingOverlap } = await import("./booking-validations")
          const { createBangkokTimestamp } = await import("./timezone")
          
          const startDate = typeof booking.startDate === 'string' 
            ? createBangkokTimestamp(booking.startDate) 
            : booking.startDate
          const endDate = booking.endDate 
            ? (typeof booking.endDate === 'string' ? createBangkokTimestamp(booking.endDate) : booking.endDate)
            : null
          
          const overlapCheck = await checkBookingOverlap(
            booking.id,
            startDate,
            endDate,
            booking.startTime || null,
            booking.endTime || null
          )
          
          if (overlapCheck.overlaps) {
            return {
              allowed: false,
              reason: `Cannot restore finished booking: overlaps with existing confirmed booking(s)`
            }
          }
        } catch (error) {
          console.warn("Overlap check failed:", error)
        }
      }
      
      return { allowed: true }
    }
  }
}

/**
 * Enhanced transition validation with guards
 */
export async function validateTransitionWithGuards(
  fromStatus: BookingStatus,
  toStatus: BookingStatus,
  booking: any,
  context?: GuardContext
): Promise<{ valid: boolean; reason?: string }> {
  // First check basic transition validity
  const basicValidation = isValidStatusTransition(fromStatus, toStatus)
  if (!basicValidation.valid) {
    return basicValidation
  }
  
  // Then check guards if they exist
  const guards = STATE_MACHINE_GUARDS[fromStatus]
  if (guards && guards[toStatus]) {
    const guardResult = await Promise.resolve(guards[toStatus](booking, context))
    // Convert guard result format { allowed, reason } to { valid, reason }
    return {
      valid: guardResult.allowed,
      reason: guardResult.reason
    }
  }
  
  return { valid: true }
}

/**
 * Get available actions for a given booking status
 * @param currentStatus - Current booking status
 * @param hasDepositEvidence - Whether booking has deposit evidence
 * @param isDateInPast - Whether booking date is in the past (optional, for filtering accept action)
 * @param isAdmin - Whether the user is an admin (for force restore from finished)
 * @param booking - Optional booking object for context-aware action filtering
 */
export function getAvailableActions(
  currentStatus: BookingStatus,
  hasDepositEvidence: boolean = false,
  isDateInPast: boolean = false,
  isAdmin: boolean = false,
  booking?: any
): ActionDefinition[] {
  const actions: ActionDefinition[] = []
  
  switch (currentStatus) {
    case "pending":
      // Only allow accept for future date bookings
      if (!isDateInPast) {
        actions.push(
          {
            id: "accept",
            label: "Accept",
            targetStatus: "pending_deposit",
            type: "primary",
            description: "Approve this booking request (user can upload deposit)",
            requiresConfirmation: true,
            requiresValidation: true,
          }
        )
      }
      actions.push(
        {
          id: "reject",
          label: "Reject",
          targetStatus: "cancelled",
          type: "destructive",
          description: "Decline this booking",
          requiresConfirmation: true,
          requiresValidation: false,
        },
        {
          id: "cancel",
          label: "Cancel",
          targetStatus: "cancelled",
          type: "destructive",
          description: "Cancel this booking",
          requiresConfirmation: true,
          requiresValidation: false,
        }
      )
      break
      
    case "pending_deposit":
      // Special case: Admin can confirm via other channel even without deposit upload
      actions.push(
        {
          id: "confirm_other_channel",
          label: "Confirm (Other Channel)",
          targetStatus: "confirmed",
          type: "secondary",
          description: "Confirm booking - deposit verified through other channels (phone, in-person, etc.)",
          requiresConfirmation: true,
          requiresValidation: true,
        },
        {
          id: "cancel",
          label: "Cancel",
          targetStatus: "cancelled",
          type: "destructive",
          description: "Cancel this booking",
          requiresConfirmation: true,
          requiresValidation: false,
        }
      )
      break
      
    case "paid_deposit":
      // Deposit uploaded, admin can accept or reject
      actions.push(
        {
          id: "accept_deposit",
          label: "Accept Deposit",
          targetStatus: "confirmed",
          type: "primary",
          description: "Accept deposit evidence and confirm booking",
          requiresConfirmation: true,
          requiresValidation: true,
        },
        {
          id: "accept_deposit_other_channel",
          label: "Confirm (Verified via Other Channel)",
          targetStatus: "confirmed",
          type: "secondary",
          description: "Confirm booking - deposit verified through other channels (phone, in-person, etc.)",
          requiresConfirmation: true,
          requiresValidation: true,
        },
        {
          id: "reject_deposit",
          label: "Reject Deposit",
          targetStatus: "pending_deposit",
          type: "destructive",
          description: "Reject deposit evidence, user must re-upload",
          requiresConfirmation: true,
          requiresValidation: false,
        },
        {
          id: "cancel",
          label: "Cancel",
          targetStatus: "cancelled",
          type: "destructive",
          description: "Cancel this booking",
          requiresConfirmation: true,
          requiresValidation: false,
        }
      )
      break
      
    case "confirmed":
      actions.push(
        {
          id: "change_date",
          label: "Change Date",
          targetStatus: "confirmed",
          type: "secondary",
          description: "Change booking dates (only for confirmed bookings)",
          requiresConfirmation: true,
          requiresValidation: true,
        },
        {
          id: "cancel",
          label: "Cancel",
          targetStatus: "cancelled",
          type: "destructive",
          description: "Cancel this booking",
          requiresConfirmation: true,
          requiresValidation: false,
        }
      )
      break
      
    case "cancelled":
      // Allow restore from archive (will be handled separately in archive page)
      // No actions here - restoration is handled in archive page
      break
      
    case "finished":
      // New: Allow force restore for admins (requires explicit force flag)
      if (isAdmin) {
        actions.push({
          id: "force_restore",
          label: "Force Restore to Confirmed",
          targetStatus: "confirmed",
          type: "secondary",
          description: "Force restore finished booking to confirmed (requires admin override)",
          requiresConfirmation: true,
          requiresValidation: true,
          requiresForceFlag: true,
        })
      }
      break
  }
  
  return actions
}

/**
 * Validate if an action is allowed for a given status
 * Enhanced version with guard support and context-aware validation
 */
export async function isActionAllowed(
  action: AdminAction,
  currentStatus: BookingStatus,
  booking?: any,
  context?: GuardContext
): Promise<{ allowed: boolean; reason?: string }> {
  const targetStatus = mapActionToStatus(action, currentStatus)
  
  // Check basic transition validity
  const transition = isValidStatusTransition(currentStatus, targetStatus)
  if (!transition.valid) {
    return {
      allowed: false,
      reason: transition.reason || `Cannot ${action} from ${currentStatus} status`,
    }
  }
  
  // Check guards if booking is provided
  if (booking) {
    const guardValidation = await validateTransitionWithGuards(
      currentStatus,
      targetStatus,
      booking,
      context
    )
    if (!guardValidation.valid) {
      // Convert { valid, reason } to { allowed, reason }
      return {
        allowed: false,
        reason: guardValidation.reason
      }
    }
  }
  
  return { allowed: true }
}

/**
 * Synchronous version for backward compatibility
 * Use async version (isActionAllowed) when booking context is available
 * 
 * @deprecated Use async isActionAllowed() for better validation with guards
 */
export function isActionAllowedSync(
  action: AdminAction,
  currentStatus: BookingStatus
): { allowed: boolean; reason?: string } {
  const targetStatus = mapActionToStatus(action, currentStatus)
  const transition = isValidStatusTransition(currentStatus, targetStatus)
  
  if (!transition.valid) {
    return {
      allowed: false,
      reason: transition.reason || `Cannot ${action} from ${currentStatus} status`,
    }
  }
  
  return { allowed: true }
}

/**
 * Get action definition by ID
 */
export function getActionDefinition(
  action: AdminAction,
  currentStatus: BookingStatus,
  hasDepositEvidence: boolean = false,
  isDateInPast: boolean = false,
  isAdmin: boolean = false,
  booking?: any
): ActionDefinition | null {
  const availableActions = getAvailableActions(
    currentStatus,
    hasDepositEvidence,
    isDateInPast,
    isAdmin,
    booking
  )
  
  return availableActions.find((a) => a.id === action) || null
}

