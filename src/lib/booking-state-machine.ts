/**
 * Booking State Machine
 * 
 * Defines valid state transitions and action availability for booking management.
 * This ensures UI prevents invalid actions before they reach the backend.
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
    accept: "pending_deposit", // Accept from pending -> pending_deposit (immediate)
    reject: "cancelled", // Reject -> cancelled (rejected merged into cancelled)
    accept_deposit: "confirmed", // Accept deposit -> confirmed (from paid_deposit, normal flow)
    accept_deposit_other_channel: "confirmed", // Accept deposit -> confirmed (from paid_deposit, other channel)
    reject_deposit: "pending_deposit", // Reject deposit -> pending_deposit (user can re-upload)
    cancel: "cancelled",
    change_date: currentStatus, // Date change doesn't change status
    confirm_other_channel: "confirmed", // Confirm from pending_deposit -> confirmed (other channel)
  }
  
  return mapping[action]
}

/**
 * Get available actions for a given booking status
 * @param currentStatus - Current booking status
 * @param hasDepositEvidence - Whether booking has deposit evidence
 * @param isDateInPast - Whether booking date is in the past (optional, for filtering accept action)
 */
export function getAvailableActions(
  currentStatus: BookingStatus,
  hasDepositEvidence: boolean = false,
  isDateInPast: boolean = false
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
  hasDepositEvidence: boolean = false,
  isDateInPast: boolean = false
): ActionDefinition | null {
  const availableActions = getAvailableActions(
    currentStatus,
    hasDepositEvidence,
    isDateInPast
  )
  
  return availableActions.find((a) => a.id === action) || null
}

