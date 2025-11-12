/**
 * Booking State Machine
 * 
 * Defines valid state transitions and action availability for booking management.
 * This ensures UI prevents invalid actions before they reach the backend.
 */

import { isValidStatusTransition } from "./booking-validations"

export type BookingStatus = 
  | "pending" 
  | "accepted" 
  | "rejected" 
  | "postponed" 
  | "cancelled" 
  | "finished" 
  | "checked-in" 
  | "paid_deposit" 
  | "pending_deposit"

export type AdminAction = 
  | "accept" 
  | "reject" 
  | "postpone" 
  | "verify_deposit" 
  | "reject_deposit" 
  | "check_in" 
  | "cancel"

export interface ActionDefinition {
  id: AdminAction
  label: string
  targetStatus: BookingStatus
  type: "primary" | "secondary" | "destructive"
  description: string
  requiresConfirmation: boolean
  requiresValidation?: boolean // Whether to run pre-action validation
}

/**
 * Maps admin actions to target statuses
 */
export function mapActionToStatus(
  action: AdminAction,
  currentStatus: BookingStatus
): BookingStatus {
  const mapping: Record<AdminAction, BookingStatus> = {
    accept: "accepted",
    reject: "rejected",
    postpone: "postponed",
    verify_deposit: "checked-in",
    reject_deposit: "pending_deposit",
    check_in: "checked-in",
    cancel: "cancelled",
  }
  
  return mapping[action]
}

/**
 * Get available actions for a given booking status
 * @param currentStatus - Current booking status
 * @param hasProposedDate - Whether booking has a proposed date
 * @param hasDepositEvidence - Whether booking has deposit evidence
 * @param isDateInPast - Whether booking date is in the past (optional, for filtering accept action)
 */
export function getAvailableActions(
  currentStatus: BookingStatus,
  hasProposedDate: boolean = false,
  hasDepositEvidence: boolean = false,
  isDateInPast: boolean = false
): ActionDefinition[] {
  const actions: ActionDefinition[] = []
  
  switch (currentStatus) {
    case "pending":
      // Only allow reject for past date bookings
      if (!isDateInPast) {
        actions.push(
          {
            id: "accept",
            label: "Accept",
            targetStatus: "accepted",
            type: "primary",
            description: "Approve this booking request",
            requiresConfirmation: true,
            requiresValidation: true,
          }
        )
      }
      actions.push(
        {
          id: "reject",
          label: "Reject",
          targetStatus: "rejected",
          type: "destructive",
          description: "Decline this booking",
          requiresConfirmation: true,
          requiresValidation: false,
        },
        {
          id: "postpone",
          label: "Postpone",
          targetStatus: "postponed",
          type: "secondary",
          description: "Request user to propose a new date",
          requiresConfirmation: true,
          requiresValidation: false,
        }
      )
      break
      
    case "accepted":
      actions.push(
        {
          id: "check_in",
          label: "Check In (Direct)",
          targetStatus: "checked-in",
          type: "primary",
          description: "Directly check in without deposit verification",
          requiresConfirmation: true,
          requiresValidation: true,
        },
        {
          id: "postpone",
          label: "Postpone",
          targetStatus: "postponed",
          type: "secondary",
          description: "Request user to propose a new date",
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
      
    case "paid_deposit":
      actions.push(
        {
          id: "verify_deposit",
          label: "Verify Deposit & Check In",
          targetStatus: "checked-in",
          type: "primary",
          description: "Verify deposit evidence and check in user",
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
      
    case "pending_deposit":
      actions.push(
        {
          id: "accept",
          label: "Accept",
          targetStatus: "accepted",
          type: "primary",
          description: "Accept booking (user can upload deposit)",
          requiresConfirmation: true,
          requiresValidation: true,
        },
        {
          id: "postpone",
          label: "Postpone",
          targetStatus: "postponed",
          type: "secondary",
          description: "Request user to propose a new date",
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
      
    case "postponed":
      if (hasProposedDate) {
        // User has proposed a date - admin can accept or reject
        // Only allow accept if date is not in past
        if (!isDateInPast) {
          actions.push(
            {
              id: "accept",
              label: "Accept Proposed Date",
              targetStatus: "accepted",
              type: "primary",
              description: "Accept user's proposed date",
              requiresConfirmation: true,
              requiresValidation: true,
            }
          )
        }
        actions.push(
          {
            id: "reject",
            label: "Reject Proposed Date",
            targetStatus: "rejected",
            type: "destructive",
            description: "Reject user's proposed date",
            requiresConfirmation: true,
            requiresValidation: false,
          },
          {
            id: "postpone",
            label: "Request New Proposal",
            targetStatus: "postponed",
            type: "secondary",
            description: "Clear current proposal and request a new one",
            requiresConfirmation: true,
            requiresValidation: false,
          }
        )
      } else {
        // No proposed date yet - admin is requesting postpone
        // Only allow accept if date is not in past
        if (!isDateInPast) {
          actions.push(
            {
              id: "accept",
              label: "Accept Original Date",
              targetStatus: "accepted",
              type: "primary",
              description: "Accept the original booking date",
              requiresConfirmation: true,
              requiresValidation: true,
            }
          )
        }
        actions.push(
          {
            id: "reject",
            label: "Reject",
            targetStatus: "rejected",
            type: "destructive",
            description: "Reject this booking",
            requiresConfirmation: true,
            requiresValidation: false,
          }
        )
      }
      break
      
    case "checked-in":
      actions.push(
        {
          id: "postpone",
          label: "Postpone",
          targetStatus: "postponed",
          type: "secondary",
          description: "Request user to propose a new date",
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
      
    case "rejected":
      // Only allow accept if date is not in past
      if (!isDateInPast) {
        actions.push(
          {
            id: "accept",
            label: "Re-open & Accept",
            targetStatus: "accepted",
            type: "primary",
            description: "Re-open and accept this booking",
            requiresConfirmation: true,
            requiresValidation: true,
          }
        )
      }
      actions.push(
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
      // Only allow accept if date is not in past
      if (!isDateInPast) {
        actions.push(
          {
            id: "accept",
            label: "Re-open & Accept",
            targetStatus: "accepted",
            type: "primary",
            description: "Re-open and accept this booking",
            requiresConfirmation: true,
            requiresValidation: true,
          }
        )
      }
      break
      
    case "finished":
      // No actions available for finished bookings
      break
  }
  
  return actions
}

/**
 * Validate if an action is allowed for a given status
 */
export function isActionAllowed(
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
  hasProposedDate: boolean = false,
  isDateInPast: boolean = false
): ActionDefinition | null {
  const availableActions = getAvailableActions(
    currentStatus,
    hasProposedDate,
    false,
    isDateInPast
  )
  
  return availableActions.find((a) => a.id === action) || null
}

