"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertTriangle, Trash2, Loader2 } from "lucide-react"

interface GenericDeleteConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  itemName?: string
  itemDetails?: React.ReactNode
  warningMessage?: string
  onConfirm: () => void
  onCancel: () => void
  isLoading?: boolean
  confirmButtonText?: string
  cancelButtonText?: string
}

export function GenericDeleteConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  itemName,
  itemDetails,
  warningMessage = "This action cannot be undone.",
  onConfirm,
  onCancel,
  isLoading = false,
  confirmButtonText = "Delete",
  cancelButtonText = "Cancel",
}: GenericDeleteConfirmationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <Trash2 className="w-5 h-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Warning Alert */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Permanent Deletion</AlertTitle>
            <AlertDescription>
              {warningMessage}
            </AlertDescription>
          </Alert>

          {/* Item Details */}
          {itemName && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm font-medium text-gray-900">
                {itemName}
              </p>
              {itemDetails && (
                <div className="mt-2 text-sm text-gray-600">
                  {itemDetails}
                </div>
              )}
            </div>
          )}

          {/* Custom Details */}
          {!itemName && itemDetails && (
            <div className="bg-gray-50 p-4 rounded-lg">
              {itemDetails}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            {cancelButtonText}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                {confirmButtonText}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

