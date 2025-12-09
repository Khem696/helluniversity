"use client"

import React, { useState, useEffect, useCallback, useMemo } from "react"
import { redirect } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Plus, Trash2, Edit, Loader2, Calendar, Image as ImageIcon, X, Check, GripVertical, CheckSquare, Square } from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { TZDate } from '@date-fns/tz'
import { createBangkokTimestamp } from "@/lib/timezone-client"
import { useInfiniteAdminData } from "@/hooks/useInfiniteAdminData"
import { API_PATHS, buildApiUrl } from "@/lib/api-config"
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll"
import { GenericDeleteConfirmationDialog } from "@/components/admin/GenericDeleteConfirmationDialog"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { logError, logWarn, logInfo, logDebug } from "@/lib/client-logger"

interface Event {
  id: string
  title: string
  description: string | null
  image_id: string | null
  event_date: number | null
  start_date: number | null
  end_date: number | null
  created_at: number
  updated_at: number
  image_url: string | null
  image_title: string | null
  in_event_photos?: Array<{
    id: string
    image_id: string
    display_order: number
    blob_url: string
    title: string | null
    width: number
    height: number
  }>
}

interface Image {
  id: string
  blob_url: string
  title: string | null
  category: string | null
}

// Sortable photo item component
function SortablePhotoItem({
  photo,
  eventId,
  onRemove,
  saving,
  removing,
  isSelected,
  onSelect,
  showCheckbox,
}: {
  photo: {
    id: string
    image_id: string
    display_order: number
    blob_url: string
    title: string | null
    width: number
    height: number
  }
  eventId: string
  onRemove: (eventId: string, eventImageId: string) => void
  saving: boolean
  removing: boolean
  isSelected?: boolean
  onSelect?: (photoId: string, selected: boolean) => void
  showCheckbox?: boolean
}) {
  // CRITICAL: Validate props at runtime for robustness
  // Note: Hooks must be called unconditionally, so we validate after hook calls
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo?.id || 'invalid' })
  
  // CRITICAL: Validate props after hooks (React rules require hooks to be called unconditionally)
  if (!photo || typeof photo !== 'object' || !photo.id || typeof photo.id !== 'string' || photo.id.trim().length === 0) {
    logError("Invalid photo prop in SortablePhotoItem", { component: "SortablePhotoItem", photo })
    return null
  }
  if (!eventId || typeof eventId !== 'string' || eventId.trim().length === 0) {
    logError("Invalid eventId prop in SortablePhotoItem", { component: "SortablePhotoItem", eventId })
    return null
  }
  if (typeof onRemove !== 'function') {
    logError("Invalid onRemove prop in SortablePhotoItem", { component: "SortablePhotoItem", onRemove })
    return null
  }
  if (typeof saving !== 'boolean') {
    logError("Invalid saving prop in SortablePhotoItem", { component: "SortablePhotoItem", saving })
    return null
  }
  if (typeof removing !== 'boolean') {
    logError("Invalid removing prop in SortablePhotoItem", { component: "SortablePhotoItem", removing })
    return null
  }
  
  // CRITICAL: Validate setNodeRef is a function before using it
  if (typeof setNodeRef !== 'function') {
    logError("Invalid setNodeRef from useSortable", { component: "SortablePhotoItem", setNodeRef })
    return null
  }

  // CRITICAL: Validate transform and transition before using in style object
  const safeTransform = transform && typeof transform === 'object' && CSS && typeof CSS.Transform === 'object' && typeof CSS.Transform.toString === 'function'
    ? CSS.Transform.toString(transform)
    : undefined
  const safeTransition = typeof transition === 'string' ? transition : undefined
  const safeOpacity = typeof isDragging === 'boolean' ? (isDragging ? 0.5 : 1) : 1

  const style = {
    transform: safeTransform,
    transition: safeTransition,
    opacity: safeOpacity,
  }

  const isPendingDeletion = false // Will be managed by parent

  // CRITICAL: Validate setNodeRef before using it in JSX
  const safeSetNodeRef = typeof setNodeRef === 'function' ? setNodeRef : undefined

  return (
    <div ref={safeSetNodeRef} style={style} className="relative group">
      <div className={`aspect-square bg-gray-100 rounded overflow-hidden border-2 transition-colors ${
        (typeof isSelected === 'boolean' && isSelected) ? 'border-blue-500 ring-2 ring-blue-300' : 
        isPendingDeletion ? 'border-red-300 opacity-50' :
        'border-transparent hover:border-blue-300'
      }`}>
        <img
          src={photo.blob_url || ''}
          alt={photo.title || "Event photo"}
          className="w-full h-full object-cover"
          onError={(e) => {
            // CRITICAL: Handle image loading errors gracefully
            const target = e.currentTarget
            if (target && target instanceof HTMLImageElement) {
              target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="%23e5e7eb"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="12"%3EImage%3C/text%3E%3C/svg%3E'
              target.alt = "Failed to load image"
            }
          }}
        />
        {/* Checkbox - show when selection mode is active */}
        {(typeof showCheckbox === 'boolean' && showCheckbox) && typeof onSelect === 'function' && (typeof saving === 'boolean' && !saving) && (typeof removing === 'boolean' && !removing) && (
          <button
            type="button"
            onClick={(e) => {
              // CRITICAL: Validate event exists before calling stopPropagation
              if (e && typeof e.stopPropagation === 'function') {
              e.stopPropagation()
              }
              // CRITICAL: Validate onSelect is a function and photo.id is valid before calling
              if (typeof onSelect === 'function' && photo.id && typeof photo.id === 'string' && photo.id.trim().length > 0) {
                // CRITICAL: Validate isSelected is boolean before negation
                const safeIsSelected = typeof isSelected === 'boolean' ? isSelected : false
                onSelect(photo.id, !safeIsSelected)
              } else {
                logError("Invalid onSelect callback or photo.id in SortablePhotoItem", { component: "SortablePhotoItem", onSelect, photoId: photo.id })
              }
            }}
            className="absolute top-2 left-2 bg-white/90 hover:bg-white border-2 border-gray-300 rounded p-1 opacity-100 transition-opacity z-10"
            aria-label={(typeof isSelected === 'boolean' && isSelected) ? "Deselect photo" : "Select photo"}
          >
            {(typeof isSelected === 'boolean' && isSelected) ? (
              <CheckSquare className="w-4 h-4 text-blue-600" />
            ) : (
              <Square className="w-4 h-4 text-gray-400" />
            )}
          </button>
        )}
        {/* Drag handle - show when not saving/removing
            Position: top-right when checkboxes are shown, top-left when checkboxes are hidden */}
        {(typeof saving === 'boolean' && !saving) && (typeof removing === 'boolean' && !removing) && (
          <div
            {...(attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {})}
            {...(listeners && typeof listeners === 'object' && !Array.isArray(listeners) ? listeners : {})}
            className={`absolute ${typeof showCheckbox === 'boolean' && showCheckbox ? 'top-2 right-2' : 'top-2 left-2'} bg-black/50 hover:bg-black/70 text-white p-1 rounded cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity z-10`}
            role="button"
            tabIndex={0}
            aria-label="Drag to reorder photo"
            onKeyDown={(e) => {
              // CRITICAL: Enable keyboard navigation for drag handle
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                // Trigger drag start on Enter/Space
                if (listeners && typeof listeners === 'object' && !Array.isArray(listeners) && typeof listeners.onPointerDown === 'function') {
                  // Create a synthetic pointer event for keyboard activation
                  const syntheticEvent = {
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    currentTarget: e.currentTarget,
                    target: e.currentTarget,
                  } as any
                  listeners.onPointerDown(syntheticEvent)
                }
              }
            }}
          >
            <GripVertical className="w-4 h-4" aria-hidden="true" />
          </div>
        )}
      </div>
      {/* Single delete button - only show when not in selection mode */}
      {(typeof showCheckbox === 'boolean' && !showCheckbox) && (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => {
            // CRITICAL: Validate onRemove is a function and parameters are valid before calling
            if (typeof onRemove === 'function' && eventId && typeof eventId === 'string' && eventId.trim().length > 0 && photo.id && typeof photo.id === 'string' && photo.id.trim().length > 0) {
              onRemove(eventId, photo.id)
            } else {
              logError("Invalid onRemove callback or parameters in SortablePhotoItem", { component: "SortablePhotoItem", onRemove, eventId, photoId: photo.id })
            }
          }}
          disabled={saving || removing}
        >
          {removing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Trash2 className="w-3 h-3" />
          )}
        </Button>
      )}
      <div className="text-xs text-gray-500 mt-1 text-center">
        Order: {photo.display_order}
      </div>
    </div>
  )
}

export default function EventsPage() {
  const { data: session, status } = useSession()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reorderingPhotos, setReorderingPhotos] = useState(false)
  const [removingPhoto, setRemovingPhoto] = useState<string | null>(null) // Track which photo is being removed
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set()) // Track selected photos for bulk delete
  const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(new Set()) // Track photos pending deletion
  const [eventSnapshot, setEventSnapshot] = useState<Event | null>(null) // Snapshot for fallback
  const [formKey, setFormKey] = useState(0) // Key to force form remount on restore
  
  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = React.useRef(true)
  
  // Track abort controllers for cleanup
  const abortControllersRef = React.useRef<AbortController[]>([])
  
  // CRITICAL: Use ref to track reordering state synchronously (prevents race conditions)
  const isReorderingRef = React.useRef(false)
  
  // State declarations (must be before useEffect hooks that use them)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [addingPhoto, setAddingPhoto] = useState(false)
  const [createImageOpen, setCreateImageOpen] = useState(false)
  const [editImageOpen, setEditImageOpen] = useState(false)
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
  const [editSelectedImageId, setEditSelectedImageId] = useState<string | null>(null)
  const [images, setImages] = useState<Image[]>([])
  const [posterFile, setPosterFile] = useState<File | null>(null)
  const [posterPreview, setPosterPreview] = useState<string | null>(null)
  const [editPosterFile, setEditPosterFile] = useState<File | null>(null)
  const [editPosterPreview, setEditPosterPreview] = useState<string | null>(null)
  
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // CRITICAL: Abort all pending requests on unmount
      // CRITICAL: Validate abortControllersRef.current is an array before using forEach
      if (Array.isArray(abortControllersRef.current)) {
      abortControllersRef.current.forEach(controller => {
        try {
            if (controller && typeof controller.abort === 'function') {
          controller.abort()
            }
        } catch (error) {
          // Ignore errors during cleanup
        }
      })
      }
      abortControllersRef.current = []
      
      // CRITICAL: Clear FileReader instances (they can't be aborted, but we clear the ref)
      // The onloadend callbacks will check isMountedRef before updating state
      fileReadersRef.current = []
      
      // CRITICAL: Cleanup all blob URLs on unmount
      if (previewBlobUrlsRef.current instanceof Set) {
        previewBlobUrlsRef.current.forEach(url => {
          if (url && typeof url === 'string' && url.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(url)
            } catch (error) {
              // Ignore errors during cleanup
            }
          }
        })
        previewBlobUrlsRef.current.clear()
      }
      
      // CRITICAL: Cleanup poster previews on unmount (if they are blob URLs)
      // Note: FileReader.readAsDataURL creates data URLs, but we check for blob: for safety
      if (posterPreview && typeof posterPreview === 'string' && posterPreview.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(posterPreview)
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
      if (editPosterPreview && typeof editPosterPreview === 'string' && editPosterPreview.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(editPosterPreview)
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
    }
  }, [posterPreview, editPosterPreview])
  
  // Warn user before leaving page with unsaved changes
  // CRITICAL: Check for form field changes by comparing with snapshot
  useEffect(() => {
    if (!editDialogOpen || !editingEvent) return
    
    // Check if there are any unsaved changes:
    // 1. Pending deletions
    // 2. New poster file
    // 3. Form field changes (by comparing with snapshot)
    // CRITICAL: Validate pendingDeletions is a Set before using .size
    const hasPendingDeletions = pendingDeletions instanceof Set && pendingDeletions.size > 0
    const hasNewPoster = editPosterFile !== null
    
    // Check form field changes by comparing current editingEvent with snapshot
    let hasFormChanges = false
    if (eventSnapshot) {
      hasFormChanges = 
        editingEvent.title !== eventSnapshot.title ||
        editingEvent.description !== eventSnapshot.description ||
        editingEvent.event_date !== eventSnapshot.event_date ||
        editingEvent.start_date !== eventSnapshot.start_date ||
        editingEvent.end_date !== eventSnapshot.end_date ||
        editingEvent.image_id !== eventSnapshot.image_id
    }
    
    const hasUnsavedChanges = hasPendingDeletions || hasNewPoster || hasFormChanges
    
    if (!hasUnsavedChanges) return
    
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Modern browsers ignore custom messages, but we still need to set returnValue
      // CRITICAL: Validate event exists before calling preventDefault
      if (e && typeof e.preventDefault === 'function') {
      e.preventDefault()
      e.returnValue = '' // Empty string triggers default browser message
      }
      return e.returnValue
    }
    
    // Note: popstate is harder to intercept reliably across browsers
    // We rely on beforeunload for most cases
    
    // CRITICAL: Validate window exists before using addEventListener
    if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', handleBeforeUnload)
    }
    
    return () => {
      // CRITICAL: Validate window exists before using removeEventListener
      if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
    }
  }, [editDialogOpen, editingEvent, pendingDeletions instanceof Set ? pendingDeletions.size : 0, editPosterFile, eventSnapshot])
  
  
  // Initialize drag and drop sensors - must be called at top level (hooks rule)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  
  // CRITICAL: Always pass the same sensors array to prevent dependency array size changes
  // DndContext internally uses useEffect with sensors in dependency array
  // When we switch between arrays of different lengths, React sees the dependency array size change
  // Solution: Always pass the sensors array, but prevent drag operations in handlers when needed
  // This ensures the array reference structure is always the same
  const stableSensors = useMemo(() => sensors, [sensors])
  
  // CRITICAL: Memoize the sortable items array to ensure SortableContext detects changes
  // This prevents the need for multiple drag operations to see UI updates
  // The items array should only change when editingEvent.in_event_photos or pendingDeletions changes
  // IMPORTANT: Include editingEvent itself in dependencies to ensure we detect all changes
  const sortableItems = useMemo(() => {
    if (!editingEvent || !Array.isArray(editingEvent.in_event_photos)) return []
    // Create a new array reference to ensure React detects the change
    const filtered = editingEvent.in_event_photos
      .filter(p => p?.id && typeof p.id === 'string' && (pendingDeletions instanceof Set ? !pendingDeletions.has(p.id) : true))
    // Map to IDs and create a new array reference
    return filtered.map((p) => p.id)
  }, [editingEvent, pendingDeletions])
  const [inEventPhotoFiles, setInEventPhotoFiles] = useState<File[]>([])
  const [inEventPhotoPreviews, setInEventPhotoPreviews] = useState<Array<{ file: File; preview: string; previewId: string; originalSelectionIndex: number }>>([])
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number }>({ uploaded: 0, total: 0 })
  
  // Track blob URLs for cleanup (data URLs from FileReader)
  const previewBlobUrlsRef = React.useRef<Set<string>>(new Set())
  
  // Track FileReader instances for cleanup on unmount
  const fileReadersRef = React.useRef<FileReader[]>([])
  
  // Generate stable ID for preview based on file properties
  // If duplicate IDs are detected, adds a unique suffix
  const generatePreviewId = (file: File, existingIds: Set<string> = new Set()): string => {
    // CRITICAL: Validate file properties before using them
    const fileName = file?.name || 'unknown'
    const fileSize = file?.size ?? 0
    const lastModified = file?.lastModified ?? Date.now()
    
    // Use file name, size, and lastModified to create stable ID
    // This ensures same file gets same ID even if order changes
    let baseId = `preview-${fileName}-${fileSize}-${lastModified}`
    
    // CRITICAL: Validate existingIds is a Set before using it
    const idsSet = existingIds instanceof Set ? existingIds : new Set<string>()
    
    // If this ID already exists, add a unique suffix
    // CRITICAL: Add safety limit to prevent infinite loop
    if (idsSet.has(baseId)) {
      let counter = 1
      const maxIterations = 10000 // Safety limit to prevent infinite loop
      let uniqueId = `${baseId}-${counter}`
      while (idsSet.has(uniqueId) && counter < maxIterations) {
        counter++
        uniqueId = `${baseId}-${counter}`
      }
      // If we hit the limit, add timestamp to ensure uniqueness
      if (counter >= maxIterations) {
        // CRITICAL: Validate Math.random().toString(36) result before substring
        const randomStr = Math.random().toString(36)
        // CRITICAL: Ensure randomStr has at least 2 characters before calling substring(2)
        // Math.random().toString(36) always returns a string starting with "0." so length >= 2 is guaranteed
        // But add defensive check to prevent potential edge cases
        let safeSubstring: string
        if (randomStr.length >= 9) {
          safeSubstring = randomStr.substring(2, 9)
        } else if (randomStr.length >= 2) {
          safeSubstring = randomStr.substring(2)
        } else {
          // Fallback: generate a new random string (should never happen, but defensive)
          const fallbackStr = Math.random().toString(36)
          safeSubstring = fallbackStr.length >= 5 ? fallbackStr.substring(2, 5) : fallbackStr.substring(2) || 'xyz'
        }
        uniqueId = `${baseId}-${Date.now()}-${safeSubstring}`
      }
      baseId = uniqueId
    }
    
    return baseId
  }
  
  // Unified photo list state for upload modal (existing + new previews)
  type UnifiedPhotoItem = {
    id: string // For existing: photo.id, for new: stable previewId
    isExisting: boolean
    isSelected: boolean
    // For existing photos
    existingPhoto?: {
      id: string
      image_id: string
      display_order: number
      blob_url: string
      title: string | null
      width: number
      height: number
    }
    // For new previews
    previewData?: {
      file: File
      preview: string
      previewId: string
      originalSelectionIndex: number
    }
  }
  const [unifiedPhotoList, setUnifiedPhotoList] = useState<UnifiedPhotoItem[]>([])
  
  // Cleanup object URLs for preview images to prevent memory leaks
  useEffect(() => {
    return () => {
      // Cleanup poster preview (create dialog)
      // CRITICAL: FileReader.readAsDataURL creates data URLs, not blob URLs, but we check for blob: for safety
      if (posterPreview && typeof posterPreview === 'string' && posterPreview.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(posterPreview)
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
      // Cleanup edit poster preview
      if (editPosterPreview && typeof editPosterPreview === 'string' && editPosterPreview.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(editPosterPreview)
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
      // Cleanup in-event photo previews
      if (Array.isArray(inEventPhotoPreviews)) {
        inEventPhotoPreviews.forEach(preview => {
          if (preview?.preview && typeof preview.preview === 'string' && preview.preview.startsWith('blob:')) {
            try {
              URL.revokeObjectURL(preview.preview)
            } catch (error) {
              // Ignore errors during cleanup
            }
            // CRITICAL: Validate previewBlobUrlsRef.current is a Set before using delete
            if (previewBlobUrlsRef.current instanceof Set) {
              previewBlobUrlsRef.current.delete(preview.preview)
            }
          }
        })
      }
      // Clear the ref
      // CRITICAL: Validate previewBlobUrlsRef.current is a Set before clearing
      if (previewBlobUrlsRef.current instanceof Set) {
        previewBlobUrlsRef.current.clear()
      }
    }
  }, [posterPreview, editPosterPreview, inEventPhotoPreviews])
  
  // Sync unified photo list when editingEvent or previews change
  useEffect(() => {
    if (!editingEvent || !addingPhoto) {
      if (!addingPhoto) {
        if (isMountedRef.current) {
          setUnifiedPhotoList([])
        }
      }
      return
    }
    
    // Preserve selection state when rebuilding list
    // Use functional update to avoid stale closure
    setUnifiedPhotoList(prevList => {
      // CRITICAL: Validate prevList is an array before using map
      const validPrevList = Array.isArray(prevList) ? prevList : []
      const selectionMap = new Map(validPrevList.map(item => [item?.id, item?.isSelected]))
      
      // CRITICAL: Validate photo properties before using them
      const existingPhotos: UnifiedPhotoItem[] = (Array.isArray(editingEvent.in_event_photos) ? editingEvent.in_event_photos : [])
        .filter(photo => photo?.id && typeof photo.id === 'string')
        .map(photo => {
          // CRITICAL: Validate photo.id exists before using (replace non-null assertion)
          const photoId = photo?.id && typeof photo.id === 'string' ? photo.id : `photo-${Date.now()}-${Math.random()}`
          return {
            id: photoId,
            isExisting: true,
            isSelected: Boolean((photo.id && selectionMap.get(photo.id)) ?? true), // Preserve selection or default to selected (ensure boolean)
            existingPhoto: photo,
          }
        })
      
      // CRITICAL: Validate preview properties before using them
      const newPreviews: UnifiedPhotoItem[] = (Array.isArray(inEventPhotoPreviews) ? inEventPhotoPreviews : [])
        .filter(preview => preview?.previewId && preview?.file && preview?.preview)
        .map((preview) => {
          // CRITICAL: Validate preview properties exist before using (replace non-null assertions)
          const previewId = preview?.previewId && typeof preview.previewId === 'string' ? preview.previewId : `preview-${Date.now()}-${Math.random()}`
          const previewFile = preview?.file && preview.file instanceof File ? preview.file : null
          const previewUrl = preview?.preview && typeof preview.preview === 'string' ? preview.preview : ''
          if (!previewFile || !previewUrl) {
            // Skip invalid previews - return undefined to filter out
            return undefined
          }
          return {
            id: previewId,
            isExisting: false,
            isSelected: Boolean((preview.previewId && selectionMap.get(preview.previewId)) ?? true), // Preserve selection or default to selected (ensure boolean)
            previewData: {
              file: previewFile,
              preview: previewUrl,
              previewId: previewId,
              originalSelectionIndex: typeof preview.originalSelectionIndex === 'number' ? preview.originalSelectionIndex : Infinity,
            },
          } as UnifiedPhotoItem
        })
        .filter((item): item is UnifiedPhotoItem => item !== undefined && item !== null)
      
      // Merge and maintain order: existing first (by display_order), then new previews
      // CRITICAL: Validate display_order values are numbers before sorting
      // CRITICAL: Sort new previews by originalSelectionIndex to preserve user's file selection order
      const sortedExistingPhotos = existingPhotos.sort((a, b) => {
        const orderA = typeof a.existingPhoto?.display_order === 'number' && !isNaN(a.existingPhoto.display_order) ? a.existingPhoto.display_order : 0
        const orderB = typeof b.existingPhoto?.display_order === 'number' && !isNaN(b.existingPhoto.display_order) ? b.existingPhoto.display_order : 0
        return orderA - orderB
      })
      // CRITICAL: Sort new previews by originalSelectionIndex to preserve user's file selection order
      // This ensures previews appear in the order files were selected, not by file date
      const sortedNewPreviews = newPreviews.sort((a, b) => {
        const indexA = typeof a.previewData?.originalSelectionIndex === 'number' ? a.previewData.originalSelectionIndex : Infinity
        const indexB = typeof b.previewData?.originalSelectionIndex === 'number' ? b.previewData.originalSelectionIndex : Infinity
        return indexA - indexB
      })
      const merged = [
        ...sortedExistingPhotos,
        ...sortedNewPreviews,
      ]
      
      // Only update if the list actually changed (to prevent infinite loops)
      const currentIds = prevList.filter(item => item?.id).map(item => item.id).join(',')
      const newIds = merged.filter(item => item?.id).map(item => item.id).join(',')
      if (currentIds !== newIds || prevList.length !== merged.length) {
        return merged
      }
      return prevList
    })
  }, [editingEvent?.id, editingEvent?.in_event_photos?.length, inEventPhotoPreviews, addingPhoto])
  
  // Sortable unified photo item component
  function SortableUnifiedPhotoItem({
    item,
    onToggleSelect,
    disabled = false,
  }: {
    item: UnifiedPhotoItem
    onToggleSelect: (id: string, selected: boolean) => void
    disabled?: boolean
  }) {
    // CRITICAL: Validate disabled prop before hook call (it's used in hook)
    const safeDisabled = typeof disabled === 'boolean' ? disabled : false
    
    // CRITICAL: Hooks must be called unconditionally, so we validate after hook calls
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: item?.id || 'invalid', disabled: safeDisabled })
    
    // CRITICAL: Validate props after hooks (React rules require hooks to be called unconditionally)
    if (!item || typeof item !== 'object' || !item.id || typeof item.id !== 'string' || item.id.trim().length === 0) {
      logError("Invalid item prop in SortableUnifiedPhotoItem", { component: "SortableUnifiedPhotoItem", item })
      return null
    }
    if (typeof onToggleSelect !== 'function') {
      logError("Invalid onToggleSelect prop in SortableUnifiedPhotoItem", { component: "SortableUnifiedPhotoItem", onToggleSelect })
      return null
    }
    
    // CRITICAL: Validate setNodeRef is a function before using it
    if (typeof setNodeRef !== 'function') {
      logError("Invalid setNodeRef from useSortable", { component: "SortableUnifiedPhotoItem", setNodeRef })
      return null
    }
    
  // CRITICAL: Validate transform and transition before using in style object
  const safeTransform = transform && typeof transform === 'object' && CSS && typeof CSS.Transform === 'object' && typeof CSS.Transform.toString === 'function'
    ? CSS.Transform.toString(transform)
    : undefined
  const safeTransition = typeof transition === 'string' ? transition : undefined
  const safeOpacity = typeof isDragging === 'boolean' ? (isDragging ? 0.5 : 1) : 1
  
  const style = {
    transform: safeTransform,
    transition: safeTransition,
    opacity: safeOpacity,
  }
    
    const imageUrl = item.isExisting 
      ? item.existingPhoto?.blob_url 
      : item.previewData?.preview
    const imageTitle = item.isExisting 
      ? item.existingPhoto?.title || "Event photo"
      : item.previewData?.file.name
    
    // CRITICAL: Validate setNodeRef before using it in JSX
    const safeSetNodeRef = typeof setNodeRef === 'function' ? setNodeRef : undefined
    
    return (
      <div ref={safeSetNodeRef} style={style} className="relative group">
        <div className={`aspect-square bg-gray-100 rounded-lg overflow-hidden border-2 transition-colors ${
          (typeof item.isSelected === 'boolean' && item.isSelected)
            ? 'border-blue-500 ring-2 ring-blue-300' 
            : 'border-transparent hover:border-gray-300'
        } ${(typeof item.isExisting === 'boolean' && item.isExisting) ? 'border-green-400' : 'border-orange-400'}`}>
          {imageUrl && (
            <img
              src={imageUrl || ''}
              alt={imageTitle || "Photo"}
              className="w-full h-full object-cover"
              onError={(e) => {
                // CRITICAL: Handle image loading errors gracefully
                const target = e.currentTarget
                if (target && target instanceof HTMLImageElement) {
                  target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="%23e5e7eb"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="12"%3EImage%3C/text%3E%3C/svg%3E'
                  target.alt = "Failed to load image"
                }
              }}
            />
          )}
          {/* Drag handle */}
          {(typeof disabled === 'boolean' && !disabled) && (
            <div
              {...(attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {})}
              {...(listeners && typeof listeners === 'object' && !Array.isArray(listeners) ? listeners : {})}
              className="absolute top-2 left-2 bg-black/50 hover:bg-black/70 text-white p-1 rounded cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
              role="button"
              tabIndex={0}
              aria-label="Drag to reorder photo"
              onKeyDown={(e) => {
                // CRITICAL: Enable keyboard navigation for drag handle
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  // Trigger drag start on Enter/Space
                  if (listeners && typeof listeners === 'object' && !Array.isArray(listeners) && typeof listeners.onPointerDown === 'function') {
                    // Create a synthetic pointer event for keyboard activation
                    const syntheticEvent = {
                      preventDefault: () => {},
                      stopPropagation: () => {},
                      currentTarget: e.currentTarget,
                      target: e.currentTarget,
                    } as any
                    listeners.onPointerDown(syntheticEvent)
                  }
                }
              }}
            >
              <GripVertical className="w-4 h-4" aria-hidden="true" />
            </div>
          )}
          {/* Selection checkbox */}
          <div className="absolute top-2 right-2">
            <button
              type="button"
              onClick={(e) => {
                // CRITICAL: Validate event exists before calling stopPropagation
                if (e && typeof e.stopPropagation === 'function') {
                  e.stopPropagation()
                }
                if (disabled) return
                // CRITICAL: Validate onToggleSelect is a function and item.id is valid before calling
                if (typeof onToggleSelect === 'function' && item.id && typeof item.id === 'string' && item.id.trim().length > 0) {
                  onToggleSelect(item.id, !item.isSelected)
                } else {
                  logError("Invalid onToggleSelect callback or item.id in SortableUnifiedPhotoItem", { component: "SortableUnifiedPhotoItem", onToggleSelect, itemId: item.id })
                }
              }}
              disabled={disabled}
              className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                disabled 
                  ? "bg-gray-200 border-gray-300 cursor-not-allowed opacity-50"
                  : item.isSelected
                    ? "bg-blue-500 border-blue-500"
                    : "bg-white border-gray-300 hover:border-blue-300"
              }`}
            >
              {item.isSelected && <Check className="w-4 h-4 text-white" />}
            </button>
          </div>
          {/* Badge to distinguish existing vs new */}
          <div className={`absolute bottom-2 left-2 px-2 py-1 rounded text-xs font-semibold ${
            item.isExisting 
              ? 'bg-green-500 text-white' 
              : 'bg-orange-500 text-white'
          }`}>
            {item.isExisting ? 'Existing' : 'New'}
          </div>
          {/* Display order badge */}
          {item.isExisting && item.existingPhoto && (
            <div className="absolute bottom-2 right-2 bg-gray-800/70 text-white px-2 py-1 rounded text-xs">
              Order: {item.existingPhoto.display_order}
            </div>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-1 truncate">
          {imageTitle}
        </div>
      </div>
    )
  }
  const createFormRef = React.useRef<HTMLFormElement>(null)
  const [titleFilter, setTitleFilter] = useState("")
  const [debouncedTitleFilter, setDebouncedTitleFilter] = useState("")
  const [upcomingFilter, setUpcomingFilter] = useState(false)
  
  // Debounce title search input (500ms delay)
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
      setDebouncedTitleFilter(titleFilter)
      }
    }, 500)
    return () => {
      // CRITICAL: Validate timer exists before clearing
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [titleFilter])
  const [eventDateFilter, setEventDateFilter] = useState("")
  const [eventDateFrom, setEventDateFrom] = useState("")
  const [eventDateTo, setEventDateTo] = useState("")
  const [useDateRange, setUseDateRange] = useState(false)
  const [sortBy, setSortBy] = useState<"created_at" | "updated_at" | "start_date" | "end_date" | "event_date" | "title">("created_at")
  const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">("DESC")
  const [pageSize, setPageSize] = useState(25)
  
  // Build base endpoint with filters (without limit/offset for infinite scroll)
  // Use debounced title filter to prevent refetch on every keystroke
  const baseEndpoint = React.useMemo(() => {
    const params = new URLSearchParams()
    if (upcomingFilter) {
      params.append("upcoming", "true")
    }
    // CRITICAL: Validate debouncedTitleFilter is a string before appending
    if (debouncedTitleFilter && typeof debouncedTitleFilter === 'string' && debouncedTitleFilter.trim().length > 0) {
      params.append("title", debouncedTitleFilter.trim())
    }
    if (useDateRange) {
      // CRITICAL: Validate eventDateFrom is a string before appending
      if (eventDateFrom && typeof eventDateFrom === 'string' && eventDateFrom.trim().length > 0) {
        // CRITICAL: Validate date range - from date should not be after to date (defensive check)
        if (eventDateTo && typeof eventDateTo === 'string' && eventDateTo.trim().length > 0) {
          if (eventDateFrom.trim() > eventDateTo.trim()) {
            logWarn("Invalid date range in filter: from date is after to date", { function: "baseEndpoint", eventDateFrom, eventDateTo })
            // Skip invalid date range - don't append either date to prevent API errors
            // User will see no results, which is better than a broken API call
          } else {
            params.append("eventDateFrom", eventDateFrom.trim())
            params.append("eventDateTo", eventDateTo.trim())
          }
        } else {
          // Only from date is set - append it
          params.append("eventDateFrom", eventDateFrom.trim())
        }
      } else if (eventDateTo && typeof eventDateTo === 'string' && eventDateTo.trim().length > 0) {
        // Only to date is set - append it
        params.append("eventDateTo", eventDateTo.trim())
      }
    } else if (eventDateFilter && typeof eventDateFilter === 'string' && eventDateFilter.trim().length > 0) {
      // CRITICAL: Validate eventDateFilter is a string before appending
      params.append("eventDate", eventDateFilter.trim())
    }
    // CRITICAL: Validate sortBy is a string before appending
    if (sortBy && typeof sortBy === 'string') {
    params.append("sortBy", sortBy)
    } else {
      // Fallback to default if sortBy is invalid
      params.append("sortBy", "created_at")
      logWarn("Invalid sortBy value, using default", { function: "baseEndpoint", sortBy })
    }
    // CRITICAL: Validate sortOrder is a string before appending
    if (sortOrder && typeof sortOrder === 'string' && (sortOrder === 'ASC' || sortOrder === 'DESC')) {
    params.append("sortOrder", sortOrder)
    } else {
      // Fallback to default if sortOrder is invalid
      params.append("sortOrder", "DESC")
      logWarn("Invalid sortOrder value, using default", { function: "baseEndpoint", sortOrder })
    }
    // CRITICAL: Validate params.entries() before Object.fromEntries to prevent runtime errors
    try {
      const paramsObject = Object.fromEntries(params)
      // CRITICAL: Validate paramsObject is an object before using
      if (paramsObject && typeof paramsObject === 'object' && !Array.isArray(paramsObject)) {
        return buildApiUrl(API_PATHS.adminEvents, paramsObject)
      } else {
        logError("Invalid params object created from URLSearchParams", { function: "baseEndpoint" })
        return buildApiUrl(API_PATHS.adminEvents, {})
      }
    } catch (error) {
      logError("Failed to convert URLSearchParams to object", { function: "baseEndpoint" }, error instanceof Error ? error : new Error(String(error)))
      return buildApiUrl(API_PATHS.adminEvents, {})
    }
  }, [upcomingFilter, debouncedTitleFilter, eventDateFilter, eventDateFrom, eventDateTo, useDateRange, sortBy, sortOrder])
  
  // Use infinite scroll hook for events
  const {
    data: events,
    total,
    loading,
    hasMore,
    loadMore,
    fetchData: fetchEvents,
    addItem,
    updateItem,
    removeItem,
    replaceItem
  } = useInfiniteAdminData<Event>({
    baseEndpoint,
    pageSize,
    enablePolling: true,
    pollInterval: 30000,
    transformResponse: (json) => {
      // CRITICAL: Validate json is an object before accessing properties
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        logWarn("Invalid JSON response structure in transformResponse", { function: "transformResponse", json })
        return []
      }
      // CRITICAL: Check for json.data.events first (preferred structure)
      if (json.data && typeof json.data === 'object' && !Array.isArray(json.data) && Array.isArray(json.data.events)) {
        return json.data.events
      }
      // CRITICAL: Fallback to json.events (alternative structure)
      if (Array.isArray(json.events)) {
        return json.events
      }
      // CRITICAL: Return empty array if neither structure is found
      logWarn("No events array found in response", { function: "transformResponse", json })
      return []
    },
    isDialogOpen: () => createDialogOpen || editDialogOpen,
  })
  
  // Infinite scroll setup
  const { elementRef: scrollSentinelRef } = useInfiniteScroll({
    hasMore,
    loading,
    onLoadMore: loadMore,
    threshold: 200,
    enabled: !!session && !createDialogOpen && !editDialogOpen,
  })

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      redirect("/admin/login")
    }
  }, [status])


  // Fetch event details with in-event photos
  const fetchEventDetails = async (eventId: string, signal?: AbortSignal) => {
    // Simple validation: Check eventId is valid
    if (!eventId || typeof eventId !== 'string' || eventId.trim().length === 0) {
      logError("Invalid eventId provided to fetchEventDetails", { function: "fetchEventDetails", eventId })
      return null
    }
    try {
      const response = await fetch(API_PATHS.adminEvent(eventId), {
        signal, // Support abort signal for cancellation
      })
      
      // CRITICAL: Check if response is OK before parsing
      if (!response.ok) {
        const status = response.status || 0
        const statusText = response.statusText || 'Unknown'
        logError("Failed to fetch event details", { function: "fetchEventDetails", eventId, status, statusText })
        return null
      }
      
      // CRITICAL: Check for 204 No Content (no body to parse)
      if (response.status === 204) {
        logError("Received 204 No Content response (no body to parse)", { function: "fetchEventDetails", eventId })
        return null
      }
      
      // CRITICAL: Handle JSON parsing errors
      let json: any
      try {
        json = await response.json()
      } catch (parseError) {
        logError("Failed to parse event details JSON", { function: "fetchEventDetails", eventId }, parseError instanceof Error ? parseError : new Error(String(parseError)))
        return null
      }
      
      if (json.success) {
        // API returns { success: true, data: { event: {...} } }
        return json.data?.event || json.event || null
      }
    } catch (error) {
      // CRITICAL: Don't log AbortError (expected when cancelled)
      if (error instanceof Error && error.name !== 'AbortError') {
        logError("Failed to fetch event details", { function: "fetchEventDetails", eventId }, error)
      }
    }
    return null
  }

  // Handle bulk upload of in-event photos with selection and ordering
  const handleBulkUploadPhotos = async (eventId: string) => {
    // Simple validation: Check eventId is valid
    if (!eventId || typeof eventId !== 'string' || eventId.trim().length === 0) {
      if (isMountedRef.current) {
        toast.error("Invalid event ID. Please refresh and try again.")
      }
      return
    }
    
    // CRITICAL: Prevent concurrent uploads
    if (uploadingPhotos) {
      if (isMountedRef.current) {
        toast.warning("Upload already in progress. Please wait for it to complete.")
      }
      return
    }
    
    // CRITICAL: Capture the current order at the start to prevent race conditions
    // If user drags photos after clicking save, we use the order from when they clicked
    const currentPhotoList = unifiedPhotoList || []
    
    // Get selected items in order (from captured list)
    // CRITICAL: Validate currentPhotoList is an array before filtering
    const selectedItems = Array.isArray(currentPhotoList) ? currentPhotoList.filter(item => item.isSelected) : []
    
    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
      if (isMountedRef.current) {
        toast.error("Please select at least one photo to save")
      }
      return
    }
    
    // Separate new previews that need uploading
    const newItemsToUpload = selectedItems.filter(item => !item.isExisting && item.previewData)
    // CRITICAL: Validate existingPhoto.id exists before using (replace non-null assertion)
    const existingItemIds = selectedItems
      .filter(item => item.isExisting && item.existingPhoto && item.existingPhoto.id && typeof item.existingPhoto.id === 'string')
      .map(item => {
        // CRITICAL: Validate id exists before using
        return item.existingPhoto?.id && typeof item.existingPhoto.id === 'string' ? item.existingPhoto.id : ''
      })
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    
    // CRITICAL: Validate arrays exist before checking length
    if ((!Array.isArray(newItemsToUpload) || newItemsToUpload.length === 0) && 
        (!Array.isArray(existingItemIds) || existingItemIds.length === 0)) {
      if (isMountedRef.current) {
        toast.error("No photos selected")
      }
      return
    }

    // CRITICAL: Create abort controller for this upload operation
    const abortController = new AbortController()
    const signal = abortController.signal
    // CRITICAL: Validate abortControllersRef.current is an array before using push
    if (Array.isArray(abortControllersRef.current)) {
      abortControllersRef.current.push(abortController)
    } else {
      logError("abortControllersRef.current is not an array", { function: "fetchEventDetails", abortControllersRef: abortControllersRef.current })
      abortControllersRef.current = [abortController]
    }
    
    // Cleanup function for abort controller
    const cleanupAbortController = () => {
      // CRITICAL: Validate abortControllersRef.current is an array before using filter
      if (Array.isArray(abortControllersRef.current)) {
        abortControllersRef.current = abortControllersRef.current.filter(
          c => c !== abortController
        )
      }
    }

    // CRITICAL: Check if component is still mounted before state updates
    if (!isMountedRef.current) {
      cleanupAbortController()
      return
    }
    
    // CRITICAL: Check if component is still mounted before state updates
    if (!isMountedRef.current) {
      cleanupAbortController()
      return
    }

    setUploadingPhotos(true)
    const totalToProcess = newItemsToUpload.length
    setUploadProgress({ uploaded: 0, total: totalToProcess })

    // Flag to track if we should skip the rest of upload (instead of early return)
    let shouldSkipUpload = false
    
    // Use try-finally to ensure upload state is always reset
    // CRITICAL: Define variables outside try block so they're accessible in catch/finally
    const uploadedImageIds: string[] = []
    const errors: string[] = []
    const imageIdToEventImageIdMap = new Map<string, string>() // Map uploaded image_id to event_image.id
    // Track which preview item corresponds to which uploaded image (by preview item id)
    const previewItemIdToImageIdMap = new Map<string, string>() // Map preview item id -> uploaded image_id
    const failedPreviewItems = new Set<string>() // Track which preview items failed to upload

    try {
      // Step 1: Upload new photos if any
      if (newItemsToUpload.length > 0) {
      try {
        // Create a mapping from preview item to file, maintaining order
        const itemToFileMap = new Map<string, File>()
        const filesToUpload: File[] = []
        const itemsWithoutPreviews: string[] = [] // Track items that don't have previews
        
        for (const item of newItemsToUpload) {
          // Find preview by stable previewId instead of index
          // CRITICAL: Validate inEventPhotoPreviews is an array before using find
          // CRITICAL: Validate inEventPhotoPreviews is an array before using find
          const preview = Array.isArray(inEventPhotoPreviews) 
            ? inEventPhotoPreviews.find(p => p?.previewId && typeof p.previewId === 'string' && p.previewId === item.id)
            : undefined
          // CRITICAL: Validate preview result has required properties
          if (preview && preview.file && preview.previewId && typeof preview.previewId === 'string') {
            // CRITICAL: Validate itemToFileMap is a Map before using set
            if (itemToFileMap instanceof Map) {
              itemToFileMap.set(item.id, preview.file)
            }
            filesToUpload.push(preview.file)
          } else {
            // Track items without previews
            // CRITICAL: Validate itemsWithoutPreviews is an array before using push
            if (Array.isArray(itemsWithoutPreviews)) {
              itemsWithoutPreviews.push(item.id)
            } else {
              logError("itemsWithoutPreviews is not an array", { function: "handleBulkUploadPhotos", itemsWithoutPreviews })
            }
            failedPreviewItems.add(item.id)
          }
        }
        
        // Validate that all items have corresponding files
        if (itemsWithoutPreviews.length > 0) {
          const warningMsg = `${itemsWithoutPreviews.length} selected item${itemsWithoutPreviews.length !== 1 ? 's' : ''} ${itemsWithoutPreviews.length !== 1 ? 'do' : 'does'} not have corresponding files and will be skipped.`
          if (isMountedRef.current) {
            toast.warning(warningMsg)
          }
          // CRITICAL: Validate errors is an array before using push
          if (Array.isArray(errors)) {
            errors.push(warningMsg)
          } else {
            logError("errors is not an array", { function: "handleBulkUploadPhotos", errors })
          }
        }
        
        if (filesToUpload.length === 0) {
          if (isMountedRef.current) {
            toast.error("No files found to upload. Please select files and try again.")
          }
          // Set flag to skip rest of upload instead of returning (ensures finally block runs)
          shouldSkipUpload = true
        }
        
        // Skip rest of upload if flag is set
        if (!shouldSkipUpload) {
          // Validate that itemToFileMap matches newItemsToUpload (all items should have files)
          if (itemToFileMap.size !== newItemsToUpload.length - itemsWithoutPreviews.length) {
            const mismatchCount = newItemsToUpload.length - itemsWithoutPreviews.length - itemToFileMap.size
            const errorMsg = `${mismatchCount} item${mismatchCount !== 1 ? 's' : ''} could not be mapped to files. Upload may be incomplete.`
            if (isMountedRef.current) {
              toast.warning(errorMsg)
            }
            // CRITICAL: Validate errors is an array before using push
            if (Array.isArray(errors)) {
              errors.push(errorMsg)
            } else {
              logError("errors is not an array", { function: "handleBulkUploadPhotos", errors })
            }
          }

          // Process images on client-side
      const { processMultipleImages } = await import("@/lib/client-image-processor")
          if (isMountedRef.current) {
      toast.info("Processing images...")
          }
          
          // CRITICAL: Validate parseInt/parseFloat results to prevent NaN
          let maxWidth = parseInt(process.env.NEXT_PUBLIC_MAX_IMAGE_WIDTH || '1920', 10)
          let maxHeight = parseInt(process.env.NEXT_PUBLIC_MAX_IMAGE_HEIGHT || '1920', 10)
          let quality = parseFloat(process.env.NEXT_PUBLIC_IMAGE_QUALITY || '0.85')
          
          // CRITICAL: Validate parsed values are reasonable
          if (isNaN(maxWidth) || maxWidth <= 0 || maxWidth > 10000) {
            logWarn("Invalid maxWidth, using default 1920", { function: "handleBulkUploadPhotos", maxWidth })
            maxWidth = 1920
          }
          if (isNaN(maxHeight) || maxHeight <= 0 || maxHeight > 10000) {
            logWarn("Invalid maxHeight, using default 1920", { function: "handleBulkUploadPhotos", maxHeight })
            maxHeight = 1920
          }
          if (isNaN(quality) || quality <= 0 || quality > 1) {
            logWarn("Invalid quality, using default 0.85", { function: "handleBulkUploadPhotos", quality })
            quality = 0.85
          }
      // CRITICAL: Validate image format from environment variable
      const formatValue = process.env.NEXT_PUBLIC_IMAGE_FORMAT || 'webp'
      const validFormats = ['webp', 'jpeg', 'png']
      const format = (typeof formatValue === 'string' && validFormats.includes(formatValue.toLowerCase())) 
        ? formatValue.toLowerCase() as 'webp' | 'jpeg' | 'png'
        : 'webp' // Default to webp if invalid format
      
      const processedImages = await processMultipleImages(
            filesToUpload,
        {
          maxWidth,
          maxHeight,
          quality,
          format,
        },
        (processed, total) => {
              if (isMountedRef.current) {
                setUploadProgress({ uploaded: 0, total })
              }
            }
          )

          // Validate that we have processed images
          if (processedImages.length === 0) {
            const errorMsg = "All images failed to process. Please check your files and try again."
            if (isMountedRef.current) {
              toast.error(errorMsg)
            }
            // CRITICAL: Validate errors is an array before using push
            if (Array.isArray(errors)) {
              errors.push(errorMsg)
            } else {
              logError("errors is not an array", { function: "handleBulkUploadPhotos", errors })
            }
            // Mark all items as failed
            for (const item of newItemsToUpload) {
              // CRITICAL: Validate itemToFileMap is a Map before using has
              if (itemToFileMap instanceof Map && itemToFileMap.has(item.id)) {
                failedPreviewItems.add(item.id)
              }
            }
            shouldSkipUpload = true // Skip upload if no images were processed
          }
          
          // Continue with upload if we have processed images
          // Validate that all files were processed successfully
          if (processedImages.length !== filesToUpload.length) {
            const failedCount = filesToUpload.length - processedImages.length
            const errorMsg = `${failedCount} file${failedCount !== 1 ? 's' : ''} failed to process. Only ${processedImages.length} of ${filesToUpload.length} files will be uploaded.`
            if (isMountedRef.current) {
              toast.warning(errorMsg)
            }
            // CRITICAL: Validate errors is an array before using push
            if (Array.isArray(errors)) {
              errors.push(errorMsg)
            } else {
              logError("errors is not an array", { function: "handleBulkUploadPhotos", errors })
            }
            
            // Mark items that failed to process as failed
            // We can't know which specific ones failed, so we'll track by comparing counts
            // Items that don't get mapped will be marked as failed later
          }

          if (isMountedRef.current) {
      toast.success(`Processed ${processedImages.length} image${processedImages.length !== 1 ? 's' : ''}, uploading...`)
      setUploadProgress({ uploaded: 0, total: processedImages.length })
          }

          // Upload processed images - track which item each image corresponds to
      const { splitIntoBatches, uploadBatch, uploadSingle } = await import("@/lib/batch-upload-helper")
        
          // Create mapping from processed image index to preview item id
          // Only map items that were successfully processed
          const processedIndexToItemIdMap = new Map<number, string>()
          const processedItemIds = new Set<string>() // Track which items were successfully processed
          let processedIndex = 0
          for (const item of newItemsToUpload) {
            // CRITICAL: Validate Maps are Map instances before using has/set
            if (itemToFileMap instanceof Map && itemToFileMap.has(item.id)) {
              // Only map if we have a corresponding processed image
              if (processedIndex < processedImages.length) {
                if (processedIndexToItemIdMap instanceof Map) {
                  processedIndexToItemIdMap.set(processedIndex, item.id)
                }
                if (processedItemIds instanceof Set) {
                  processedItemIds.add(item.id)
                }
                processedIndex++
              } else {
                // This item's file failed to process
                failedPreviewItems.add(item.id)
              }
            }
          }
          
          // Mark any items that weren't successfully processed as failed
          for (const item of newItemsToUpload) {
            // CRITICAL: Validate Maps and Sets are instances before using has
            if (itemToFileMap instanceof Map && itemToFileMap.has(item.id) && 
                processedItemIds instanceof Set && !processedItemIds.has(item.id)) {
              failedPreviewItems.add(item.id)
            }
          }
      
      if (processedImages.length === 1) {
        const processed = processedImages[0]
              // CRITICAL: Validate processedIndexToItemIdMap is a Map before using get
              const itemId = processedIndexToItemIdMap instanceof Map ? processedIndexToItemIdMap.get(0) : undefined
              try {
                // Check if aborted before making request
                // CRITICAL: Validate signal exists before checking aborted
                if (signal && signal.aborted) {
                  cleanupAbortController()
                  return
                }
                
          const result = await uploadSingle(processed, API_PATHS.adminImages, {
                  title: editingEvent?.title ? `${editingEvent.title} - Photo` : `Event Photo`,
            eventInfo: editingEvent?.description || null,
          })
          
                if (result.success && result.image?.id && typeof result.image.id === 'string') {
            uploadedImageIds.push(result.image.id)
                  if (itemId) {
                    // CRITICAL: Validate previewItemIdToImageIdMap is a Map before using set
                    if (previewItemIdToImageIdMap instanceof Map) {
                      previewItemIdToImageIdMap.set(itemId, result.image.id)
                    }
                  }
                  if (isMountedRef.current) {
            setUploadProgress({ uploaded: 1, total: 1 })
                  }
          } else {
                  const fileName = processed?.file?.name || 'unknown file'
                  const errorMessage = result.error || `Failed to upload ${fileName}`
                  // CRITICAL: Validate errors is an array before using push
                  if (Array.isArray(errors)) {
            errors.push(errorMessage)
                  } else {
                    logError("errors is not an array", { function: "handleBulkUploadPhotos", errors })
                  }
                  if (itemId) {
                    failedPreviewItems.add(itemId)
                  }
          }
        } catch (error) {
                // Don't treat AbortError as a real error
                if (error instanceof Error && error.name === 'AbortError') {
                  cleanupAbortController()
                  return
        }
                const fileName = processed?.file?.name || 'unknown file'
                const errorMsg = `Failed to upload ${fileName}: ${error instanceof Error ? error.message : String(error)}`
                // CRITICAL: Validate errors is an array before using push
                if (Array.isArray(errors)) {
                  errors.push(errorMsg)
      } else {
                  logError("errors is not an array", { function: "handleBulkUploadPhotos", errors })
                }
                if (itemId) {
                  failedPreviewItems.add(itemId)
                }
              }
            } else {
        const titlePrefix = editingEvent?.title || "Event Photo"
        const batches = splitIntoBatches(processedImages, {
          titlePrefix,
          eventInfo: editingEvent?.description || null,
        })
        
        let totalUploaded = 0
            let batchStartIndex = 0
        
        for (let i = 0; i < batches.length; i++) {
              // Check if aborted before processing each batch
              // CRITICAL: Validate signal exists before checking aborted
              if (signal && signal.aborted) {
                cleanupAbortController()
                return
              }
              
              // CRITICAL: Validate array index is within bounds
              if (typeof i !== 'number' || i < 0 || i >= batches.length) {
                logError("Invalid batch index", { function: "handleBulkUploadPhotos", batchIndex: i, batchesLength: batches.length })
                cleanupAbortController()
                if (isMountedRef.current) {
                  setUploadingPhotos(false)
                  setUploadProgress({ uploaded: 0, total: 0 })
                  toast.error("Invalid batch index. Please try again.")
                }
                return
              }
          const batch = batches[i]
              // CRITICAL: Validate batch is an array
              if (!Array.isArray(batch) || batch.length === 0) {
                logError("Invalid batch at index", { function: "handleBulkUploadPhotos", batchIndex: i, batch })
                // CRITICAL: Update batchStartIndex even when skipping invalid batches to maintain correct indexing
                // If batch is an empty array, length is 0, so no change to batchStartIndex
                // If batch is not an array, we can't determine its length, but we'll use 0 as fallback
                // This ensures subsequent batches maintain correct indexing even if one batch is invalid
                const batchLength = Array.isArray(batch) ? batch.length : 0
                batchStartIndex += batchLength
                logWarn("Invalid batch detected and skipped - batchStartIndex updated", { function: "handleBulkUploadPhotos", batchIndex: i, batchStartIndex, batchLength })
                continue // Skip invalid batches
              }
          
          try {
            if (batches.length > 1) {
                  if (isMountedRef.current) {
              toast.info(`Uploading batch ${i + 1} of ${batches.length} (${batch.length} image${batch.length !== 1 ? 's' : ''})...`)
                  }
            }
            
            const result = await uploadBatch(batch, API_PATHS.adminImagesBatch, {
              titlePrefix,
              eventInfo: editingEvent?.description || null,
            })
            
            if (result.success && result.images) {
                // Map each uploaded image back to its preview item
                // The order of result.images matches the order of batch, which matches filesToUpload
                const expectedImagesInBatch = batch.length
                const actualImagesInBatch = result.images.length
                
                // Check for partial failures in batch
                if (actualImagesInBatch < expectedImagesInBatch) {
                  const failedInBatch = expectedImagesInBatch - actualImagesInBatch
                  // CRITICAL: Validate errors is an array before using push
                  if (Array.isArray(errors)) {
                    errors.push(`Batch ${i + 1}: ${failedInBatch} of ${expectedImagesInBatch} images failed to upload`)
                  } else {
                    logError("errors is not an array", { function: "handleBulkUploadPhotos", errors })
                  }
                  
                  // Mark items that don't have corresponding uploaded images as failed
                  // We know which items should be in this batch based on batchStartIndex
                  for (let j = actualImagesInBatch; j < expectedImagesInBatch; j++) {
                    const globalIndex = batchStartIndex + j
                    // CRITICAL: Validate processedIndexToItemIdMap is a Map before using get
                    const itemId = processedIndexToItemIdMap instanceof Map ? processedIndexToItemIdMap.get(globalIndex) : undefined
                    if (itemId) {
                      failedPreviewItems.add(itemId)
                    }
                  }
                }
                
                if (Array.isArray(result.images)) {
                  result.images.forEach((image: any, batchIndex: number) => {
                    // CRITICAL: Validate batchIndex is within reasonable bounds
                    if (typeof batchIndex !== 'number' || batchIndex < 0 || batchIndex >= batch.length) {
                      logError("Invalid batchIndex in forEach", { function: "handleBulkUploadPhotos", batchIndex, batchLength: batch.length })
                      return // Skip invalid batchIndex
                    }
                    if (image?.id && typeof image.id === 'string') {
                      const globalIndex = batchStartIndex + batchIndex
                      // CRITICAL: Validate globalIndex is within reasonable bounds
                      if (typeof globalIndex !== 'number' || globalIndex < 0 || globalIndex >= processedImages.length) {
                        logWarn("GlobalIndex out of bounds", { function: "handleBulkUploadPhotos", globalIndex, processedImagesLength: processedImages.length, batchStartIndex, batchIndex })
                      }
                      // CRITICAL: Validate processedIndexToItemIdMap is a Map before using get
                      const itemId = processedIndexToItemIdMap instanceof Map ? processedIndexToItemIdMap.get(globalIndex) : undefined
                  uploadedImageIds.push(image.id)
                      if (itemId) {
                        // CRITICAL: Validate previewItemIdToImageIdMap is a Map before using set
                        if (previewItemIdToImageIdMap instanceof Map) {
                          previewItemIdToImageIdMap.set(itemId, image.id)
                        }
                      }
                    } else {
                      // Image object exists but has no ID - mark as failed
                      const globalIndex = batchStartIndex + batchIndex
                      // CRITICAL: Validate globalIndex is within reasonable bounds
                      if (typeof globalIndex !== 'number' || globalIndex < 0 || globalIndex >= processedImages.length) {
                        logWarn("GlobalIndex out of bounds for failed image", { function: "handleBulkUploadPhotos", globalIndex, processedImagesLength: processedImages.length, batchStartIndex, batchIndex })
                      }
                      // CRITICAL: Validate processedIndexToItemIdMap is a Map before using get
                      const itemId = processedIndexToItemIdMap instanceof Map ? processedIndexToItemIdMap.get(globalIndex) : undefined
                      if (itemId) {
                        failedPreviewItems.add(itemId)
                      }
                }
              })
              totalUploaded += result.images.length
                }
                batchStartIndex += batch.length
                if (isMountedRef.current) {
              setUploadProgress({ uploaded: totalUploaded, total: processedImages.length })
                }
              
              if (result.errors && result.errors.length > 0) {
                  // CRITICAL: Validate errors is an array before using push with spread
                  if (Array.isArray(errors) && Array.isArray(result.errors)) {
                errors.push(...result.errors)
                  } else {
                    logError("errors or result.errors is not an array", { function: "handleBulkUploadPhotos", errors, resultErrors: result.errors })
                  }
              }
              
                // CRITICAL: Validate result.message is a string before using
                if (result.message && typeof result.message === 'string' && result.message.trim().length > 0) {
                  if (isMountedRef.current) {
                toast.warning(result.message)
                  }
              }
            } else {
                // CRITICAL: Validate result.errors is an array before using .join()
                const errorMessage = (Array.isArray(result.errors) && result.errors.length > 0) 
                  ? result.errors.join(', ') 
                  : "Failed to upload batch"
                // CRITICAL: Validate errors is an array before using push
                if (Array.isArray(errors)) {
              errors.push(`Batch ${i + 1}: ${errorMessage}`)
                } else {
                  logError("errors is not an array", { function: "handleBulkUploadPhotos", errors })
                }
                // Mark all items in this batch as failed
                for (let j = 0; j < batch.length; j++) {
                  const globalIndex = batchStartIndex + j
                  // CRITICAL: Validate processedIndexToItemIdMap is a Map before using get
                  const itemId = processedIndexToItemIdMap instanceof Map ? processedIndexToItemIdMap.get(globalIndex) : undefined
                  if (itemId) {
                    failedPreviewItems.add(itemId)
                  }
                }
            }
          } catch (error) {
                // Don't treat AbortError as a real error
                if (error instanceof Error && error.name === 'AbortError') {
                  cleanupAbortController()
                  return
                }
                const errorMsg = `Batch ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`
                // CRITICAL: Validate errors is an array before using push
                if (Array.isArray(errors)) {
                  errors.push(errorMsg)
                } else {
                  logError("errors is not an array", { function: "handleBulkUploadPhotos", errors })
                }
                // Mark all items in this batch as failed
                for (let j = 0; j < batch.length; j++) {
                  const globalIndex = batchStartIndex + j
                  // CRITICAL: Validate processedIndexToItemIdMap is a Map before using get
                  const itemId = processedIndexToItemIdMap instanceof Map ? processedIndexToItemIdMap.get(globalIndex) : undefined
                  if (itemId) {
                    failedPreviewItems.add(itemId)
                  }
                }
                // CRITICAL: Update batchStartIndex even when batch fails to maintain correct indexing for subsequent batches
                batchStartIndex += batch.length
              }
            }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
        if (isMountedRef.current) {
      toast.error(`Failed to process images: ${errorMessage}`)
        }
        // CRITICAL: Validate errors is an array before using push
        if (Array.isArray(errors)) {
      errors.push(errorMessage)
        } else {
          logError("errors is not an array", { function: "handleBulkUploadPhotos", errors })
        }
        // Mark all new items as failed
        newItemsToUpload.forEach(item => failedPreviewItems.add(item.id))
      }
    }

    // Add uploaded images to the event
    if (uploadedImageIds.length > 0 && !shouldSkipUpload) {
      const addErrors: string[] = []
        const failedImageIds = new Set<string>()
        
      for (const imageId of uploadedImageIds) {
          // Check if aborted before each request
          // CRITICAL: Validate signal exists before checking aborted
          if (signal && signal.aborted) {
            cleanupAbortController()
            return
          }
          
        try {
          const response = await fetch(API_PATHS.adminEventImages(eventId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
              body: (() => {
                // CRITICAL: Validate imageId before stringifying
                if (!imageId || typeof imageId !== 'string' || imageId.trim().length === 0) {
                  throw new Error("Invalid imageId for JSON.stringify")
                }
                try {
                  return JSON.stringify({
              image_id: imageId,
              image_type: "in_event",
                  })
                } catch (stringifyError) {
                  logError("Failed to stringify request body", { function: "handleBulkUploadPhotos" }, stringifyError instanceof Error ? stringifyError : new Error(String(stringifyError)))
                  throw new Error("Failed to prepare request body")
                }
              })(),
              signal, // Add abort signal
            })

            // Check if response is OK before parsing JSON
            if (!response.ok) {
              // Clone response before reading to avoid consuming body
              try {
                // CRITICAL: Validate response has clone method before using it
                if (!response || typeof response.clone !== 'function') {
                  throw new Error("Response is not cloneable")
                }
                const responseClone = response.clone()
                // CRITICAL: Validate responseClone exists before using it
                if (!responseClone) {
                  throw new Error("Failed to clone response")
                }
                const status = response.status || 0
                const statusText = response.statusText || 'Unknown'
                // CRITICAL: Validate responseClone.text() result is a string
                let errorText: string
                try {
                  const textResult = await responseClone.text()
                  errorText = typeof textResult === 'string' && textResult.length > 0 ? textResult : `HTTP ${status} ${statusText}`
                } catch (textError) {
                  errorText = `HTTP ${status} ${statusText}`
                }
                // CRITICAL: Validate errorText is a string before using in error message
                const errorMessage = `Failed to add photo to event: ${typeof errorText === 'string' ? errorText : `HTTP ${status} ${statusText}`}`
                addErrors.push(errorMessage)
              } catch (cloneError) {
                const status = response.status || 0
                const statusText = response.statusText || 'Unknown'
                const errorMessage = `Failed to add photo to event: HTTP ${status} ${statusText}`
            addErrors.push(errorMessage)
              }
              failedImageIds.add(imageId)
              // Find which preview item this image_id belongs to and mark it as failed
              // CRITICAL: Validate map exists and is a Map before using entries()
              if (previewItemIdToImageIdMap && previewItemIdToImageIdMap instanceof Map) {
                for (const [itemId, mappedImageId] of previewItemIdToImageIdMap.entries()) {
                  if (mappedImageId === imageId) {
                    failedPreviewItems.add(itemId)
                    break
                  }
                }
              }
              continue
            }

            // Parse JSON with error handling
            let json: any
            try {
              // Simple validation: Check response has JSON content before parsing
              const contentType = response.headers.get("content-type")
              if (contentType && contentType.includes("application/json")) {
                json = await response.json()
              } else {
                throw new Error(`Expected JSON but got ${contentType || 'unknown content type'}`)
              }
            } catch (parseError) {
              const errorMessage = `Failed to parse response when adding photo to event: ${parseError instanceof Error ? parseError.message : String(parseError)}`
              addErrors.push(errorMessage)
              failedImageIds.add(imageId)
              // Find which preview item this image_id belongs to and mark it as failed
              // CRITICAL: Validate map exists and is a Map before using entries()
              if (previewItemIdToImageIdMap && previewItemIdToImageIdMap instanceof Map) {
                for (const [itemId, mappedImageId] of previewItemIdToImageIdMap.entries()) {
                  if (mappedImageId === imageId) {
                    failedPreviewItems.add(itemId)
                    break
                  }
                }
              }
              continue
            }

            if (json.success && json.data?.event_image?.id && typeof json.data.event_image.id === 'string') {
              // Map image_id to event_image.id for later display_order update
              // CRITICAL: Validate imageIdToEventImageIdMap is a Map before using set
              if (imageIdToEventImageIdMap instanceof Map && json.data?.event_image?.id) {
                imageIdToEventImageIdMap.set(imageId, json.data.event_image.id)
              }
            } else {
              // CRITICAL: Validate json.error structure before accessing properties
              let errorMessage = "Failed to add photo to event"
              if (json.error) {
                if (typeof json.error === 'object' && json.error !== null && 'message' in json.error && typeof json.error.message === 'string') {
                  errorMessage = json.error.message
                } else if (typeof json.error === 'string') {
                  errorMessage = json.error
                }
              }
              addErrors.push(errorMessage)
              failedImageIds.add(imageId)
              // Find which preview item this image_id belongs to and mark it as failed
              // CRITICAL: Validate map exists and is a Map before using entries()
              if (previewItemIdToImageIdMap && previewItemIdToImageIdMap instanceof Map) {
                for (const [itemId, mappedImageId] of previewItemIdToImageIdMap.entries()) {
                  if (mappedImageId === imageId) {
                    failedPreviewItems.add(itemId)
                    break
                  }
                }
              }
          }
        } catch (error) {
            // Don't treat AbortError as a real error
            if (error instanceof Error && error.name === 'AbortError') {
              cleanupAbortController()
              return
            }
            const errorMsg = `Failed to add photo: ${error instanceof Error ? error.message : String(error)}`
            addErrors.push(errorMsg)
            // Find which preview item this image_id belongs to and mark it as failed
            // CRITICAL: Validate map exists and is a Map before using entries()
            if (previewItemIdToImageIdMap && previewItemIdToImageIdMap instanceof Map) {
              for (const [itemId, mappedImageId] of previewItemIdToImageIdMap.entries()) {
                if (mappedImageId === imageId) {
                  failedPreviewItems.add(itemId)
                  break
                }
              }
            }
          }
        }

        if (addErrors.length > 0) {
          if (isMountedRef.current) {
            toast.error(`Added ${uploadedImageIds.length - addErrors.length} photos, but ${addErrors.length} failed to be added to event`)
          }
        }
      }

    // Step 2: Update display_order for all selected photos (existing + newly uploaded) based on final order
    // Only proceed if we didn't skip the upload
    if (!shouldSkipUpload) {
      // Build the final ordered list: selected items in unifiedPhotoList order
      // IMPORTANT: Only include photos that were successfully uploaded and added to the event
      const finalOrderedItems: Array<{ eventImageId: string; imageId: string }> = []
      const skippedItems: string[] = [] // Track which items were skipped due to upload failures
      
      // Build final ordered list from selectedItems (maintains order from unifiedPhotoList)
      // Skip items that failed to upload or be added to the event
      for (const item of selectedItems) {
        if (item.isExisting && item.existingPhoto) {
          // Existing photo - use its event_image.id
          // Simple validation: Check IDs are valid
          if (item.existingPhoto.id && item.existingPhoto.image_id) {
            finalOrderedItems.push({
              eventImageId: item.existingPhoto.id,
              imageId: item.existingPhoto.image_id,
            })
          }
        } else if (!item.isExisting && item.previewData) {
          // New photo - only include if it was successfully uploaded and added to event
          if (failedPreviewItems.has(item.id)) {
            // This preview item failed to upload or be added - skip it
            const fileName = item.previewData?.file?.name || 'unknown file'
            skippedItems.push(fileName)
            continue
          }
          
          // CRITICAL: Validate Maps are Map instances before using get
          const uploadedImageId = previewItemIdToImageIdMap instanceof Map ? previewItemIdToImageIdMap.get(item.id) : undefined
          if (uploadedImageId) {
            const eventImageId = imageIdToEventImageIdMap instanceof Map ? imageIdToEventImageIdMap.get(uploadedImageId) : undefined
            if (eventImageId) {
              // Successfully uploaded and added to event - include in order
              finalOrderedItems.push({
                eventImageId,
                imageId: uploadedImageId,
              })
            } else {
              // Uploaded but failed to add to event - skip it
              const fileName = item.previewData?.file?.name || 'unknown file'
              skippedItems.push(fileName)
            }
          } else {
            // Failed to upload - skip it
            const fileName = item.previewData?.file?.name || 'unknown file'
            skippedItems.push(fileName)
          }
        }
      }
      
      // Report skipped items if any
      if (skippedItems.length > 0) {
        // CRITICAL: Validate skippedItems array exists and has items before using slice
        if (isMountedRef.current && Array.isArray(skippedItems) && skippedItems.length > 0) {
          const itemsToShow = skippedItems.length > 3 ? skippedItems.slice(0, 3) : skippedItems
          const itemsText = Array.isArray(itemsToShow) ? itemsToShow.join(', ') : ''
          toast.warning(`${skippedItems.length} photo${skippedItems.length !== 1 ? 's' : ''} skipped from ordering due to upload failures: ${itemsText}${skippedItems.length > 3 ? '...' : ''}`)
        }
      }
      
      // Skip order update if no items to update (all uploads failed or no items selected)
      if (finalOrderedItems.length === 0) {
        if (skippedItems.length > 0) {
          if (isMountedRef.current) {
            toast.error("No photos were successfully uploaded. Order was not updated.")
          }
        }
      } else {
        // Update display_order for all photos in the final order
        try {
          // Check if aborted before making requests
          // CRITICAL: Validate signal exists before checking aborted
          if (signal && signal.aborted) {
            cleanupAbortController()
            return
          }
          
          // Simple validation: Filter out items with invalid eventImageId
          const validOrderedItems = finalOrderedItems.filter(item => 
            item.eventImageId && typeof item.eventImageId === 'string' && item.eventImageId.trim().length > 0
          )
          
          // CRITICAL: Validate array is not empty before mapping
          if (!Array.isArray(validOrderedItems) || validOrderedItems.length === 0) {
            logError("No valid ordered items to update", { function: "handleDragEnd" })
            return
          }
          
          const updatePromises = validOrderedItems.map((item, index) => {
            // CRITICAL: Validate index is within reasonable bounds (defensive check)
            const safeIndex = typeof index === 'number' && index >= 0 && index < 100000 ? index : 0
            // CRITICAL: Validate item.eventImageId is a valid string before using in API call
            if (!item || !item.eventImageId || typeof item.eventImageId !== 'string' || item.eventImageId.trim().length === 0) {
              logError("Invalid eventImageId in validOrderedItems", { function: "handleDragEnd", item, index })
              // Return a rejected promise to handle in Promise.allSettled
              return Promise.reject(new Error(`Invalid eventImageId at index ${index}`))
            }
            return fetch(API_PATHS.adminEventImage(eventId, item.eventImageId), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ display_order: safeIndex }),
              signal, // Add abort signal
            })
          })
          
          const results = await Promise.allSettled(updatePromises)
          
          // Simple fix: Check if operation was aborted before processing results
          // CRITICAL: Validate signal exists before checking aborted
          if (signal && signal.aborted) {
            return
          }
          
          // Check both rejected promises AND fulfilled promises with non-OK responses
          let totalFailed = 0
          const failedDetails: string[] = []
          
          // CRITICAL: Validate results array
          if (!Array.isArray(results)) {
            logError("Promise.allSettled returned invalid results", { function: "handleDragEnd", results })
            return
          }
          
          // CRITICAL: Validate results array and length before iterating
          const resultsLength = Array.isArray(results) ? results.length : 0
          if (resultsLength === 0) {
            logError("Empty results array from Promise.allSettled", { function: "handleDragEnd" })
            return
          }
          // CRITICAL: Validate resultsLength is within reasonable bounds
          if (resultsLength > 100000) {
            logError("Results array is too large", { function: "handleDragEnd", resultsLength })
            return
          }
          for (let i = 0; i < resultsLength; i++) {
            // CRITICAL: Validate index is within bounds
            if (typeof i !== 'number' || i < 0 || i >= resultsLength) {
              logError("Invalid result index", { function: "handleDragEnd", resultIndex: i, resultsLength })
              continue
            }
            const result = results[i]
            if (!result || typeof result !== 'object') {
              totalFailed++
              const safeIndex = typeof i === 'number' && i >= 0 ? i + 1 : 0
              failedDetails.push(`Photo ${safeIndex}: Invalid result`)
              continue
            }
            
            if (result.status === 'rejected') {
              totalFailed++
              const reason = result.reason instanceof Error ? result.reason.message : String(result.reason || 'Unknown error')
              failedDetails.push(`Photo ${i + 1}: ${reason}`)
            } else if (result.status === 'fulfilled') {
              const response = result.value
              // CRITICAL: Validate response is a Response object
              if (!response || typeof response !== 'object' || !('ok' in response)) {
                totalFailed++
                failedDetails.push(`Photo ${i + 1}: Invalid response object`)
                continue
              }
              
              if (!response.ok) {
                totalFailed++
                try {
                  // Clone response before reading to avoid consuming body
                  // CRITICAL: Validate response has clone method before using it
                  if (!response || typeof response.clone !== 'function') {
                    throw new Error("Response is not cloneable")
                  }
                  const responseClone = response.clone()
                  // CRITICAL: Validate responseClone exists before using it
                  if (!responseClone) {
                    throw new Error("Failed to clone response")
                  }
                  const status = response.status || 0
                  const statusText = response.statusText || 'Unknown'
                  // CRITICAL: Validate responseClone.text() result is a string
                  let errorText: string
                  try {
                    const textResult = await responseClone.text()
                    errorText = typeof textResult === 'string' && textResult.length > 0 ? textResult : `HTTP ${status} ${statusText}`
                  } catch (textError) {
                    errorText = `HTTP ${status} ${statusText}`
                  }
                  // CRITICAL: Validate errorText is a string and i is a valid number before using in error message
                  const safeIndex = typeof i === 'number' && i >= 0 && i < 100000 ? i + 1 : 1
                  const safeErrorText = typeof errorText === 'string' ? errorText : `HTTP ${status} ${statusText}`
                  failedDetails.push(`Photo ${safeIndex}: ${safeErrorText}`)
                } catch (cloneError) {
                  const status = response.status || 0
                  // CRITICAL: Validate i is a valid number before using in error message (consistent with try block above)
                  const safeIndex = typeof i === 'number' && i >= 0 && i < 100000 ? i + 1 : 1
                  failedDetails.push(`Photo ${safeIndex}: HTTP ${status}`)
                }
              }
            }
          }
          
          if (totalFailed > 0) {
            logWarn('Failed to update photo order', { function: "handleDragEnd", totalFailed, failedDetails })
            if (isMountedRef.current) {
              toast.warning(`Failed to update order for ${totalFailed} photo${totalFailed !== 1 ? 's' : ''}`)
            }
          }
        } catch (error) {
          // Don't treat AbortError as a real error
          if (error instanceof Error && error.name === 'AbortError') {
            cleanupAbortController()
            return
          }
          logError("Failed to update photo order", { function: "handleDragEnd" }, error instanceof Error ? error : new Error(String(error)))
          if (isMountedRef.current) {
            toast.error("Failed to update photo order")
          }
        }
      }
    }

    // Step 3: Refresh and cleanup
    if (uploadedImageIds.length > 0 && !shouldSkipUpload) {
      const successCount = uploadedImageIds.length
      
      if (isMountedRef.current) {
        toast.success(`Successfully uploaded ${successCount} photo${successCount !== 1 ? 's' : ''}`)
      }
      
      // Cleanup blob URLs
      if (Array.isArray(inEventPhotoPreviews)) {
        inEventPhotoPreviews.forEach(preview => {
          if (preview?.preview && (preview.preview.startsWith('blob:') || preview.preview.startsWith('data:'))) {
            if (preview.preview.startsWith('blob:')) {
              URL.revokeObjectURL(preview.preview)
            }
            // CRITICAL: Validate previewBlobUrlsRef.current is a Set before using delete
            if (previewBlobUrlsRef.current instanceof Set) {
              previewBlobUrlsRef.current.delete(preview.preview)
            }
          }
        })
      }
      
      if (isMountedRef.current) {
        setAddingPhoto(false)
        setInEventPhotoFiles([])
        setInEventPhotoPreviews([])
        setUploadProgress({ uploaded: 0, total: 0 })
        setUnifiedPhotoList([])
      }
      
      // Refresh event details
      if (isMountedRef.current && editingEvent) {
        try {
          // Check if aborted before fetching
          if (signal && signal.aborted) {
            cleanupAbortController()
            return
          }
          
          const updated = await fetchEventDetails(eventId, signal)
          if (updated && isMountedRef.current && editingEvent && eventId) {
            setEditingEvent(updated)
            // CRITICAL: Update snapshot after photo upload to include newly uploaded photos
            // This ensures order comparison works correctly if photos are reordered after upload
            if (eventSnapshot && isMountedRef.current) {
              try {
                setEventSnapshot(JSON.parse(JSON.stringify(updated)))
              } catch (copyError) {
                logError("Failed to update snapshot after photo upload", { function: "handleBulkUploadPhotos" }, copyError instanceof Error ? copyError : new Error(String(copyError)))
                if (isMountedRef.current) {
                  setEventSnapshot({ ...updated })
                }
              }
            }
            // CRITICAL: Validate eventId before calling replaceItem
            if (eventId && typeof eventId === 'string' && eventId.trim().length > 0) {
            replaceItem(eventId, updated)
            }
          }
        } catch (error) {
          // Don't treat AbortError as a real error
          if (error instanceof Error && error.name !== 'AbortError') {
            logError("Failed to refresh event details", { function: "handleBulkUploadPhotos" }, error)
          }
        }
      }
    }

    // CRITICAL: Validate errors array before using .join()
    if (Array.isArray(errors) && errors.length > 0) {
      if (isMountedRef.current) {
      toast.error(`${errors.length} upload${errors.length !== 1 ? 's' : ''} failed: ${errors.join(', ')}`)
    }
    }
    } catch (error) {
      // Don't treat AbortError as a real error
      if (error instanceof Error && error.name === 'AbortError') {
        // Abort was intentional (component unmounted or user cancelled)
        // Don't call cleanupAbortController here - finally block will handle it
        return
      }
      logError("Unexpected error in handleBulkUploadPhotos", { function: "handleBulkUploadPhotos" }, error instanceof Error ? error : new Error(String(error)))
      if (isMountedRef.current) {
        toast.error("An unexpected error occurred during upload")
      }
    } finally {
      // CRITICAL: Always cleanup and reset upload state, even if errors occurred
      cleanupAbortController()
      
      // Cleanup blob URLs if not already cleaned up
      // Simple fix: Use optional chaining and default values to handle undefined variables
      if ((shouldSkipUpload ?? false) || (errors?.length ?? 0) > 0) {
        if (Array.isArray(inEventPhotoPreviews)) {
          inEventPhotoPreviews.forEach(preview => {
            if (preview?.preview && (preview.preview.startsWith('blob:') || preview.preview.startsWith('data:'))) {
              if (preview.preview.startsWith('blob:')) {
                URL.revokeObjectURL(preview.preview)
              }
              // CRITICAL: Validate previewBlobUrlsRef.current is a Set before using delete
              if (previewBlobUrlsRef.current instanceof Set) {
                previewBlobUrlsRef.current.delete(preview.preview)
              }
            }
          })
        }
      }
      
      // CRITICAL: Only update state if component is still mounted
      if (isMountedRef.current) {
    setUploadingPhotos(false)
        setUploadProgress({ uploaded: 0, total: 0 })
      }
    }
  }

  // Handle drag end for photo reordering
  const handleDragEnd = async (event: DragEndEvent) => {
    // CRITICAL: Check ref synchronously to prevent race conditions
    if (isReorderingRef.current) {
      return // Already reordering, ignore this drag
    }
    
    // Prevent drag during reordering, if no event, or if there are pending deletions
    // Pending deletions make the photo array inconsistent - prevent reordering until save
    // CRITICAL: Validate pendingDeletions is a Set before using .size
    const hasPendingDeletions = pendingDeletions instanceof Set && pendingDeletions.size > 0
    if (!editingEvent || reorderingPhotos || hasPendingDeletions) {
      if (hasPendingDeletions) {
        if (isMountedRef.current) {
        toast.info("Please save or cancel pending deletions before reordering photos")
        }
      }
      return
    }

    // CRITICAL: Validate in_event_photos exists and is an array
    if (!Array.isArray(editingEvent.in_event_photos)) {
      logError("in_event_photos is not an array", { function: "handleDragEnd", in_event_photos: editingEvent.in_event_photos })
      if (isMountedRef.current) {
      toast.error("Invalid photo data. Please refresh and try again.")
      }
      return
    }

    const { active, over } = event

    // Simple validation: Check active and over have valid IDs
    if (!active?.id || !over?.id || typeof active.id !== 'string' || typeof over.id !== 'string') {
      return
    }

    if (active.id === over.id) {
      return
    }

    // Get the visible photos (filtered array) for finding indices
    // But we need to reorder the full array
    // CRITICAL: Validate in_event_photos is an array before using filter
    const validPhotos = Array.isArray(editingEvent.in_event_photos) ? editingEvent.in_event_photos : []
    const visiblePhotos = validPhotos.filter(
      p => p?.id && (pendingDeletions instanceof Set ? !pendingDeletions.has(p.id) : true)
    )
    const fullPhotosArray = validPhotos
    
    // Find indices in visible array
    // CRITICAL: Validate arrays exist before calling findIndex
    if (!Array.isArray(visiblePhotos) || !Array.isArray(fullPhotosArray)) {
      logError("Invalid arrays for findIndex operation", { function: "handleDragEnd", visiblePhotos, fullPhotosArray })
      return
    }
    const visibleOldIndex = visiblePhotos.findIndex((p) => p?.id === active.id)
    const visibleNewIndex = visiblePhotos.findIndex((p) => p?.id === over.id)

    if (visibleOldIndex === -1 || visibleNewIndex === -1) {
      return
    }

    // Map visible indices to full array indices
    const fullOldIndex = fullPhotosArray.findIndex((p) => p?.id === active.id)
    const fullNewIndex = fullPhotosArray.findIndex((p) => p?.id === over.id)

    if (fullOldIndex === -1 || fullNewIndex === -1) {
      return
    }

    // Simple validation: Check indices are within array bounds
    if (fullOldIndex < 0 || fullOldIndex >= fullPhotosArray.length || 
        fullNewIndex < 0 || fullNewIndex >= fullPhotosArray.length) {
      logError("Invalid array indices for reordering", { function: "handleDragEnd", fullOldIndex, fullNewIndex, arrayLength: fullPhotosArray.length })
      return
    }

    // CRITICAL: Set ref synchronously to prevent race conditions
    isReorderingRef.current = true
    setReorderingPhotos(true)

    // CRITICAL: Create abort controller for reordering requests
    const abortController = new AbortController()
    const signal = abortController.signal
    // CRITICAL: Validate abortControllersRef.current is an array before using push
    if (Array.isArray(abortControllersRef.current)) {
    abortControllersRef.current.push(abortController)
    } else {
      logError("abortControllersRef.current is not an array", { function: "handleBulkUploadPhotos", abortControllersRef: abortControllersRef.current })
      abortControllersRef.current = [abortController]
    }
    
    const cleanupAbortController = () => {
      // CRITICAL: Validate abortControllersRef.current is an array before using filter
      if (Array.isArray(abortControllersRef.current)) {
      abortControllersRef.current = abortControllersRef.current.filter(
        c => c !== abortController
      )
      }
    }

    try {
      // Reorder the full array (including pending deletions if any)
      // CRITICAL: Validate array and indices before calling arrayMove
      if (!Array.isArray(fullPhotosArray) || fullPhotosArray.length === 0) {
        logError("Invalid fullPhotosArray for reordering", { function: "handleDragEnd", fullPhotosArray })
        cleanupAbortController()
        isReorderingRef.current = false
        setReorderingPhotos(false)
        return
      }
      // CRITICAL: Validate indices are within bounds before arrayMove
      if (fullOldIndex < 0 || fullOldIndex >= fullPhotosArray.length || 
          fullNewIndex < 0 || fullNewIndex >= fullPhotosArray.length) {
        logError("Invalid indices for arrayMove", { function: "handleDragEnd", fullOldIndex, fullNewIndex, arrayLength: fullPhotosArray.length })
        cleanupAbortController()
        isReorderingRef.current = false
        setReorderingPhotos(false)
        return
      }
      // CRITICAL: arrayMove creates a new array, doesn't mutate original
      const reorderedPhotos = arrayMove(
        fullPhotosArray,
        fullOldIndex,
        fullNewIndex
      )

      // Update display_order for all photos in full array
      // Simple validation: Ensure reorderedPhotos is valid array
      if (!Array.isArray(reorderedPhotos) || reorderedPhotos.length === 0) {
        logError("Invalid reorderedPhotos array", { function: "handleDragEnd", reorderedPhotos })
        cleanupAbortController()
        isReorderingRef.current = false
        setReorderingPhotos(false)
        return
      }

      // CRITICAL: Validate array length is reasonable before mapping
      if (reorderedPhotos.length > 10000) {
        logError("Reordered photos array is too large", { function: "handleDragEnd", arrayLength: reorderedPhotos.length })
        cleanupAbortController()
        isReorderingRef.current = false
        setReorderingPhotos(false)
        return
      }
      
      // CRITICAL: Validate photo objects exist before spreading
      const updatedPhotos = reorderedPhotos
        .map((photo, index) => {
          // CRITICAL: Validate index is within reasonable bounds (defensive check)
          const safeIndex = typeof index === 'number' && index >= 0 && index < 100000 ? index : 0
          // CRITICAL: Validate photo is an object before spreading
          if (!photo || typeof photo !== 'object' || Array.isArray(photo)) {
            logError("Invalid photo object in reorderedPhotos", { function: "handleDragEnd", photo })
            return undefined
          }
          return {
        ...photo,
            display_order: safeIndex,
          }
        })
        .filter((photo): photo is typeof reorderedPhotos[0] => photo !== undefined && photo !== null)

      // CRITICAL: Check if component is still mounted before updating state
      if (!isMountedRef.current) {
        cleanupAbortController()
        isReorderingRef.current = false
        return
      }

      // CRITICAL: Update local state immediately with new array reference
      // IMPORTANT: Create a new array reference to ensure React detects the change and triggers re-render
      // The updatedPhotos array already has new objects with updated display_order from the map operation
      // But we need to ensure the array itself is a new reference for React to detect the change
      const newPhotosArray = [...updatedPhotos]
      setEditingEvent(prevEvent => {
        if (!prevEvent) return prevEvent
        // Return a new object with a new array reference to ensure React detects the change
        // This will trigger a re-render and update the UI immediately
        return {
          ...prevEvent,
          in_event_photos: newPhotosArray,
        }
      })
      
      // CRITICAL: Only update local state - do NOT make API calls
      // Order changes will be applied when "Save Changes" is pressed
      // This allows users to reorder photos without instant database updates
        if (isMountedRef.current) {
        toast.info("Photo order changed. Click 'Save Changes' to apply the new order.")
      }
    } catch (error) {
      cleanupAbortController()
      
      // CRITICAL: Check if error is from abort (request cancelled)
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was aborted - don't show error, just return
        isReorderingRef.current = false
        return
      }
      
      // CRITICAL: Check if component is still mounted before showing error
      if (isMountedRef.current) {
        logError("Failed to reorder photos", { function: "handleDragEnd" }, error instanceof Error ? error : new Error(String(error)))
        toast.error("Failed to reorder photos. Please try again.")
      }
    } finally {
      cleanupAbortController()
      isReorderingRef.current = false
      if (isMountedRef.current) {
        setReorderingPhotos(false)
      }
    }
  }

  // Remove in-event photo
  const handleRemovePhoto = async (eventId: string, eventImageId: string) => {
    // Simple validation: Check parameters are valid
    if (!eventId || typeof eventId !== 'string' || eventId.trim().length === 0) {
      if (isMountedRef.current) {
        toast.error("Invalid event ID. Please refresh and try again.")
      }
      return
    }
    if (!eventImageId || typeof eventImageId !== 'string' || eventImageId.trim().length === 0) {
      if (isMountedRef.current) {
        toast.error("Invalid photo ID. Please refresh and try again.")
      }
      return
    }
    
    // CRITICAL: Check ref synchronously to prevent race conditions
    if (isReorderingRef.current) {
      if (isMountedRef.current) {
      toast.info("Please wait for photo reordering to complete")
      }
      return
    }
    
    // Prevent removal if:
    // 1. Already removing this photo
    // 2. Reordering is in progress
    // 3. Save is in progress
    // 4. Photo is marked for pending deletion (use bulk delete instead)
    if (removingPhoto === eventImageId || reorderingPhotos || saving || pendingDeletions.has(eventImageId)) {
      if (pendingDeletions.has(eventImageId)) {
        if (isMountedRef.current) {
        toast.info("This photo is marked for deletion. Use 'Save Changes' to confirm, or cancel to remove the deletion.")
        }
      }
      return
    }
    
    // CRITICAL: Validate editingEvent and in_event_photos
    if (!editingEvent || !Array.isArray(editingEvent.in_event_photos)) {
      if (isMountedRef.current) {
      toast.error("Invalid event data. Please refresh and try again.")
      }
      return
    }

    // CRITICAL: Create abort controller for request cancellation
    const abortController = new AbortController()
    const signal = abortController.signal
    // CRITICAL: Validate abortControllersRef.current is an array before using push
    if (Array.isArray(abortControllersRef.current)) {
      abortControllersRef.current.push(abortController)
    } else {
      logError("abortControllersRef.current is not an array", { function: "handleDragEnd", abortControllersRef: abortControllersRef.current })
      abortControllersRef.current = [abortController]
    }
    
    const cleanupAbortController = () => {
      // CRITICAL: Validate abortControllersRef.current is an array before using filter
      if (Array.isArray(abortControllersRef.current)) {
        abortControllersRef.current = abortControllersRef.current.filter(
          c => c !== abortController
        )
      }
    }

    setRemovingPhoto(eventImageId)
    try {
      // CRITICAL: Check if component is still mounted before making request
      if (!isMountedRef.current) {
        cleanupAbortController()
        setRemovingPhoto(null)
        return
      }
      
      const response = await fetch(API_PATHS.adminEventImage(eventId, eventImageId), {
        method: "DELETE",
        signal, // Add abort signal for cancellation
      })
      
      // CRITICAL: Check if request was aborted
      if (signal && signal.aborted) {
        cleanupAbortController()
        setRemovingPhoto(null)
        return
      }

      // Simple fix: Check response.ok before parsing JSON
      if (!response.ok) {
        // CRITICAL: Validate response.status before using
        const status = response.status || 0
        // CRITICAL: Validate response.text() result type
        let errorText: string
        try {
          const textResult = await response.text()
          errorText = typeof textResult === 'string' ? textResult : `HTTP ${status}`
        } catch (textError) {
          errorText = `HTTP ${status}`
        }
        // CRITICAL: Validate errorText is a string before using
        const errorMessage = typeof errorText === 'string' && errorText.length > 0 ? errorText : `HTTP ${status}`
        throw new Error(`Failed to remove photo: ${errorMessage}`)
      }

      // Simple fix: Add error handling for JSON parsing
      let json: any
      try {
        json = await response.json()
      } catch (parseError) {
        throw new Error("Invalid response from server when removing photo")
      }
      
      if (json.success) {
        // Check if component is still mounted before updating state
        if (!isMountedRef.current) {
          setRemovingPhoto(null)
          return
        }
        
        if (isMountedRef.current) {
        toast.success("Photo removed successfully")
        }
        
        // Optimistically update UI by removing the photo and reordering remaining photos
        // CRITICAL: Validate in_event_photos is an array before using filter
        if (editingEvent && Array.isArray(editingEvent.in_event_photos)) {
          // Remove the deleted photo from the list
          const remainingPhotos = editingEvent.in_event_photos.filter(
            (p) => p?.id && p.id !== eventImageId
          )
          
          // Reorder remaining photos to have sequential display_order (0, 1, 2, ...)
          // CRITICAL: Validate remainingPhotos is an array and has valid display_order values
          const reorderedPhotos = Array.isArray(remainingPhotos) && remainingPhotos.length > 0
            ? remainingPhotos
                .sort((a, b) => {
                  // CRITICAL: Validate display_order exists and is a number
                  const orderA = (typeof a?.display_order === 'number' && !isNaN(a.display_order)) ? a.display_order : 0
                  const orderB = (typeof b?.display_order === 'number' && !isNaN(b.display_order)) ? b.display_order : 0
                  return orderA - orderB
                })
                .map((photo, index) => {
                  // CRITICAL: Validate photo is an object before spreading
                  if (!photo || typeof photo !== 'object' || Array.isArray(photo)) {
                    logError("Invalid photo object in remainingPhotos", { function: "handleRemovePhoto", photo })
                    return undefined
                  }
                  return {
              ...photo,
              display_order: index,
                  }
                })
                .filter((photo): photo is NonNullable<typeof remainingPhotos[0]> => photo !== undefined && photo !== null)
            : []
          
          // CRITICAL: Create abort controller for removal requests
          const abortController = new AbortController()
          const signal = abortController.signal
          // CRITICAL: Validate abortControllersRef.current is an array before using push
          if (Array.isArray(abortControllersRef.current)) {
          abortControllersRef.current.push(abortController)
          } else {
            logError("abortControllersRef.current is not an array", { function: "handleRemovePhoto", abortControllersRef: abortControllersRef.current })
            abortControllersRef.current = [abortController]
          }
          
          const cleanupAbortController = () => {
            // CRITICAL: Validate abortControllersRef.current is an array before using filter
            if (Array.isArray(abortControllersRef.current)) {
            abortControllersRef.current = abortControllersRef.current.filter(
              c => c !== abortController
            )
            }
          }
          
          // Update display_order in database for all remaining photos
          try {
            const updatePromises = reorderedPhotos.map((photo, index) => {
              // CRITICAL: Validate photo.id is a valid string before using in API call
              if (!photo || !photo.id || typeof photo.id !== 'string' || photo.id.trim().length === 0) {
                logError("Invalid photo.id in reorderedPhotos", { function: "handleRemovePhoto", photo, index })
                // Return a rejected promise to handle in Promise.allSettled
                return Promise.reject(new Error(`Invalid photo.id at index ${index}`))
              }
              return fetch(API_PATHS.adminEventImage(eventId, photo.id), {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ display_order: index }),
                signal, // Add abort signal for cancellation
              }).then(async (res) => {
                // CRITICAL: Check if request was aborted
                if (signal && signal.aborted) {
                  throw new Error("Request aborted")
                }
                if (!res.ok) {
                  const errorJson = await res.json().catch(() => ({}))
                  throw new Error(errorJson.error?.message || `Failed to update photo ${photo.id}`)
                }
                return res
              })
            })
            
            // CRITICAL: Use Promise.allSettled instead of Promise.all for better error handling
            const results = await Promise.allSettled(updatePromises)
            
            // CRITICAL: Validate results array
            if (!Array.isArray(results)) {
              logError("Promise.allSettled returned invalid results", { function: "handleRemovePhoto", results })
              cleanupAbortController()
              setRemovingPhoto(null)
              return
            }
            
            const failed = results.filter(r => r && r.status === 'rejected').length
            
            // CRITICAL: Check if request was aborted
            if (signal && signal.aborted) {
              cleanupAbortController()
              return
            }
            
            if (failed > 0) {
              throw new Error(`Failed to update order for ${failed} photo${failed !== 1 ? 's' : ''}`)
            }
            
            // Check if component is still mounted before updating state
            if (!isMountedRef.current) {
              cleanupAbortController()
              return
            }
            
            // Update local state with reordered photos
            const updatedEvent = {
              ...editingEvent,
              in_event_photos: reorderedPhotos,
            }
            setEditingEvent(updatedEvent)
            // CRITICAL: Validate eventId before calling replaceItem
            if (eventId && typeof eventId === 'string' && eventId.trim().length > 0) {
            replaceItem(eventId, updatedEvent)
            }
            
            // CRITICAL: Update snapshot to reflect the new state after removal
            if (eventSnapshot && isMountedRef.current) {
              try {
                setEventSnapshot(JSON.parse(JSON.stringify(updatedEvent)))
              } catch (copyError) {
                logError("Failed to update snapshot", { function: "handleRemovePhoto" }, copyError instanceof Error ? copyError : new Error(String(copyError)))
                if (isMountedRef.current) {
                setEventSnapshot({ ...updatedEvent })
                }
              }
            }
            
            // CRITICAL: Remove from selectedPhotoIds if it was selected
            setSelectedPhotoIds(prev => {
              // CRITICAL: Validate prev is a Set before using it
              const safePrev = prev instanceof Set ? prev : new Set<string>()
              const newSet = new Set(safePrev)
              newSet.delete(eventImageId)
              return newSet
            })
            
            // CRITICAL: Remove from pendingDeletions if it was pending
            setPendingDeletions(prev => {
              // CRITICAL: Validate prev is a Set before using it
              const safePrev = prev instanceof Set ? prev : new Set<string>()
              const newSet = new Set(safePrev)
              newSet.delete(eventImageId)
              return newSet
            })
          } catch (updateError) {
            cleanupAbortController()
            
            // CRITICAL: Check if error is from abort (request cancelled)
            if (updateError instanceof Error && updateError.name === 'AbortError') {
              // Request was aborted - don't show error, just return
              return
            }
            
            logError("Failed to update photo order after deletion", { function: "handleRemovePhoto" }, updateError instanceof Error ? updateError : new Error(String(updateError)))
            // If order update fails, still refresh from server
            // CRITICAL: Use abort signal for cancellation
            if (isMountedRef.current) {
              const refreshAbortController = new AbortController()
              const refreshSignal = refreshAbortController.signal
              // CRITICAL: Validate abortControllersRef.current is an array before using push
              if (Array.isArray(abortControllersRef.current)) {
                abortControllersRef.current.push(refreshAbortController)
              } else {
                logError("abortControllersRef.current is not an array", { function: "handleRemovePhoto", abortControllersRef: abortControllersRef.current })
                abortControllersRef.current = [refreshAbortController]
              }
              try {
                const updated = await fetchEventDetails(eventId, refreshSignal)
                // Cleanup refresh abort controller
                abortControllersRef.current = abortControllersRef.current.filter(c => c !== refreshAbortController)
              if (updated && isMountedRef.current) {
                setEditingEvent(updated)
                  // CRITICAL: Validate eventId before calling replaceItem
                  if (eventId && typeof eventId === 'string' && eventId.trim().length > 0) {
                replaceItem(eventId, updated)
                  }
                }
              } catch (refreshError) {
                // Cleanup refresh abort controller
                abortControllersRef.current = abortControllersRef.current.filter(c => c !== refreshAbortController)
                // Don't treat AbortError as a real error
                if (refreshError instanceof Error && refreshError.name !== 'AbortError') {
                  logError("Failed to refresh event details", { function: "handleRemovePhoto" }, refreshError)
                }
              }
            }
          } finally {
            cleanupAbortController()
          }
        } else {
          // Fallback: refresh event details from server
          if (isMountedRef.current) {
            const updated = await fetchEventDetails(eventId)
            if (updated && isMountedRef.current) {
              setEditingEvent(updated)
              // CRITICAL: Validate eventId before calling replaceItem
              if (eventId && typeof eventId === 'string' && eventId.trim().length > 0) {
              replaceItem(eventId, updated)
              }
            }
          }
        }
      } else {
        // CRITICAL: Validate json.error structure before accessing properties
        let errorMessage = "Failed to remove photo"
        if (json.error) {
          if (typeof json.error === 'object' && json.error !== null && 'message' in json.error && typeof json.error.message === 'string') {
            errorMessage = json.error.message
          } else if (typeof json.error === 'string') {
            errorMessage = json.error
          }
        }
        if (isMountedRef.current) {
        toast.error(errorMessage)
        }
      }
    } catch (error) {
      // CRITICAL: Check if error is from abort (request cancelled)
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was aborted - don't show error, just return
        cleanupAbortController()
        if (isMountedRef.current) {
          setRemovingPhoto(null)
        }
        return
      }
      
      if (isMountedRef.current) {
      toast.error("Failed to remove photo")
      }
      logError("Error in handleRemovePhoto", { function: "handleRemovePhoto" }, error instanceof Error ? error : new Error(String(error)))
    } finally {
      cleanupAbortController()
      if (isMountedRef.current) {
      setRemovingPhoto(null)
      }
    }
  }

  // Handle photo selection for bulk delete (memoized with useCallback)
  // Note: We don't check pendingDeletions here because photos marked for deletion
  // are filtered from display, so they can't be selected. The check is done in the render.
  const handleSelectPhoto = useCallback((photoId: string, selected: boolean) => {
    setSelectedPhotoIds(prev => {
      // CRITICAL: Validate prev is a Set before using it
      const safePrev = prev instanceof Set ? prev : new Set<string>()
      const newSet = new Set(safePrev)
      // CRITICAL: Validate selected is boolean before using it
      const safeSelected = typeof selected === 'boolean' ? selected : false
      if (safeSelected) {
        newSet.add(photoId)
      } else {
        newSet.delete(photoId)
      }
      return newSet
    })
  }, [])

  // Handle select all photos (memoized with useCallback)
  const handleSelectAll = useCallback((selectAll: boolean) => {
    // CRITICAL: Validate in_event_photos exists and is an array
    if (!editingEvent || !Array.isArray(editingEvent.in_event_photos)) {
      return
    }
    
    if (selectAll) {
      const allPhotoIds = new Set(editingEvent.in_event_photos
        .filter(p => p?.id && typeof p.id === 'string' && (pendingDeletions instanceof Set ? !pendingDeletions.has(p.id) : true))
        .map(p => p.id))
      setSelectedPhotoIds(allPhotoIds)
    } else {
      setSelectedPhotoIds(new Set())
    }
  }, [editingEvent, pendingDeletions])

  // Mark photos for pending deletion (will be processed on save) - memoized
  const handleMarkForDeletion = useCallback(() => {
    // CRITICAL: Validate editingEvent exists and has photos
    if (!editingEvent) {
      if (isMountedRef.current) {
      toast.error("No event selected")
      }
      return
    }
    
    // CRITICAL: Validate in_event_photos exists and is an array
    if (!Array.isArray(editingEvent.in_event_photos)) {
      if (isMountedRef.current) {
      toast.error("Invalid event data. Please refresh and try again.")
      }
      return
    }
    
    // Capture selected IDs immediately to avoid stale closure issues
    // CRITICAL: Validate selectedPhotoIds is a Set before using Array.from
    const idsToDelete = selectedPhotoIds instanceof Set ? Array.from(selectedPhotoIds) : []
    
    if (idsToDelete.length === 0) {
      if (isMountedRef.current) {
      toast.info("No photos selected")
      }
      return
    }

    // CRITICAL: Validate that all selected IDs actually exist in the event
    // This prevents marking non-existent photos for deletion
    const validIdsToDelete = idsToDelete.filter(id => {
      // Validate ID is a non-empty string
      if (typeof id !== 'string' || id.trim().length === 0) {
        return false
      }
      // Check if photo exists in event (already validated that in_event_photos is an array above)
      return Array.isArray(editingEvent.in_event_photos) && 
             editingEvent.in_event_photos.some(p => p && p.id === id)
    })
    
    if (validIdsToDelete.length === 0) {
      if (isMountedRef.current) {
      toast.error("No valid photos selected for deletion")
      }
      // Clear invalid selection
      setSelectedPhotoIds(new Set())
      return
    }
    
    // Warn if some IDs were invalid
    if (validIdsToDelete.length < idsToDelete.length) {
      const invalidCount = idsToDelete.length - validIdsToDelete.length
      if (isMountedRef.current) {
      toast.warning(`${invalidCount} invalid photo${invalidCount !== 1 ? 's' : ''} skipped`)
      }
    }

    // Add selected photos to pending deletions
    setPendingDeletions(prev => {
      // CRITICAL: Validate prev is a Set before using it
      const safePrev = prev instanceof Set ? prev : new Set<string>()
      const newSet = new Set(safePrev)
      // CRITICAL: Validate validIdsToDelete is an array before iterating
      if (Array.isArray(validIdsToDelete)) {
        validIdsToDelete.forEach(id => {
          // CRITICAL: Validate id is a string before adding
          if (typeof id === 'string' && id.trim().length > 0) {
            newSet.add(id)
          }
        })
      }
      return newSet
    })

    // CRITICAL: Do NOT modify editingEvent.in_event_photos array
    // We keep the full array and filter for display only
    // This ensures:
    // 1. Reordering works correctly (uses full array)
    // 2. Snapshot restoration works correctly
    // 3. Adding new photos doesn't lose pending deletions
    // Photos are filtered in the render, not removed from state

    // Clear selection
    setSelectedPhotoIds(new Set())
    if (isMountedRef.current) {
    toast.success(`${validIdsToDelete.length} photo${validIdsToDelete.length !== 1 ? 's' : ''} marked for deletion. Click "Save Changes" to confirm.`)
    }
  }, [selectedPhotoIds, editingEvent])

  // Keyboard shortcuts handler (optimized with useCallback)
  useEffect(() => {
    if (!editDialogOpen || !editingEvent) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when dialog is open and not in an input field
      // CRITICAL: Validate e.target exists before accessing properties
      if (!e.target || !(e.target instanceof HTMLElement)) {
        return
      }
      
      const target = e.target as HTMLElement
      // More comprehensive check for input fields
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('[contenteditable="true"]')
      ) {
        return
      }

      // Prevent shortcuts during save or reordering
      if (saving || reorderingPhotos) {
        return
      }

      // Ctrl/Cmd + A: Select all photos
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && e.key.toLowerCase() === 'a') {
        // CRITICAL: Validate event exists before calling preventDefault
        if (e && typeof e.preventDefault === 'function') {
        e.preventDefault()
        }
        // Use current state values from closure (they're in dependency array)
        const currentEditingEvent = editingEvent
        const currentPendingDeletions = pendingDeletions
        const currentSelectedPhotoIds = selectedPhotoIds
        
        // CRITICAL: Validate in_event_photos is an array before using filter
        if (currentEditingEvent && Array.isArray(currentEditingEvent.in_event_photos)) {
          const availablePhotos = currentEditingEvent.in_event_photos.filter(
            p => p?.id && (currentPendingDeletions instanceof Set ? !currentPendingDeletions.has(p.id) : true)
          )
          const allSelected = currentSelectedPhotoIds.size === availablePhotos.length && availablePhotos.length > 0
          handleSelectAll(!allSelected)
        }
      }

      // Delete or Backspace: Delete selected photos
      // CRITICAL: Validate selectedPhotoIds is a Set before using .size
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPhotoIds instanceof Set && selectedPhotoIds.size > 0) {
        // CRITICAL: Validate event exists before calling preventDefault
        if (e && typeof e.preventDefault === 'function') {
        e.preventDefault()
        }
        handleMarkForDeletion()
      }

      // Escape: Clear selection
      // CRITICAL: Validate selectedPhotoIds is a Set before using .size
      if (e.key === 'Escape' && selectedPhotoIds instanceof Set && selectedPhotoIds.size > 0) {
        // CRITICAL: Validate event exists before calling preventDefault
        if (e && typeof e.preventDefault === 'function') {
        e.preventDefault()
        }
        setSelectedPhotoIds(new Set())
      }
    }

    // CRITICAL: Validate window exists before using addEventListener
    if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      // CRITICAL: Validate window exists before using removeEventListener
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [editDialogOpen, editingEvent, selectedPhotoIds instanceof Set ? selectedPhotoIds.size : 0, pendingDeletions instanceof Set ? pendingDeletions.size : 0, saving, reorderingPhotos, handleSelectAll, handleMarkForDeletion])

  // Fetch images for selection
  // CRITICAL: Wrap fetchImages in useCallback to prevent stale closure issues
  // Since fetchImages only uses isMountedRef (which is stable) and setImages (which is stable),
  // we can safely use an empty dependency array
  const fetchImages = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(buildApiUrl(API_PATHS.adminImages, { limit: 1000 }), {
        signal, // Support abort signal for cancellation
      })
      
      // CRITICAL: Check if request was aborted
      if (signal?.aborted) {
        return
      }
      
      // Simple fix: Check response is OK before parsing
      if (!response.ok) {
        logError("Failed to fetch images", { function: "fetchImages", status: response.status, statusText: response.statusText })
        if (isMountedRef.current) {
          setImages([])
        }
        return
      }
      
      // CRITICAL: Check for 204 No Content (no body to parse)
      if (response.status === 204) {
        logError("Received 204 No Content response (no body to parse)", { function: "fetchImages" })
        if (isMountedRef.current) {
          setImages([])
        }
        return
      }
      
      // Simple fix: Add error handling for JSON parsing
      let json: any
      try {
        json = await response.json()
      } catch (parseError) {
        logError("Failed to parse images JSON", { function: "fetchImages" }, parseError instanceof Error ? parseError : new Error(String(parseError)))
        if (isMountedRef.current) {
          setImages([])
        }
        return
      }
      
      if (json.success) {
        // API returns { success: true, data: { images: [...], pagination: {...} } }
        // Check both possible response structures for compatibility
        const fetchedImages = Array.isArray(json.data?.images) 
          ? json.data.images 
          : Array.isArray(json.images) 
            ? json.images 
            : []
        if (isMountedRef.current) {
        setImages(fetchedImages)
        }
      } else {
        // Set to empty array on error to prevent undefined state
        if (isMountedRef.current) {
        setImages([])
        }
      }
    } catch (error) {
      // CRITICAL: Check if error is from abort (request cancelled)
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was aborted - don't show error, just return
        return
      }
      
      logError("Failed to load images", { function: "fetchImages" }, error instanceof Error ? error : new Error(String(error)))
      // Set to empty array on error to prevent undefined state
      if (isMountedRef.current) {
      setImages([])
    }
  }
  }, []) // fetchImages only uses isMountedRef and setImages, both are stable

  // CRITICAL: Wrap fetchImagesCallback in useCallback to avoid stale closure
  // fetchImages is now also memoized, so we can safely reference it
  const fetchImagesCallback = useCallback(() => {
    // CRITICAL: Create abort controller for request cancellation
    const abortController = new AbortController()
    const signal = abortController.signal
    // CRITICAL: Validate abortControllersRef.current is an array before using push
    if (Array.isArray(abortControllersRef.current)) {
      abortControllersRef.current.push(abortController)
    } else {
      logError("abortControllersRef.current is not an array", { function: "fetchImagesCallback", abortControllersRef: abortControllersRef.current })
      abortControllersRef.current = [abortController]
    }
    
    const cleanupAbortController = () => {
      // CRITICAL: Validate abortControllersRef.current is an array before using filter
      if (Array.isArray(abortControllersRef.current)) {
        abortControllersRef.current = abortControllersRef.current.filter(
          c => c !== abortController
        )
      }
    }
    
    fetchImages(signal).finally(() => {
      cleanupAbortController()
    })
  }, [fetchImages]) // Include fetchImages in dependency array since it's now memoized

  useEffect(() => {
    if (session) {
      fetchImagesCallback()
    }
  }, [session, fetchImagesCallback])

  // Handle event create
  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    // CRITICAL: Validate event exists before calling preventDefault
    if (e && typeof e.preventDefault === 'function') {
    e.preventDefault()
    }
    
    // CRITICAL: Prevent double submission
    if (saving) {
      if (isMountedRef.current) {
        toast.info("Create operation already in progress. Please wait.")
      }
      return
    }
    
    // CRITICAL: Create abort controller for request cancellation
    const abortController = new AbortController()
    const signal = abortController.signal
    // CRITICAL: Validate abortControllersRef.current is an array before using push
    if (Array.isArray(abortControllersRef.current)) {
      abortControllersRef.current.push(abortController)
    } else {
      logError("abortControllersRef.current is not an array", { function: "fetchImagesCallback", abortControllersRef: abortControllersRef.current })
      abortControllersRef.current = [abortController]
    }
    
    const cleanupAbortController = () => {
      // CRITICAL: Validate abortControllersRef.current is an array before using filter
      if (Array.isArray(abortControllersRef.current)) {
        abortControllersRef.current = abortControllersRef.current.filter(
          c => c !== abortController
        )
      }
    }
    
    setSaving(true)

    // CRITICAL: Validate e.currentTarget exists before using it
    if (!e.currentTarget || !(e.currentTarget instanceof HTMLFormElement)) {
      if (isMountedRef.current) {
        toast.error("Form element not found. Please refresh and try again.")
      }
      setSaving(false)
      return
    }

    const formData = new FormData(e.currentTarget)
    let imageId: string | null = null

    // Upload poster image if provided
    if (posterFile) {
      // CRITICAL: Validate file type
      // CRITICAL: Validate posterFile.type exists and is a string before using includes
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
      if (!posterFile?.type || typeof posterFile.type !== 'string' || !validTypes.includes(posterFile.type)) {
        cleanupAbortController()
        if (isMountedRef.current) {
          toast.error("Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.")
        }
        setSaving(false)
        return
      }
      
      try {
        // CRITICAL: Check if component is still mounted before making request
        if (!isMountedRef.current) {
          cleanupAbortController()
          setSaving(false)
          return
        }
        
        const uploadFormData = new FormData()
        uploadFormData.append("file", posterFile)
        // Simple fix: Validate FormData.get() result before using
        const titleValue = formData.get("title")
        const titleString = (titleValue && typeof titleValue === 'string') ? titleValue : "Event Poster"
        uploadFormData.append("title", titleString)

        const uploadResponse = await fetch(API_PATHS.adminImages, {
          method: "POST",
          body: uploadFormData,
          signal, // Add abort signal for cancellation
        })
        
        // CRITICAL: Check if request was aborted
        if (signal && signal.aborted) {
          cleanupAbortController()
          setSaving(false)
          return
        }

        // Simple fix: Check response.ok before parsing JSON
        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text().catch(() => `HTTP ${uploadResponse.status}`)
          throw new Error(`Failed to upload poster: ${errorText}`)
        }

        // CRITICAL: Check for 204 No Content (no body to parse)
        if (uploadResponse.status === 204) {
          throw new Error("Invalid response from server (no content)")
        }

        // Simple fix: Add error handling for JSON parsing
        let uploadJson: any
        try {
          uploadJson = await uploadResponse.json()
        } catch (parseError) {
          throw new Error("Invalid response from server when uploading poster")
        }
        
        if (uploadJson.success && uploadJson.data?.image?.id) {
          imageId = uploadJson.data.image.id
        } else {
          // CRITICAL: Validate uploadJson.error structure before accessing properties
          let errorMessage = "Failed to upload poster image"
          if (uploadJson.error) {
            if (typeof uploadJson.error === 'object' && uploadJson.error !== null && 'message' in uploadJson.error && typeof uploadJson.error.message === 'string') {
              errorMessage = uploadJson.error.message
            } else if (typeof uploadJson.error === 'string') {
              errorMessage = uploadJson.error
            }
          }
          if (isMountedRef.current) {
          toast.error(errorMessage)
          }
          setSaving(false)
          return
        }
      } catch (error) {
        // CRITICAL: Check if error is from abort (request cancelled)
        if (error instanceof Error && error.name === 'AbortError') {
          cleanupAbortController()
          if (isMountedRef.current) {
            setSaving(false)
          }
          return
        }
        
        if (isMountedRef.current) {
        toast.error("Failed to upload poster image")
        }
        logError("Error in handleCreate", { function: "handleCreate" }, error instanceof Error ? error : new Error(String(error)))
        setSaving(false)
        return
      }
    }

    // Simple fix: Validate FormData.get() results before using
    const titleValue = formData.get("title")
    const descriptionValue = formData.get("description")
    const eventDateValue = formData.get("event_date")
    const startDateValue = formData.get("start_date")
    const endDateValue = formData.get("end_date")
    
    // CRITICAL: Validate title - must not be empty
    const titleString = (titleValue && typeof titleValue === 'string') ? titleValue.trim() : ""
    if (!titleString) {
      cleanupAbortController()
      if (isMountedRef.current) {
        toast.error("Event title is required")
      }
      setSaving(false)
      return
    }
    
    // CRITICAL: Validate title length (prevent database errors)
    if (titleString.length > 500) {
      cleanupAbortController()
      if (isMountedRef.current) {
        toast.error("Event title is too long (maximum 500 characters)")
      }
      setSaving(false)
      return
    }
    
    // CRITICAL: Validate description length
    const descriptionString = (descriptionValue && typeof descriptionValue === 'string') ? descriptionValue : ""
    if (descriptionString.length > 10000) {
      cleanupAbortController()
      if (isMountedRef.current) {
        toast.error("Event description is too long (maximum 10,000 characters)")
      }
      setSaving(false)
      return
    }
    
    // CRITICAL: Validate date ranges
    let startTimestamp: number | null = null
    let endTimestamp: number | null = null
    
    if (startDateValue && typeof startDateValue === 'string' && startDateValue.trim()) {
      try {
        startTimestamp = createBangkokTimestamp(startDateValue.trim())
        // CRITICAL: Validate timestamp is not NaN and is within valid range
        if (isNaN(startTimestamp) || startTimestamp <= 0 || startTimestamp >= 2147483647) {
          cleanupAbortController()
          if (isMountedRef.current) {
            toast.error("Invalid start date")
          }
          setSaving(false)
          return
        }
      } catch (error) {
        cleanupAbortController()
        if (isMountedRef.current) {
          toast.error("Invalid start date format")
        }
        setSaving(false)
        return
      }
    }
    
    if (endDateValue && typeof endDateValue === 'string' && endDateValue.trim()) {
      try {
        endTimestamp = createBangkokTimestamp(endDateValue.trim())
        // CRITICAL: Validate timestamp is not NaN and is within valid range
        if (isNaN(endTimestamp) || endTimestamp <= 0 || endTimestamp >= 2147483647) {
          cleanupAbortController()
          if (isMountedRef.current) {
            toast.error("Invalid end date")
          }
          setSaving(false)
          return
        }
      } catch (error) {
        cleanupAbortController()
        if (isMountedRef.current) {
          toast.error("Invalid end date format")
        }
        setSaving(false)
        return
      }
    }
    
    // CRITICAL: Validate date ranges
    if (startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp) {
      cleanupAbortController()
      if (isMountedRef.current) {
        toast.error("Start date must be before or equal to end date")
      }
      setSaving(false)
      return
    }
    
    // CRITICAL: Validate date values before using them in eventData
    // Only use date strings if they passed validation (timestamps were calculated successfully)
    const validatedEventDate = (eventDateValue && typeof eventDateValue === 'string' && eventDateValue.trim()) ? eventDateValue.trim() : null
    const validatedStartDate = (startTimestamp !== null && startDateValue && typeof startDateValue === 'string' && startDateValue.trim()) ? startDateValue.trim() : null
    const validatedEndDate = (endTimestamp !== null && endDateValue && typeof endDateValue === 'string' && endDateValue.trim()) ? endDateValue.trim() : null

    const eventData = {
      title: titleString,
      description: descriptionString || null,
      image_id: imageId,
      event_date: validatedEventDate,
      start_date: validatedStartDate,
      end_date: validatedEndDate,
    }

    try {
      // CRITICAL: Check if component is still mounted before making request
      if (!isMountedRef.current) {
        cleanupAbortController()
        setSaving(false)
        return
      }
      
      const response = await fetch(API_PATHS.adminEvents, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
        signal, // Add abort signal for cancellation
      })
      
      // CRITICAL: Check if request was aborted
      if (signal && signal.aborted) {
        cleanupAbortController()
        setSaving(false)
        return
      }

      // Simple fix: Check response.ok before parsing JSON
      if (!response.ok) {
        // CRITICAL: Validate response.status before using
        const status = response.status || 0
        // CRITICAL: Validate response.text() result type
        let errorText: string
        try {
          const textResult = await response.text()
          errorText = typeof textResult === 'string' ? textResult : `HTTP ${status}`
        } catch (textError) {
          errorText = `HTTP ${status}`
        }
        // CRITICAL: Validate errorText is a string before using
        const errorMessage = typeof errorText === 'string' && errorText.length > 0 ? errorText : `HTTP ${status}`
        throw new Error(`Failed to create event: ${errorMessage}`)
      }

      // Simple fix: Add error handling for JSON parsing
      let json: any
      try {
        json = await response.json()
      } catch (parseError) {
        throw new Error("Invalid response from server when creating event")
      }
      if (json.success) {
        const newEvent = json.data?.event || json.event
        // Optimistically add to list (instant UI update)
        if (newEvent) {
          addItem(newEvent)
        }
        if (isMountedRef.current) {
        toast.success("Event created successfully")
        setCreateDialogOpen(false)
        setPosterFile(null)
        setPosterPreview(null)
        setSelectedImageId(null)
        // Reset form safely
        if (createFormRef.current) {
          createFormRef.current.reset()
          } else if (e.currentTarget && e.currentTarget instanceof HTMLFormElement) {
          e.currentTarget.reset()
          }
        }
      } else {
        // CRITICAL: Rollback optimistic update if creation failed
        // Note: Since we haven't added the item yet (we only add on success), no rollback needed
        // But we should refetch to ensure UI is in sync with server
        if (isMountedRef.current) {
          fetchEvents()
        }
        // CRITICAL: Validate json.error structure before accessing properties
        let errorMessage = "Failed to create event"
        if (json.error) {
          if (typeof json.error === 'object' && json.error !== null && 'message' in json.error && typeof json.error.message === 'string') {
            errorMessage = json.error.message
          } else if (typeof json.error === 'string') {
            errorMessage = json.error
          }
        }
        if (isMountedRef.current) {
        toast.error(errorMessage)
        }
      }
    } catch (error) {
      // CRITICAL: Check if error is from abort (request cancelled)
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was aborted - don't show error, just return
        cleanupAbortController()
        if (isMountedRef.current) {
          setSaving(false)
        }
        return
      }
      
      // CRITICAL: Refetch events to ensure UI is in sync with server after error
      if (isMountedRef.current) {
        fetchEvents()
      }
      
      // Simple fix: Check if component is mounted before showing toast
      if (isMountedRef.current) {
      toast.error("Failed to create event")
      }
      logError("Error in handleCreate", { function: "handleCreate" }, error instanceof Error ? error : new Error(String(error)))
    } finally {
      cleanupAbortController()
      if (isMountedRef.current) {
      setSaving(false)
      }
    }
  }

  // Restore event state from snapshot or server (fallback mechanism)
  // This restores ALL event details including form fields, photos, and poster
  // CRITICAL: Must be defined before handleUpdate which uses it
  const restoreEventState = async (eventId: string) => {
    // Simple validation: Check eventId is valid
    if (!eventId || typeof eventId !== 'string' || eventId.trim().length === 0) {
      logError("Invalid eventId provided to restoreEventState", { function: "restoreEventState", eventId })
      return
    }
    
    // Fallback 1: Restore from snapshot if available (includes ALL original data: in_event_photos, dates, description, etc.)
    if (eventSnapshot) {
      // Verify event still exists before restoring (snapshot might be stale)
      try {
        const verifyEvent = await fetchEventDetails(eventId)
        if (!verifyEvent) {
          // Event was deleted - can't restore
          if (isMountedRef.current) {
            toast.error("Event no longer exists. Closing editor.")
            setEditDialogOpen(false)
            setEditingEvent(null)
            setEventSnapshot(null)
            setPendingDeletions(new Set())
            setSelectedPhotoIds(new Set())
            setEditPosterFile(null)
            setEditPosterPreview(null)
          }
          return
        }
      } catch (error) {
        logError("Failed to verify event exists", { function: "restoreEventState", eventId }, error instanceof Error ? error : new Error(String(error)))
        // Continue with snapshot restore anyway
      }
      
      // Simple fix: Check if component is mounted before state updates
      if (isMountedRef.current) {
        setEditingEvent(eventSnapshot)
        setPendingDeletions(new Set())
        setSelectedPhotoIds(new Set())
        setEditPosterFile(null)
        setEditPosterPreview(null)
        // Force form remount to restore form field values (defaultValue only works on mount)
        setFormKey(prev => {
          // CRITICAL: Validate prev is a number before arithmetic
          const safePrev = typeof prev === 'number' && !isNaN(prev) ? prev : 0
          return safePrev + 1
        })
        if (isMountedRef.current) {
          toast.info("Changes have been reverted to the last saved state")
        }
      }
    }
    
    // Fallback 2: Refetch from server (most reliable)
    try {
      const latest = await fetchEventDetails(eventId)
      if (latest && isMountedRef.current) {
        setEditingEvent(latest)
        setPendingDeletions(new Set())
        setSelectedPhotoIds(new Set())
        setEditPosterFile(null)
        setEditPosterPreview(null)
        // Force form remount to restore form field values
        setFormKey(prev => {
          // CRITICAL: Validate prev is a number before arithmetic
          const safePrev = typeof prev === 'number' && !isNaN(prev) ? prev : 0
          return safePrev + 1
        })
        // CRITICAL: Validate eventId before calling replaceItem
        if (eventId && typeof eventId === 'string' && eventId.trim().length > 0) {
          replaceItem(eventId, latest)
        }
        if (!eventSnapshot) {
          if (isMountedRef.current) {
            toast.info("Event state has been refreshed from server")
          }
        }
      } else {
        // Event not found - might have been deleted
        if (isMountedRef.current) {
          toast.error("Event no longer exists. Closing editor.")
          setEditDialogOpen(false)
          setEditingEvent(null)
          setEventSnapshot(null)
          setPendingDeletions(new Set())
          setSelectedPhotoIds(new Set())
          setEditPosterFile(null)
          setEditPosterPreview(null)
        }
      }
    } catch (error) {
      logError("Failed to refetch event details", { function: "restoreEventState", eventId }, error instanceof Error ? error : new Error(String(error)))
      // If refetch fails, at least we tried to restore from snapshot
      if (isMountedRef.current) {
        toast.error("Failed to restore event state. Please refresh the page.")
      }
    }
  }

  // Handle event update
  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    // CRITICAL: Capture editingEvent and related state at the start to avoid stale closure issues
    // But also validate it exists and hasn't changed
    const currentEditingEvent = editingEvent
    const currentPendingDeletions = pendingDeletions instanceof Set ? new Set(pendingDeletions) : new Set<string>()
    const currentEventSnapshot = eventSnapshot
    if (!currentEditingEvent) {
      if (isMountedRef.current) {
      toast.error("No event selected for editing")
      }
      return
    }

    // CRITICAL: Prevent double submission
    if (saving) {
      if (isMountedRef.current) {
      toast.info("Save operation already in progress. Please wait.")
      }
      return
    }

    setSaving(true)
    
    // CRITICAL: Create abort controller for request cancellation
    const abortController = new AbortController()
    const signal = abortController.signal
    
    // Store abort controller for cleanup on unmount
    // CRITICAL: Validate abortControllersRef.current is an array before using push
    if (Array.isArray(abortControllersRef.current)) {
    abortControllersRef.current.push(abortController)
    } else {
      logError("abortControllersRef.current is not an array", { function: "handleMarkForDeletion", abortControllersRef: abortControllersRef.current })
      abortControllersRef.current = [abortController]
    }
    
    // Cleanup function to remove from ref when done
    const cleanupAbortController = () => {
      // CRITICAL: Validate abortControllersRef.current is an array before using filter
      if (Array.isArray(abortControllersRef.current)) {
      abortControllersRef.current = abortControllersRef.current.filter(
        c => c !== abortController
      )
      }
    }
    
    // CRITICAL: Extract form data immediately to capture current state
    // CRITICAL: Validate e.currentTarget exists before using it
    if (!e.currentTarget || !(e.currentTarget instanceof HTMLFormElement)) {
      if (isMountedRef.current) {
        toast.error("Form element not found. Please refresh and try again.")
      }
      setSaving(false)
      cleanupAbortController()
      return
    }
    
    const formData = new FormData(e.currentTarget)
    const updates: any = {}

    // CRITICAL: Extract form values - handle null/undefined properly
    // CRITICAL: Validate FormData.get() results before type assertion
    const titleFormValue = formData.get("title")
    const descriptionFormValue = formData.get("description")
    const eventDateFormValue = formData.get("event_date")
    const startDateFormValue = formData.get("start_date")
    const endDateFormValue = formData.get("end_date")
    
    const title = (titleFormValue && typeof titleFormValue === 'string') ? titleFormValue : null
    const description = (descriptionFormValue && typeof descriptionFormValue === 'string') ? descriptionFormValue : null
    const eventDate = (eventDateFormValue && typeof eventDateFormValue === 'string') ? eventDateFormValue : null
    const startDate = (startDateFormValue && typeof startDateFormValue === 'string') ? startDateFormValue : null
    const endDate = (endDateFormValue && typeof endDateFormValue === 'string') ? endDateFormValue : null

    // CRITICAL: Validate title - must not be empty
    // Handle null/undefined title from form
    const titleValue = title ?? ""
    // CRITICAL: Validate titleValue is a string before calling trim
    const trimmedTitle = (titleValue && typeof titleValue === 'string') ? titleValue.trim() : ""
    if (!trimmedTitle) {
      // If title is missing or empty, use existing title to prevent constraint violation
      if (!currentEditingEvent.title) {
        cleanupAbortController()
        if (isMountedRef.current) {
        toast.error("Event title is required")
        }
        setSaving(false)
        return
      }
      updates.title = currentEditingEvent.title
    } else if (trimmedTitle !== currentEditingEvent.title) {
      // CRITICAL: Validate title length (prevent database errors)
      if (trimmedTitle.length > 500) {
        cleanupAbortController()
        if (isMountedRef.current) {
        toast.error("Event title is too long (maximum 500 characters)")
        }
        setSaving(false)
        return
      }
      updates.title = trimmedTitle
    }
    
    // CRITICAL: Validate description length
    // Handle null/undefined description from form
    const descriptionValue = description ?? ""
    // CRITICAL: Validate descriptionValue is a string before comparison
    const descriptionString = (descriptionValue && typeof descriptionValue === 'string') ? descriptionValue : ""
    if (descriptionString !== (currentEditingEvent.description || "")) {
      if (descriptionString && typeof descriptionString === 'string' && descriptionString.length > 10000) {
        cleanupAbortController()
        toast.error("Event description is too long (maximum 10,000 characters)")
        setSaving(false)
        return
      }
      // Empty string becomes null (database expects null for empty)
      // CRITICAL: Validate descriptionValue is a string before calling .trim()
      updates.description = (descriptionValue && typeof descriptionValue === 'string') 
        ? descriptionValue.trim() || null 
        : null
    }
    
    // Upload new poster image if provided
    let finalImageId: string | null = currentEditingEvent.image_id || null
    if (editPosterFile) {
      // CRITICAL: Validate file type
      // CRITICAL: Validate editPosterFile.type exists and is a string before using includes
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
      if (!editPosterFile?.type || typeof editPosterFile.type !== 'string' || !validTypes.includes(editPosterFile.type)) {
        cleanupAbortController()
        toast.error("Invalid image type. Please use JPEG, PNG, WebP, or GIF.")
        setSaving(false)
        return
      }
      
      try {
        const uploadFormData = new FormData()
        uploadFormData.append("file", editPosterFile)
        uploadFormData.append("title", trimmedTitle || currentEditingEvent.title || "Event Poster")

        const uploadResponse = await fetch(API_PATHS.adminImages, {
          method: "POST",
          body: uploadFormData,
          signal, // Add abort signal for cancellation
        })
        
        // CRITICAL: Check if request was aborted
        if (signal && signal.aborted) {
          cleanupAbortController()
          setSaving(false)
          return
        }
        
        // CRITICAL: Check if response is OK before parsing
        if (!uploadResponse.ok) {
          cleanupAbortController()
          // CRITICAL: Validate response.status and response.statusText before using
          const status = uploadResponse.status || 0
          const statusText = uploadResponse.statusText || 'Unknown'
          toast.error(`Failed to upload poster image: ${status} ${statusText}`)
          setSaving(false)
          return
        }

        // CRITICAL: Check for 204 No Content (no body to parse)
        if (uploadResponse.status === 204) {
          cleanupAbortController()
          logError("Received 204 No Content response (no body to parse)", { function: "handleUpdate" })
          toast.error("Invalid response from server (no content)")
          setSaving(false)
          return
        }

        // CRITICAL: Handle JSON parsing errors
        let uploadJson: any
        try {
          uploadJson = await uploadResponse.json()
        } catch (parseError) {
          cleanupAbortController()
          logError("Failed to parse upload response JSON", { function: "handleCreate" }, parseError instanceof Error ? parseError : new Error(String(parseError)))
          toast.error("Invalid response from server. Please try again.")
          setSaving(false)
          return
        }
        
        // CRITICAL: Validate response structure
        if (uploadJson && uploadJson.success && uploadJson.data?.image?.id) {
          const uploadedImageId = uploadJson.data.image.id
          // CRITICAL: Validate image ID is a non-empty string
          if (typeof uploadedImageId === 'string' && uploadedImageId.trim().length > 0) {
            finalImageId = uploadedImageId
          } else {
            cleanupAbortController()
            toast.error("Invalid image ID received from server")
            setSaving(false)
            return
          }
        } else {
          cleanupAbortController()
          // CRITICAL: Validate uploadJson.error structure before accessing properties
          let errorMessage = "Failed to upload poster image"
          if (uploadJson?.error) {
            if (typeof uploadJson.error === 'object' && uploadJson.error !== null && 'message' in uploadJson.error && typeof uploadJson.error.message === 'string') {
              errorMessage = uploadJson.error.message
            } else if (typeof uploadJson.error === 'string') {
              errorMessage = uploadJson.error
            }
          }
          toast.error(errorMessage)
          setSaving(false)
          return
        }
      } catch (error) {
        cleanupAbortController()
        
        // CRITICAL: Check if error is from abort (request cancelled)
        if (error instanceof Error && error.name === 'AbortError') {
          // Request was aborted - don't show error, just return
          setSaving(false)
          return
        }
        
        toast.error("Failed to upload poster image")
        logError("Failed to upload poster image", { function: "handleCreate" }, error instanceof Error ? error : new Error(String(error)))
        setSaving(false)
        return
      }
    }
    
    if (finalImageId !== (currentEditingEvent.image_id || null)) updates.image_id = finalImageId
    
    // CRITICAL: Validate and convert dates (only if provided and valid)
    // Also validate date ranges (start_date <= end_date)
    let startTimestamp: number | null = null
    let endTimestamp: number | null = null
    
    // CRITICAL: Validate and convert dates - handle empty strings
    // Use Bangkok timezone for all date conversions
    if (eventDate && eventDate.trim()) {
      try {
        // CRITICAL: Use createBangkokTimestamp to ensure dates are interpreted in Bangkok timezone (GMT+7)
        // This prevents timezone conversion issues when user's browser is in a different timezone
        const timestamp = createBangkokTimestamp(eventDate.trim())
        // CRITICAL: Validate timestamp is not NaN and is reasonable (not too far in past/future)
        if (!isNaN(timestamp) && timestamp > 0 && timestamp < 2147483647) { // Max 32-bit signed int
          if (timestamp !== (currentEditingEvent.event_date || null)) {
            updates.event_date = timestamp
          }
        } else {
          cleanupAbortController()
          if (isMountedRef.current) {
          toast.error("Invalid event date: date is out of valid range")
          }
          setSaving(false)
          return
        }
      } catch (error) {
        cleanupAbortController()
        const errorMessage = error instanceof Error ? error.message : "Invalid event date format"
        if (isMountedRef.current) {
        toast.error(errorMessage)
        }
        setSaving(false)
        return
      }
    } else if (eventDate === "") {
      // Empty string means clear the date
      if (currentEditingEvent.event_date !== null) {
        updates.event_date = null
      }
    }
    
    if (startDate && startDate.trim()) {
      try {
        // CRITICAL: Use createBangkokTimestamp to ensure dates are interpreted in Bangkok timezone (GMT+7)
        // This prevents timezone conversion issues when user's browser is in a different timezone
        startTimestamp = createBangkokTimestamp(startDate.trim())
        // CRITICAL: Validate timestamp is not NaN and is reasonable
        if (!isNaN(startTimestamp) && startTimestamp > 0 && startTimestamp < 2147483647) {
          if (startTimestamp !== (currentEditingEvent.start_date || null)) {
            updates.start_date = startTimestamp
          }
        } else {
          cleanupAbortController()
          if (isMountedRef.current) {
          toast.error("Invalid start date: date is out of valid range")
          }
          setSaving(false)
          return
        }
      } catch (error) {
        cleanupAbortController()
        const errorMessage = error instanceof Error ? error.message : "Invalid start date format"
        if (isMountedRef.current) {
        toast.error(errorMessage)
        }
        setSaving(false)
        return
      }
    } else if (startDate === "") {
      // Empty string means clear the date
      if (currentEditingEvent.start_date !== null) {
        updates.start_date = null
        startTimestamp = null
      }
    } else if (currentEditingEvent.start_date) {
      startTimestamp = currentEditingEvent.start_date
    }
    
    if (endDate && endDate.trim()) {
      try {
        // CRITICAL: Use createBangkokTimestamp to ensure dates are interpreted in Bangkok timezone (GMT+7)
        // This prevents timezone conversion issues when user's browser is in a different timezone
        endTimestamp = createBangkokTimestamp(endDate.trim())
        // CRITICAL: Validate timestamp is not NaN and is reasonable
        if (!isNaN(endTimestamp) && endTimestamp > 0 && endTimestamp < 2147483647) {
          if (endTimestamp !== (currentEditingEvent.end_date || null)) {
            updates.end_date = endTimestamp
          }
        } else {
          cleanupAbortController()
          if (isMountedRef.current) {
          toast.error("Invalid end date: date is out of valid range")
          }
          setSaving(false)
          return
        }
      } catch (error) {
        cleanupAbortController()
        const errorMessage = error instanceof Error ? error.message : "Invalid end date format"
        if (isMountedRef.current) {
        toast.error(errorMessage)
        }
        setSaving(false)
        return
      }
    } else if (endDate === "") {
      // Empty string means clear the date
      if (currentEditingEvent.end_date !== null) {
        updates.end_date = null
        endTimestamp = null
      }
    } else if (currentEditingEvent.end_date) {
      endTimestamp = currentEditingEvent.end_date
    }
    
    // CRITICAL: Validate date ranges
    if (startTimestamp !== null && endTimestamp !== null && startTimestamp > endTimestamp) {
      cleanupAbortController()
      if (isMountedRef.current) {
      toast.error("Start date must be before or equal to end date")
      setSaving(false)
      }
      return
    }

    // Handle pending photo deletions via background jobs
    // CRITICAL: Capture initial deletion state at the start to avoid stale closure issues
    // CRITICAL: Validate pendingDeletions is a Set before using .size
    const initialPendingDeletionsSize = pendingDeletions instanceof Set ? pendingDeletions.size : 0
    const hadDeletionsAtStart = initialPendingDeletionsSize > 0
    
    let deletionQueued = false
    let deletionSucceeded = false // Track if deletion actually succeeded (not just queued)
    if (hadDeletionsAtStart) {
      try {
        // CRITICAL: Validate that all pending deletion IDs still exist in the event
        // This prevents errors if photos were deleted externally
        // Use currentEditingEvent to avoid stale closure
        // CRITICAL: Capture pendingDeletions at this moment to avoid race conditions
        // CRITICAL: Validate pendingDeletions is a Set before using Array.from
        const currentPendingDeletionsArray = pendingDeletions instanceof Set ? Array.from(pendingDeletions) : []
        const validPendingDeletions = currentPendingDeletionsArray.filter(id => {
          // CRITICAL: Validate in_event_photos exists and is an array
          if (!Array.isArray(currentEditingEvent.in_event_photos)) {
            return false
          }
          return currentEditingEvent.in_event_photos.some(p => p && p.id === id)
        })
        
        // CRITICAL: Validate validPendingDeletions array
        // Note: filter() always returns an array, so this check is defensive
        if (!Array.isArray(validPendingDeletions)) {
          logError("validPendingDeletions is not an array", { function: "handleUpdate", validPendingDeletions })
          if (isMountedRef.current) {
          toast.error("Error validating deletions. Please try again.")
          }
          deletionQueued = false
        } else {
          // Handle case where some deletions are invalid
          if (validPendingDeletions.length < currentPendingDeletionsArray.length) {
            const invalidCount = currentPendingDeletionsArray.length - validPendingDeletions.length
            if (isMountedRef.current) {
            toast.warning(`${invalidCount} photo${invalidCount !== 1 ? 's' : ''} marked for deletion no longer exist. They will be skipped.`)
            }
            // Update pendingDeletions to only include valid IDs
            // CRITICAL: Only update if component is still mounted
            if (isMountedRef.current) {
              setPendingDeletions(new Set(validPendingDeletions))
            }
          }
          
          // Process deletions only if we have valid ones
          if (validPendingDeletions.length === 0) {
            // All pending deletions are invalid - clear them
            if (isMountedRef.current) {
              setPendingDeletions(new Set())
            }
            if (isMountedRef.current) {
            toast.info("No valid photos to delete.")
            }
            // CRITICAL: Update hadDeletionsAtStart flag since all deletions were invalid
            // This prevents "No changes to save" from incorrectly showing when there are no valid deletions
            // Note: We can't modify hadDeletionsAtStart (it's a const), but we can track this separately
            deletionQueued = false
          } else {
            // We have valid deletions to process
            // CRITICAL: Check if component is still mounted before making request
            if (!isMountedRef.current) {
              cleanupAbortController()
              setSaving(false)
              return
            }
            
            // CRITICAL: Final validation before sending (defensive check)
            // At this point, validPendingDeletions should be a non-empty array, but verify
            if (validPendingDeletions.length === 0) {
              logError("Unexpected: validPendingDeletions is empty after validation", { function: "handleUpdate" })
              if (isMountedRef.current) {
              toast.error("No valid photos to delete")
              }
              deletionQueued = false
            } else {
              // CRITICAL: Validate all IDs are non-empty strings before sending
              const invalidIds = validPendingDeletions.filter(id => typeof id !== 'string' || id.trim().length === 0)
              if (invalidIds.length > 0) {
                logError("Invalid photo IDs in deletion request", { function: "handleUpdate", invalidIds })
                if (isMountedRef.current) {
                toast.error("Invalid photo IDs. Please try again.")
                }
                deletionQueued = false
              } else {
                const deleteResponse = await fetch(API_PATHS.adminEventImagesBatchDelete(currentEditingEvent.id), {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: (() => {
                  // CRITICAL: Validate validPendingDeletions before stringifying
                  if (!Array.isArray(validPendingDeletions) || validPendingDeletions.length === 0) {
                    throw new Error("Invalid imageIds array for JSON.stringify")
                  }
                  // CRITICAL: Validate all IDs are strings
                  const invalidIds = validPendingDeletions.filter(id => typeof id !== 'string' || id.trim().length === 0)
                  if (invalidIds.length > 0) {
                    throw new Error("Invalid imageIds in array for JSON.stringify")
                  }
                  try {
                    return JSON.stringify({ imageIds: validPendingDeletions })
                  } catch (stringifyError) {
                    logError("Failed to stringify deletion request body", { function: "handleUpdate" }, stringifyError instanceof Error ? stringifyError : new Error(String(stringifyError)))
                    throw new Error("Failed to prepare deletion request body")
                  }
                })(),
                signal, // Add abort signal for cancellation
              })

              // CRITICAL: Check if request was aborted
              if (signal && signal.aborted) {
                cleanupAbortController()
                setSaving(false)
                return
              }

              // CRITICAL: Check if response is OK before parsing JSON
              if (!deleteResponse.ok) {
                cleanupAbortController()
                if (!isMountedRef.current) {
                  setSaving(false)
                  return
                }
                const errorMessage = `Failed to delete photos: ${deleteResponse.status} ${deleteResponse.statusText}`
                if (isMountedRef.current) {
                  toast.error(errorMessage)
                }
                deletionQueued = false
              } else {
                // CRITICAL: Check for 204 No Content (no body to parse)
                if (deleteResponse.status === 204) {
                  // 204 No Content is a valid success response for DELETE operations
                  logInfo("Photo deletion successful (204 No Content)", { function: "handleUpdate" })
                  deletionQueued = true
                  deletionSucceeded = true
                  // Update UI optimistically for 204 response
                  if (isMountedRef.current && currentEditingEvent && Array.isArray(currentEditingEvent.in_event_photos)) {
                    const remainingPhotos = currentEditingEvent.in_event_photos.filter(
                      p => p && !validPendingDeletions.includes(p.id)
                    )
                    setEditingEvent({
                      ...currentEditingEvent,
                      in_event_photos: remainingPhotos,
                    })
                  }
                  // Clear pending deletions after successful deletion
                  if (isMountedRef.current) {
                    setPendingDeletions(new Set())
                    setSelectedPhotoIds(new Set()) // Also clear selection
                  }
                  if (isMountedRef.current) {
                    toast.success(`Successfully deleted ${validPendingDeletions.length} photo${validPendingDeletions.length !== 1 ? 's' : ''}`)
                  }
                } else {
                  // CRITICAL: Handle JSON parsing errors (only if response is OK and not 204)
              let deleteJson: any
              try {
                deleteJson = await deleteResponse.json()
              } catch (parseError) {
                cleanupAbortController()
                if (!isMountedRef.current) {
                  setSaving(false)
                  return
                }
                  logError("Failed to parse deletion response JSON", { function: "handleUpdate" }, parseError instanceof Error ? parseError : new Error(String(parseError)))
                  if (isMountedRef.current) {
                toast.error("Invalid response from server. Please try again.")
                  }
                // Don't fail the entire save - continue with other updates
                // Set deletionQueued to false so we know it failed
                deletionQueued = false
                  return
                }
                
                if (deleteJson && deleteJson.success) {
                // IMPROVED: Handle new response format with immediate deletion
                // API returns: deleted, requested, attempted, cleanupJobsQueued, cleanupJobsFailed, jobIds, warnings
                const requestedCount = validPendingDeletions.length
                
                // Extract counts from response, with validation
                // API returns: deleted, requested, attempted, cleanupJobsQueued, cleanupJobsFailed
                const deletedCount = typeof deleteJson.data?.deleted === 'number' 
                  ? deleteJson.data.deleted 
                  : 0
                const responseRequestedCount = typeof deleteJson.data?.requested === 'number'
                  ? deleteJson.data.requested
                  : requestedCount
                // COMPREHENSIVE REVIEW FIX: Use 'attempted' field if available (what we actually tried to delete)
                // This is more accurate than 'requested' if some photos were deleted between verification and lock
                const attemptedCount = typeof deleteJson.data?.attempted === 'number'
                  ? deleteJson.data.attempted
                  : responseRequestedCount // Fallback to requested if attempted not available
                const cleanupJobsQueued = typeof deleteJson.data?.cleanupJobsQueued === 'number'
                  ? deleteJson.data.cleanupJobsQueued
                  : 0
                const cleanupJobsFailed = typeof deleteJson.data?.cleanupJobsFailed === 'number'
                  ? deleteJson.data.cleanupJobsFailed
                  : 0
                
                // Validate counts are reasonable
                if (deletedCount < 0 || attemptedCount < 0) {
                  logError("Invalid deletion response counts", { function: "handleUpdate", deletedCount, attemptedCount })
                  if (isMountedRef.current) {
                  toast.warning("Received invalid response from server. Some deletions may have failed.")
                  }
                  deletionQueued = false
                } else if (deletedCount === 0) {
                  // No photos were deleted at all
                  deletionQueued = false
                  if (isMountedRef.current) {
                  toast.error(`Failed to delete ${attemptedCount} photo${attemptedCount !== 1 ? 's' : ''}. Please try again.`)
                  }
                } else if (deletedCount === attemptedCount) {
                  // EDGE CASE FIX: Only update UI after confirming actual deletion count matches
                  // This prevents optimistic updates when deletion actually failed
                  deletionQueued = true
                  deletionSucceeded = true // Mark deletion as successful
                  
                  // Update UI only after confirming successful deletion
                  // Since event_images records are deleted immediately (no transaction), 
                  // we can safely update UI now
                  if (isMountedRef.current && currentEditingEvent && Array.isArray(currentEditingEvent.in_event_photos)) {
                    const remainingPhotos = currentEditingEvent.in_event_photos.filter(
                      p => p && !validPendingDeletions.includes(p.id)
                    )
                    setEditingEvent({
                      ...currentEditingEvent,
                      in_event_photos: remainingPhotos,
                    })
                  }
                  
                  // Clear pending deletions after successful deletion
                  if (isMountedRef.current) {
                    setPendingDeletions(new Set())
                    setSelectedPhotoIds(new Set()) // Also clear selection
                  }
                  
                  // Show single, clear success message
                  // Note: Don't show toast here if cleanup jobs failed - that's non-critical
                  // The success message is sufficient
                  if (isMountedRef.current) {
                  toast.success(`Successfully deleted ${deletedCount} photo${deletedCount !== 1 ? 's' : ''}`)
                  }
                } else {
                  // Partial success - some deletions failed
                  deletionQueued = false
                  
                  // Build clear warning message
                  // COMPREHENSIVE REVIEW FIX: Use attemptedCount for accurate messaging
                  // Note: API now uses immediate deletion, so partial success means some photos were already deleted
                  // Since we don't know which specific photos were deleted, we'll update optimistically
                  let warningMessage = `Deleted ${deletedCount} of ${attemptedCount} photo${attemptedCount !== 1 ? 's' : ''} attempted`
                  if (attemptedCount < responseRequestedCount) {
                    warningMessage += ` (${responseRequestedCount - attemptedCount} were already deleted)`
                  }
                  if (cleanupJobsFailed > 0) {
                    warningMessage += `. ${cleanupJobsFailed} cleanup job${cleanupJobsFailed !== 1 ? 's' : ''} failed to queue (photos are deleted, cleanup will retry)`
                  }
                  
                  // For partial success, update UI optimistically (remove all pending deletions)
                  // The API has already deleted what it could, so we update UI to match
                  if (isMountedRef.current && currentEditingEvent && Array.isArray(currentEditingEvent.in_event_photos)) {
                    const remainingPhotos = currentEditingEvent.in_event_photos.filter(
                      p => p && !validPendingDeletions.includes(p.id)
                    )
                    setEditingEvent({
                      ...currentEditingEvent,
                      in_event_photos: remainingPhotos,
                    })
                    // Clear pending deletions since API has processed them
                    setPendingDeletions(new Set())
                    setSelectedPhotoIds(new Set())
                  }
                  
                  warningMessage += ". Please refresh if photos don't update correctly."
                  if (isMountedRef.current) {
                  toast.warning(warningMessage)
                  }
                }
              } else {
                // deleteJson exists but success is false
                const errorMessage = deleteJson?.data?.message || deleteJson?.error?.message || deleteJson?.error || "Failed to delete photos"
                  if (isMountedRef.current) {
                toast.error(errorMessage)
                  }
                deletionQueued = false
                // Don't fail the entire save if deletion fails - continue with other updates
              }
              }
              }
              }
            }
          }
        }
      } catch (error) {
        cleanupAbortController()
        
        // CRITICAL: Check if error is from abort (request cancelled)
        if (error instanceof Error && (error.name === 'AbortError' || (typeof DOMException !== "undefined" && error instanceof DOMException && error.code === DOMException.ABORT_ERR))) {
          // Request was aborted - don't show error, just return
          if (isMountedRef.current) {
            setSaving(false)
          }
          return
        }
        
        logError("Failed to queue photo deletions", { function: "handleUpdate" }, error instanceof Error ? error : new Error(String(error)))
        if (isMountedRef.current) {
          toast.error("Failed to queue photo deletions")
        }
        // Don't fail the entire save if deletion queueing fails - continue with other updates
      }
    }

    // CRITICAL: Check if there are any changes to save
    // Use hadDeletionsAtStart and deletionQueued to determine if we actually processed deletions
    // Note: If all deletions were invalid (validPendingDeletions.length === 0), deletionQueued will be false
    // and we should not consider it as "having deletions" for the "No changes to save" check
    // CRITICAL: Validate updates is an object before using Object.keys
    const hasUpdates = updates && typeof updates === 'object' && !Array.isArray(updates) && Object.keys(updates).length > 0
    // CRITICAL: Only consider deletions as "changes" if we actually queued them or if there are still pending ones
    // If all deletions were invalid, we don't have any changes related to deletions
    // CRITICAL: Validate pendingDeletions is a Set before using .size
    const hasDeletions = hadDeletionsAtStart && (deletionQueued || (pendingDeletions instanceof Set && pendingDeletions.size > 0))
    // Check for photo order changes by comparing current order with snapshot
    // CRITICAL: Use captured state values to ensure consistency throughout the function
    let hasOrderChanges = false
    if (currentEventSnapshot && currentEditingEvent && Array.isArray(currentEditingEvent.in_event_photos) && Array.isArray(currentEventSnapshot.in_event_photos)) {
      // Filter out pending deletions from both arrays for comparison
      // Use captured pendingDeletions to ensure consistency
      const currentPhotos = currentEditingEvent.in_event_photos.filter(
        p => p && p.id && (currentPendingDeletions instanceof Set ? !currentPendingDeletions.has(p.id) : true)
      )
      const snapshotPhotos = currentEventSnapshot.in_event_photos.filter(
        p => p && p.id && (currentPendingDeletions instanceof Set ? !currentPendingDeletions.has(p.id) : true)
      )
      // Check if order has changed by comparing photo IDs in sequence
      // CRITICAL: Validate photo IDs are strings before comparison
      hasOrderChanges = currentPhotos.length !== snapshotPhotos.length ||
        currentPhotos.some((photo, index) => {
          // CRITICAL: Validate photo and photo.id exist and are strings
          if (!photo || !photo.id || typeof photo.id !== 'string' || photo.id.trim().length === 0) {
            return true // Invalid photo means order changed
          }
          const snapshotPhoto = snapshotPhotos[index]
          // CRITICAL: Validate snapshotPhoto and snapshotPhoto.id exist and are strings
          if (!snapshotPhoto || !snapshotPhoto.id || typeof snapshotPhoto.id !== 'string' || snapshotPhoto.id.trim().length === 0) {
            return true // Missing snapshot photo means order changed
          }
          return photo.id !== snapshotPhoto.id
        })
    }
    const hasAnyChanges = hasUpdates || hasDeletions || hasOrderChanges
    
    if (!hasAnyChanges) {
      cleanupAbortController()
      if (isMountedRef.current) {
      toast.info("No changes to save")
      setSaving(false)
      }
      return
    }

    try {
      // CRITICAL: Re-validate editingEvent still exists before proceeding
      // It might have been deleted externally
      if (!editingEvent || editingEvent.id !== currentEditingEvent.id) {
        cleanupAbortController()
        if (isMountedRef.current) {
        toast.error("Event was modified or deleted. Please refresh and try again.")
        }
        await restoreEventState(currentEditingEvent.id)
        setSaving(false)
        return
      }
      
      // Optimistically update UI first (only if there are actual updates)
      // CRITICAL: Validate updates is an object before using Object.keys
      if (updates && typeof updates === 'object' && !Array.isArray(updates) && Object.keys(updates).length > 0) {
        updateItem(currentEditingEvent.id, updates as Partial<Event>)
      }
      
      // Only send PATCH request if there are actual updates
      let updateSuccess = true
      if (updates && typeof updates === 'object' && !Array.isArray(updates) && Object.keys(updates).length > 0) {
        // CRITICAL: Check if component is still mounted before making request
        if (!isMountedRef.current) {
          cleanupAbortController()
          setSaving(false)
          return
        }
        
        const response = await fetch(API_PATHS.adminEvent(currentEditingEvent.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
          signal, // Add abort signal for cancellation
        })

        // CRITICAL: Check if response is OK before parsing JSON
        if (!response.ok) {
          cleanupAbortController()
          if (!isMountedRef.current) {
            setSaving(false)
            return
          }
          const status = response.status || 0
          const statusText = response.statusText || 'Unknown'
          let errorText: string
          try {
            const textResult = await response.text()
            errorText = typeof textResult === 'string' && textResult.length > 0 ? textResult : `HTTP ${status} ${statusText}`
          } catch (textError) {
            errorText = `HTTP ${status} ${statusText}`
          }
          updateSuccess = false
          if (isMountedRef.current) {
            toast.error(`Failed to update event: ${errorText}`)
          }
          logError("Failed to update event", { function: "handleUpdate", status, statusText, errorText })
          setSaving(false)
          return
        }

        // CRITICAL: Handle JSON parsing errors
        let json: any
        try {
          json = await response.json()
        } catch (parseError) {
          cleanupAbortController()
          if (!isMountedRef.current) {
            setSaving(false)
            return
          }
          updateSuccess = false
          toast.error("Invalid response from server. Please try again.")
          logError("Failed to parse response JSON", { function: "handleUpdate" }, parseError instanceof Error ? parseError : new Error(String(parseError)))
          setSaving(false)
          return
        }
        
        // Handle 409 CONFLICT (concurrent edit detected)
        // CRITICAL: Validate response.status is a number before comparison
        const responseStatus = typeof response.status === 'number' ? response.status : 0
        // CRITICAL: Validate json.error structure before accessing properties
        // CRITICAL: Validate json.error structure before accessing properties
        const hasConflictCode = json && typeof json === 'object' && json.error && typeof json.error === 'object' && json.error !== null && 
                                'code' in json.error && typeof json.error.code === 'string' && json.error.code === 'CONFLICT'
        if (responseStatus === 409 || hasConflictCode) {
          updateSuccess = false
          // CRITICAL: Validate json.error.message structure
          let errorMessage = "Another admin is currently editing this event. Please refresh and try again."
          if (json.error && typeof json.error === 'object' && json.error !== null && 
              'message' in json.error && typeof json.error.message === 'string') {
            errorMessage = json.error.message
          }
          if (isMountedRef.current) {
          toast.error(errorMessage)
          }
          // Refresh event data to get latest state
          // CRITICAL: Create a new abort controller for refresh to avoid race condition
          // The original signal might be aborted, which would cause the refresh to fail
          if (isMountedRef.current) {
            const refreshAbortController = new AbortController()
            const refreshSignal = refreshAbortController.signal
            // CRITICAL: Validate abortControllersRef.current is an array before using push
            if (Array.isArray(abortControllersRef.current)) {
              abortControllersRef.current.push(refreshAbortController)
            } else {
              logError("abortControllersRef.current is not an array", { function: "handleUpdate", abortControllersRef: abortControllersRef.current })
              abortControllersRef.current = [refreshAbortController]
            }
            try {
              const latest = await fetchEventDetails(currentEditingEvent.id, refreshSignal)
              // Cleanup refresh abort controller
              if (Array.isArray(abortControllersRef.current)) {
                abortControllersRef.current = abortControllersRef.current.filter(c => c !== refreshAbortController)
              }
            if (latest && isMountedRef.current) {
              setEditingEvent(latest)
              // CRITICAL: Use try-catch for deep copy
                if (isMountedRef.current) {
              try {
                setEventSnapshot(JSON.parse(JSON.stringify(latest)))
              } catch (copyError) {
                    logError("Failed to create snapshot", { function: "handleUpdate" }, copyError instanceof Error ? copyError : new Error(String(copyError)))
                    if (isMountedRef.current) {
                setEventSnapshot({ ...latest })
              }
                  }
                }
                if (currentEditingEvent?.id && typeof currentEditingEvent.id === 'string' && currentEditingEvent.id.trim().length > 0) {
              replaceItem(currentEditingEvent.id, latest)
                }
                if (isMountedRef.current) {
              toast.info("Event data has been refreshed with the latest changes.")
                }
              }
            } catch (refreshError) {
              // Cleanup refresh abort controller
              if (Array.isArray(abortControllersRef.current)) {
                abortControllersRef.current = abortControllersRef.current.filter(c => c !== refreshAbortController)
              }
              // Don't treat AbortError as a real error
              if (refreshError instanceof Error && refreshError.name !== 'AbortError') {
                logError("Failed to refresh event details after conflict", { function: "handleUpdate", eventId: currentEditingEvent.id }, refreshError)
                if (isMountedRef.current) {
                  toast.error("Failed to refresh event data. Please refresh the page manually.")
                }
              }
            }
          }
        } else if (json.success) {
          // Check if component is still mounted before updating state
          if (!isMountedRef.current) {
            cleanupAbortController()
            setSaving(false)
            return
          }
          
          // CRITICAL: Validate both possible response structures before using
          const updatedEvent = (json.data && typeof json.data === 'object' && !Array.isArray(json.data) && json.data.event)
            ? json.data.event
            : (json.event && typeof json.event === 'object' && !Array.isArray(json.event))
              ? json.event
              : null
          // CRITICAL: Validate updatedEvent structure before using
          if (updatedEvent && typeof updatedEvent === 'object' && !Array.isArray(updatedEvent)) {
            // CRITICAL: Validate required fields exist and are of correct types
            if (!updatedEvent.id || typeof updatedEvent.id !== 'string' || updatedEvent.id.trim().length === 0 || updatedEvent.id !== currentEditingEvent.id) {
              logError("Updated event ID mismatch or invalid", { 
                function: "handleUpdate",
                expected: currentEditingEvent.id, 
                received: updatedEvent.id 
              })
              if (isMountedRef.current) {
              toast.warning("Event data mismatch. Please refresh the page.")
              }
            } else if (!updatedEvent.title || typeof updatedEvent.title !== 'string' || updatedEvent.title.trim().length === 0) {
              logError("Updated event missing or invalid title", { function: "handleUpdate", updatedEvent })
              if (isMountedRef.current) {
              toast.warning("Invalid event data received. Please refresh the page.")
              }
            } else if (typeof updatedEvent.created_at !== 'number' || typeof updatedEvent.updated_at !== 'number') {
              // CRITICAL: Validate timestamp fields are numbers
              logError("Updated event missing or invalid timestamp fields", { function: "handleUpdate", updatedEvent })
              if (isMountedRef.current) {
                toast.warning("Invalid event data received. Please refresh the page.")
              }
            } else {
              // Data is valid - proceed with update
              if (currentEditingEvent?.id && typeof currentEditingEvent.id === 'string' && currentEditingEvent.id.trim().length > 0) {
              replaceItem(currentEditingEvent.id, updatedEvent)
              }
              // Update editingEvent with server response
              // Simple fix: Check if component is mounted before state updates
              if (isMountedRef.current) {
              setEditingEvent(updatedEvent)
              // CRITICAL: Update snapshot after successful event update
              // This ensures snapshot reflects latest saved state, even if deletions failed
                // CRITICAL: Validate updatedEvent before spread operator to prevent invalid properties
              try {
                  // First validate updatedEvent has required Event interface properties
                  if (updatedEvent && typeof updatedEvent === 'object' && !Array.isArray(updatedEvent) &&
                      typeof updatedEvent.id === 'string' && typeof updatedEvent.title === 'string' &&
                      typeof updatedEvent.created_at === 'number' && typeof updatedEvent.updated_at === 'number') {
                setEventSnapshot(JSON.parse(JSON.stringify(updatedEvent)))
                  } else {
                    logError("Invalid updatedEvent structure for snapshot", { function: "handleUpdate", updatedEvent })
                    // Fallback: create minimal valid event object
                    setEventSnapshot({
                      id: updatedEvent.id || currentEditingEvent.id,
                      title: updatedEvent.title || currentEditingEvent.title,
                      description: updatedEvent.description ?? currentEditingEvent.description,
                      image_id: updatedEvent.image_id ?? currentEditingEvent.image_id,
                      event_date: updatedEvent.event_date ?? currentEditingEvent.event_date,
                      start_date: updatedEvent.start_date ?? currentEditingEvent.start_date,
                      end_date: updatedEvent.end_date ?? currentEditingEvent.end_date,
                      created_at: updatedEvent.created_at || currentEditingEvent.created_at,
                      updated_at: updatedEvent.updated_at || currentEditingEvent.updated_at,
                      image_url: updatedEvent.image_url ?? currentEditingEvent.image_url,
                      image_title: updatedEvent.image_title ?? currentEditingEvent.image_title,
                      in_event_photos: Array.isArray(updatedEvent.in_event_photos) ? updatedEvent.in_event_photos : currentEditingEvent.in_event_photos || []
                    })
                  }
              } catch (copyError) {
                  logError("Failed to update snapshot", { function: "handleUpdate" }, copyError instanceof Error ? copyError : new Error(String(copyError)))
                  // Fallback: use validated spread with only known Event properties
                  if (isMountedRef.current) {
                    const safeEvent: Event = {
                      id: updatedEvent.id || currentEditingEvent.id,
                      title: updatedEvent.title || currentEditingEvent.title,
                      description: updatedEvent.description ?? currentEditingEvent.description ?? null,
                      image_id: updatedEvent.image_id ?? currentEditingEvent.image_id ?? null,
                      event_date: updatedEvent.event_date ?? currentEditingEvent.event_date ?? null,
                      start_date: updatedEvent.start_date ?? currentEditingEvent.start_date ?? null,
                      end_date: updatedEvent.end_date ?? currentEditingEvent.end_date ?? null,
                      created_at: updatedEvent.created_at || currentEditingEvent.created_at,
                      updated_at: updatedEvent.updated_at || currentEditingEvent.updated_at,
                      image_url: updatedEvent.image_url ?? currentEditingEvent.image_url ?? null,
                      image_title: updatedEvent.image_title ?? currentEditingEvent.image_title ?? null,
                      in_event_photos: Array.isArray(updatedEvent.in_event_photos) ? updatedEvent.in_event_photos : currentEditingEvent.in_event_photos || []
                    }
                    setEventSnapshot(safeEvent)
                  }
                }
              }
            }
          } else {
            // Invalid event data - don't update state
            logError("Invalid updated event data", { function: "handleUpdate", updatedEvent })
            if (isMountedRef.current) {
            toast.warning("Invalid event data received. Please refresh the page.")
            }
          }
        } else {
          updateSuccess = false
          // CRITICAL: Validate json.error structure before accessing properties
          let errorMessage = "Failed to update event"
          if (json.error) {
            if (typeof json.error === 'object' && json.error !== null && 'message' in json.error && typeof json.error.message === 'string') {
              errorMessage = json.error.message
            } else if (typeof json.error === 'string') {
              errorMessage = json.error
            }
          }
          if (isMountedRef.current) {
          toast.error(errorMessage)
          }
        }
      }

      // CRITICAL: Re-validate editingEvent still exists before finalizing
      if (!editingEvent || editingEvent.id !== currentEditingEvent.id) {
        cleanupAbortController()
        if (isMountedRef.current) {
        toast.error("Event was modified or deleted during save. Please refresh and try again.")
        await restoreEventState(currentEditingEvent.id)
        setSaving(false)
        }
        return
      }

      // Update display_order for in-event photos if order has changed
      // Use the same hasOrderChanges variable calculated earlier to ensure consistency
      // CRITICAL: Use captured state values (currentEditingEvent, currentEventSnapshot, currentPendingDeletions)
      // to ensure we're working with the same state throughout the function
      let orderUpdateSuccess = true
      if (hasOrderChanges && currentEventSnapshot && Array.isArray(currentEditingEvent.in_event_photos) && Array.isArray(currentEventSnapshot.in_event_photos)) {
        // Filter out pending deletions from both arrays for comparison
        // Use captured pendingDeletions to ensure consistency
        const currentPhotos = currentEditingEvent.in_event_photos.filter(
          p => p && p.id && (currentPendingDeletions instanceof Set ? !currentPendingDeletions.has(p.id) : true)
        )
        const snapshotPhotos = currentEventSnapshot.in_event_photos.filter(
          p => p && p.id && (currentPendingDeletions instanceof Set ? !currentPendingDeletions.has(p.id) : true)
        )
        
        // Double-check order has changed (defensive check in case state changed)
        // This ensures we only update if order actually changed
        // CRITICAL: Validate photo IDs are strings before comparison
        const orderChanged = currentPhotos.length !== snapshotPhotos.length ||
          currentPhotos.some((photo, index) => {
            // CRITICAL: Validate photo and photo.id exist and are strings
            if (!photo || !photo.id || typeof photo.id !== 'string' || photo.id.trim().length === 0) {
              return true // Invalid photo means order changed
            }
            const snapshotPhoto = snapshotPhotos[index]
            // CRITICAL: Validate snapshotPhoto and snapshotPhoto.id exist and are strings
            if (!snapshotPhoto || !snapshotPhoto.id || typeof snapshotPhoto.id !== 'string' || snapshotPhoto.id.trim().length === 0) {
              return true // Missing snapshot photo means order changed
            }
            return photo.id !== snapshotPhoto.id
          })
        
        // CRITICAL: Only proceed if order actually changed (double-check passed)
        // If orderChanged is false, it means state changed between checks and order is now the same
        // In this case, we don't need to update, but we should still mark as success since no update is needed
        if (!orderChanged) {
          // Order didn't actually change (state changed between checks) - no update needed
          logInfo("Order comparison shows no change - skipping order update", { function: "handleUpdate" })
          orderUpdateSuccess = true // No update needed = success
        } else if (currentPhotos.length === 0) {
          // No photos to update order for (all photos were deleted)
          logInfo("No photos remaining to update order - skipping order update", { function: "handleUpdate" })
          orderUpdateSuccess = true // No update needed = success
        } else if (currentPhotos.length > 0) {
          try {
            // CRITICAL: Check if component is still mounted before making requests
            if (!isMountedRef.current) {
              cleanupAbortController()
              setSaving(false)
              return
            }
            
            // Validate all photos have valid IDs
            const validPhotos = currentPhotos.filter(
              photo => photo && photo.id && typeof photo.id === 'string' && photo.id.trim().length > 0
            )
            
            if (validPhotos.length === 0) {
              logError("No valid photos to update order", { function: "handleUpdate" })
              orderUpdateSuccess = false
            } else if (validPhotos.length > 10000) {
              logError("Too many photos to update order", { function: "handleUpdate", count: validPhotos.length })
              orderUpdateSuccess = false
            } else {
              // Update display_order for all photos based on their current order
              const updatePromises = validPhotos.map((photo, index) => {
                // CRITICAL: Validate index is within reasonable bounds
                const safeIndex = typeof index === 'number' && index >= 0 && index < 100000 ? index : 0
                // CRITICAL: Validate photo.id is a valid string before using in API call (double-check even though validPhotos is filtered)
                if (!photo || !photo.id || typeof photo.id !== 'string' || photo.id.trim().length === 0) {
                  logError("Invalid photo.id in validPhotos", { function: "handleUpdate", photo, index })
                  // Return a rejected promise to handle in Promise.allSettled
                  return Promise.reject(new Error(`Invalid photo.id at index ${index}`))
                }
                return fetch(API_PATHS.adminEventImage(currentEditingEvent.id, photo.id), {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ display_order: safeIndex }),
                  signal, // Add abort signal for cancellation
                }).then(async (res) => {
                  // CRITICAL: Check if request was aborted
                  if (signal && signal.aborted) {
                    throw new Error("Request aborted")
                  }
                  if (!res.ok) {
                    const errorJson = await res.json().catch(() => ({}))
                    // CRITICAL: Validate errorJson structure and photo.id before using in error message
                    const errorMessage = (errorJson && typeof errorJson === 'object' && errorJson.error?.message) 
                      ? errorJson.error.message 
                      : `Failed to update photo ${photo?.id || 'unknown'}`
                    throw new Error(errorMessage)
                  }
                  return res
                })
              })
              
              const results = await Promise.allSettled(updatePromises)
              
              // CRITICAL: Check if operation was aborted
              if (signal && signal.aborted) {
                cleanupAbortController()
                setSaving(false)
                return
              }
              
              // CRITICAL: Validate results array
              if (!Array.isArray(results)) {
                logError("Promise.allSettled returned invalid results for order update", { function: "handleUpdate", results })
                orderUpdateSuccess = false
              } else {
                const failed = results.filter(r => r && r.status === 'rejected').length
                if (failed > 0) {
                  logWarn(`Failed to update order for ${failed} photo${failed !== 1 ? 's' : ''}`, { function: "handleUpdate", failed })
                  if (isMountedRef.current) {
                    toast.warning(`Failed to update order for ${failed} photo${failed !== 1 ? 's' : ''}`)
                  }
                  orderUpdateSuccess = false
                } else {
                  logInfo("Photo order updated successfully", { function: "handleUpdate", photoCount: validPhotos.length })
                }
              }
            }
          } catch (error) {
            // Don't treat AbortError as a real error
            if (error instanceof Error && error.name === 'AbortError') {
              cleanupAbortController()
              setSaving(false)
              return
            }
            logError("Failed to update photo order", { function: "handleUpdate" }, error instanceof Error ? error : new Error(String(error)))
            if (isMountedRef.current) {
              toast.error("Failed to update photo order")
            }
            orderUpdateSuccess = false
          }
        }
      }

      if (updateSuccess) {
        // CRITICAL: Check deletion status
        // Use deletionSucceeded flag instead of checking pendingDeletions.size
        // because state updates are async and might be stale
        const noDeletionsRequested = !hadDeletionsAtStart
        
        // Only show warning if deletions were requested but didn't succeed
        if (hadDeletionsAtStart && !deletionSucceeded) {
          // Deletions were requested but failed
          if (isMountedRef.current) {
          toast.warning("Event updated, but photo deletions failed. Please try deleting photos again.")
          }
        }
        
        // Show warning if order update failed
        if (hasOrderChanges && !orderUpdateSuccess) {
          if (isMountedRef.current) {
            toast.warning("Event updated, but photo order update failed. Please try again.")
          }
        }
        
        // Only clear snapshot and close dialog if everything succeeded
        // (event update succeeded AND deletions succeeded OR no deletions were requested)
        // AND (order update succeeded OR no order changes were made)
        const allOperationsSucceeded = (deletionSucceeded || noDeletionsRequested) && 
                                       (orderUpdateSuccess || !hasOrderChanges)
        if (allOperationsSucceeded) {
          if (isMountedRef.current) {
          setEventSnapshot(null)
          setFormKey(0) // Reset form key
          // Only show "Event updated successfully" if there were actual event updates
          // If only deletions happened, the deletion success message is sufficient
            // CRITICAL: Validate updates is an object before using Object.keys
            if (updates && typeof updates === 'object' && !Array.isArray(updates) && Object.keys(updates).length > 0) {
            toast.success("Event updated successfully")
          }
          setEditDialogOpen(false)
          setEditingEvent(null)
          setEditPosterFile(null)
          setEditPosterPreview(null)
          setEditSelectedImageId(null)
          setSelectedPhotoIds(new Set())
          setPendingDeletions(new Set())
          }
        } else {
          // Keep dialog open if deletions failed - user can retry or cancel
          // Keep snapshot updated with latest event state but don't clear it
          // so user can still restore if needed
          if (isMountedRef.current) {
          toast.info("Event updated. Please retry photo deletions or cancel to discard changes.")
          }
        }
      } else {
        // Fallback: Restore from snapshot or refetch from server
        await restoreEventState(editingEvent.id)
      }
    } catch (error) {
      // Fallback: Restore from snapshot or refetch from server
      if (isMountedRef.current) {
      await restoreEventState(currentEditingEvent.id)
      toast.error("Failed to update event")
        logError("Failed to update event", { function: "handleUpdate" }, error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      if (isMountedRef.current) {
      setSaving(false)
      }
    }
  }

  // Check if there are pending changes (memoized for performance)
  // This checks for deletions, poster changes, and photo reordering that are visible in state
  // Form field changes are validated in handleUpdate
  const hasPendingChanges = useMemo(() => {
    // Check for pending deletions
    // CRITICAL: Validate pendingDeletions is a Set before using .size
    if (pendingDeletions instanceof Set && pendingDeletions.size > 0) return true
    
    // Check for poster image change
    if (editPosterFile) return true
    
    // Check for photo order changes by comparing current order with snapshot
    if (eventSnapshot && editingEvent && Array.isArray(editingEvent.in_event_photos) && Array.isArray(eventSnapshot.in_event_photos)) {
      // Filter out pending deletions from both arrays for comparison
      const currentPhotos = editingEvent.in_event_photos.filter(
        p => p && p.id && (pendingDeletions instanceof Set ? !pendingDeletions.has(p.id) : true)
      )
      const snapshotPhotos = eventSnapshot.in_event_photos.filter(
        p => p && p.id && (pendingDeletions instanceof Set ? !pendingDeletions.has(p.id) : true)
      )
      
      // Check if order has changed by comparing photo IDs in sequence
      if (currentPhotos.length !== snapshotPhotos.length) {
        return true // Length changed, order definitely changed
      }
      
      // Check if sequence of IDs has changed
      // CRITICAL: Validate photo IDs are strings before comparison
      const orderChanged = currentPhotos.some((photo, index) => {
        // CRITICAL: Validate photo and photo.id exist and are strings
        if (!photo || !photo.id || typeof photo.id !== 'string' || photo.id.trim().length === 0) {
          return true // Invalid photo means order changed
        }
        const snapshotPhoto = snapshotPhotos[index]
        // CRITICAL: Validate snapshotPhoto and snapshotPhoto.id exist and are strings
        if (!snapshotPhoto || !snapshotPhoto.id || typeof snapshotPhoto.id !== 'string' || snapshotPhoto.id.trim().length === 0) {
          return true // Missing snapshot photo means order changed
        }
        return photo.id !== snapshotPhoto.id
      })
      
      if (orderChanged) return true
    }
    
    return false
  }, [pendingDeletions, editPosterFile, editingEvent, eventSnapshot])

  // Handle event delete - open confirmation dialog
  const handleDeleteClick = (eventId: string) => {
    setDeleteConfirm(eventId)
  }

  // Confirm event delete - actually perform the deletion
  const handleDelete = async (eventId: string) => {
    // Simple validation: Check eventId is valid
    if (!eventId || typeof eventId !== 'string' || eventId.trim().length === 0) {
      if (isMountedRef.current) {
        toast.error("Invalid event ID. Please refresh and try again.")
      }
      return
    }
    
    // CRITICAL: Create abort controller for request cancellation
    const abortController = new AbortController()
    const signal = abortController.signal
    // CRITICAL: Validate abortControllersRef.current is an array before using push
    if (Array.isArray(abortControllersRef.current)) {
      abortControllersRef.current.push(abortController)
    } else {
      logError("abortControllersRef.current is not an array", { function: "handleDelete", abortControllersRef: abortControllersRef.current })
      abortControllersRef.current = [abortController]
    }
    
    const cleanupAbortController = () => {
      // CRITICAL: Validate abortControllersRef.current is an array before using filter
      if (Array.isArray(abortControllersRef.current)) {
        abortControllersRef.current = abortControllersRef.current.filter(
          c => c !== abortController
        )
      }
    }
    
    try {
      // CRITICAL: Check if component is still mounted before making request
      if (!isMountedRef.current) {
        cleanupAbortController()
        return
      }
      
      setDeleting(true)
      // Optimistically remove from list
      removeItem(eventId)
      
      const response = await fetch(API_PATHS.adminEvent(eventId), {
        method: "DELETE",
        signal, // Add abort signal for cancellation
      })
      
      // CRITICAL: Check if request was aborted
      if (signal && signal.aborted) {
        cleanupAbortController()
        if (isMountedRef.current) {
          setDeleting(false)
        }
        return
      }

      // Simple fix: Check response.ok before parsing JSON
      if (!response.ok) {
        // CRITICAL: Validate response.status before using
        const status = response.status || 0
        // CRITICAL: Validate response.text() result type
        let errorText: string
        try {
          const textResult = await response.text()
          errorText = typeof textResult === 'string' ? textResult : `HTTP ${status}`
        } catch (textError) {
          errorText = `HTTP ${status}`
        }
        // CRITICAL: Validate errorText is a string before using
        const errorMessage = typeof errorText === 'string' && errorText.length > 0 ? errorText : `HTTP ${status}`
        throw new Error(`Failed to delete event: ${errorMessage}`)
      }

      // Simple fix: Add error handling for JSON parsing
      let json: any
      try {
        json = await response.json()
      } catch (parseError) {
        throw new Error("Invalid response from server when deleting event")
      }
      
      if (json.success) {
        if (isMountedRef.current) {
        toast.success("Event deleted successfully")
        setDeleteConfirm(null)
        }
      } else {
        // Rollback on error
        if (isMountedRef.current) {
        fetchEvents()
          // CRITICAL: Validate json.error structure before accessing properties
          let errorMessage = "Failed to delete event"
          if (json.error) {
            if (typeof json.error === 'object' && json.error !== null && 'message' in json.error && typeof json.error.message === 'string') {
              errorMessage = json.error.message
            } else if (typeof json.error === 'string') {
              errorMessage = json.error
            }
          }
        toast.error(errorMessage)
        }
      }
    } catch (error) {
      // CRITICAL: Check if error is from abort (request cancelled)
      if (error instanceof Error && error.name === 'AbortError') {
        // Request was aborted - don't show error, just return
        cleanupAbortController()
        if (isMountedRef.current) {
          setDeleting(false)
        }
        return
      }
      
      // Rollback on error
      if (isMountedRef.current) {
      fetchEvents()
      toast.error("Failed to delete event")
        logError("Failed to delete event", { function: "handleDelete" }, error instanceof Error ? error : new Error(String(error)))
      }
    } finally {
      cleanupAbortController()
      if (isMountedRef.current) {
      setDeleting(false)
      }
    }
  }

  const formatTimestamp = (timestamp: number | null, dateFormat: string = "yyyy-MM-dd") => {
    // CRITICAL: Validate timestamp is a valid number
    if (!timestamp || typeof timestamp !== 'number' || isNaN(timestamp)) return ""
    try {
      // Handle both Unix timestamp (seconds) and milliseconds
      const timestampMs = timestamp > 1000000000000 
        ? timestamp // Already in milliseconds
        : timestamp * 1000 // Convert from seconds to milliseconds
      
      // CRITICAL: Validate converted timestamp is valid
      if (isNaN(timestampMs) || timestampMs <= 0) {
        logError("Invalid timestamp value", { function: "formatTimestamp", timestamp })
        return ""
      }
      
      // CRITICAL: Convert UTC timestamp to Bangkok timezone for display
      // Timestamps in DB are UTC but represent Bangkok time
      const utcDate = new Date(timestampMs)
      const utcTime = utcDate.getTime()
      // CRITICAL: Validate utcTime is a valid number and within reasonable bounds before passing to TZDate
      if (isNaN(utcTime) || !isFinite(utcTime) || utcTime < -8640000000000000 || utcTime > 8640000000000000) {
        logError("Invalid date created from timestamp", { function: "formatTimestamp", timestampMs, utcTime })
        return ""
      }
      const bangkokDate = new TZDate(utcTime, 'Asia/Bangkok')
      
      return format(bangkokDate, dateFormat)
    } catch (error) {
      logError("Error formatting timestamp", { function: "formatTimestamp", timestamp }, error instanceof Error ? error : new Error(String(error)))
      return ""
    }
  }

  // Only show full-page loading on initial load (when there's no data yet)
  // When refetching with existing data, show content with a subtle loading indicator
  if (status === "loading" || (loading && events.length === 0)) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2">Event Management</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage events and their information</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Event
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Event</DialogTitle>
              <DialogDescription>
                Create a new event with details and images
              </DialogDescription>
            </DialogHeader>
            <form ref={createFormRef} onSubmit={handleCreate} className="space-y-4">
              <div>
                <Label htmlFor="create-title">Title *</Label>
                <Input
                  id="create-title"
                  name="title"
                  type="text"
                  required
                  maxLength={500}
                  disabled={saving}
                  aria-describedby="create-title-help"
                />
                <p id="create-title-help" className="text-sm text-gray-500 mt-1">Maximum 500 characters</p>
              </div>
              <div>
                <Label htmlFor="create-description">Description</Label>
                <Textarea
                  id="create-description"
                  name="description"
                  rows={4}
                  maxLength={10000}
                  disabled={saving}
                  aria-describedby="create-description-help"
                />
                <p id="create-description-help" className="text-sm text-gray-500 mt-1">Maximum 10,000 characters</p>
              </div>
              <div>
                <Label htmlFor="create-poster">Poster Image (Upload from device)</Label>
                <Input
                  id="create-poster"
                  name="poster"
                  type="file"
                  accept="image/*"
                  disabled={saving}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    // CRITICAL: Cleanup previous preview blob URL before setting new file
                    // This prevents memory leaks when user selects a new file
                    if (posterPreview && typeof posterPreview === 'string' && posterPreview.startsWith('blob:')) {
                      try {
                        URL.revokeObjectURL(posterPreview)
                      } catch (error) {
                        // Ignore errors during cleanup
                      }
                    }
                    setPosterFile(file)
                    if (file) {
                      const reader = new FileReader()
                      // CRITICAL: Validate fileReadersRef.current is an array before using push
                      if (Array.isArray(fileReadersRef.current)) {
                        fileReadersRef.current.push(reader)
                      }
                      reader.onloadend = () => {
                        // CRITICAL: Check if component is still mounted before updating state
                        if (isMountedRef.current && reader.result && typeof reader.result === 'string') {
                          setPosterPreview(reader.result)
                        }
                        // Remove from tracking array
                        fileReadersRef.current = fileReadersRef.current.filter(r => r !== reader)
                      }
                      reader.onerror = () => {
                        // Simple fix: Handle FileReader errors
                        // CRITICAL: Validate reader exists before accessing properties
                        if (!reader) return
                        const fileName = file?.name || 'unknown file'
                        logError("Failed to read poster file", { function: "handleCreate", fileName })
                        if (isMountedRef.current) {
                          toast.error("Failed to read poster image. Please try again.")
                          setPosterFile(null)
                          setPosterPreview(null)
                        }
                        // Remove from tracking array
                        fileReadersRef.current = fileReadersRef.current.filter(r => r !== reader)
                      }
                      reader.readAsDataURL(file)
                    } else {
                      setPosterPreview(null)
                    }
                  }}
                />
                {posterPreview && (
                  <div className="mt-2">
                    <img
                      src={posterPreview}
                      alt="Poster preview"
                      className="h-32 w-auto rounded object-cover border border-gray-200"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        // CRITICAL: Cleanup blob URL if posterPreview is a blob URL before clearing
                        if (posterPreview && typeof posterPreview === 'string' && posterPreview.startsWith('blob:')) {
                          try {
                            URL.revokeObjectURL(posterPreview)
                          } catch (error) {
                            // Ignore errors during cleanup
                          }
                        }
                        setPosterFile(null)
                        setPosterPreview(null)
                        // CRITICAL: Validate document.getElementById result before using
                        const input = document.getElementById("create-poster") as HTMLInputElement | null
                        if (input) {
                          input.value = ''
                        }
                      }}
                      disabled={saving}
                    >
                      Remove image
                    </Button>
                  </div>
                )}
                <p className="text-sm text-gray-500 mt-1">Upload a poster image directly from your device (optional)</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="create-event_date">Event Date</Label>
                  <Input
                    id="create-event_date"
                    name="event_date"
                    type="date"
                    disabled={saving}
                  />
                </div>
                <div>
                  <Label htmlFor="create-start_date">Start Date</Label>
                  <Input
                    id="create-start_date"
                    name="start_date"
                    type="date"
                    disabled={saving}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="create-end_date">End Date</Label>
                <Input
                  id="create-end_date"
                  name="end_date"
                  type="date"
                  disabled={saving}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create"
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="mb-6 space-y-4">
        {/* First Row: Upcoming Filter, Sort By, Sort Order */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="upcoming-filter"
              checked={upcomingFilter}
              onChange={(e) => {
                // CRITICAL: Validate e.target exists and has checked property
                if (e.target && 'checked' in e.target && typeof e.target.checked === 'boolean') {
                  setUpcomingFilter(e.target.checked)
                }
              }}
              className="w-4 h-4"
            />
            <Label htmlFor="upcoming-filter" className="cursor-pointer">
              Show only upcoming events
            </Label>
          </div>
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">Created Date</SelectItem>
              <SelectItem value="updated_at">Updated Date</SelectItem>
              <SelectItem value="start_date">Start Date</SelectItem>
              <SelectItem value="end_date">End Date</SelectItem>
              <SelectItem value="event_date">Event Date</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as typeof sortOrder)}>
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
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Label htmlFor="title-search" className="text-sm font-medium text-gray-700 mb-1 block">
                Search by Title
              </Label>
              <div className="relative">
                <Input
                  id="title-search"
                  placeholder="Search title (contains)..."
                  value={titleFilter}
                  onChange={(e) => {
                    // CRITICAL: Validate e.target exists and has value property
                    if (e.target && 'value' in e.target && typeof e.target.value === 'string') {
                      setTitleFilter(e.target.value)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                    }
                  }}
                  className="w-full pr-8"
                />
                {titleFilter && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 hover:bg-gray-100"
                    onClick={() => setTitleFilter("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex-1">
              <Label htmlFor="event-date-search" className="text-sm font-medium text-gray-700 mb-1 block">
                Search by Event Date
              </Label>
              <Input
                id="event-date-search"
                type="date"
                value={eventDateFilter}
                onChange={(e) => {
                  // CRITICAL: Validate e.target exists and has value property
                  if (e.target && 'value' in e.target && typeof e.target.value === 'string') {
                  setEventDateFilter(e.target.value)
                  setUseDateRange(false)
                  setEventDateFrom("")
                  setEventDateTo("")
                  }
                }}
                className="w-full"
              />
            </div>
          </div>
          {/* Date Range Option */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="use-date-range"
              checked={useDateRange}
              onChange={(e) => {
                // CRITICAL: Validate e.target exists and has checked property
                if (e.target && 'checked' in e.target && typeof e.target.checked === 'boolean') {
                setUseDateRange(e.target.checked)
                if (e.target.checked) {
                  setEventDateFilter("")
                } else {
                  setEventDateFrom("")
                  setEventDateTo("")
                  }
                }
              }}
              className="w-4 h-4"
            />
            <Label htmlFor="use-date-range" className="text-sm text-gray-600 cursor-pointer">
              Use date range instead
            </Label>
          </div>
          {useDateRange && (
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Label htmlFor="event-date-from" className="text-sm font-medium text-gray-700 mb-1 block">
                  Event Date From
                </Label>
                <Input
                  id="event-date-from"
                  type="date"
                  value={eventDateFrom}
                  max={eventDateTo || undefined}
                  onChange={(e) => {
                    // CRITICAL: Validate e.target exists and has value property
                    if (e.target && 'value' in e.target && typeof e.target.value === 'string') {
                      const newFromDate = e.target.value
                      // CRITICAL: Validate date range - from date should not be after to date
                      if (eventDateTo && newFromDate > eventDateTo) {
                        if (isMountedRef.current) {
                          toast.warning("Start date cannot be after end date. Please adjust the date range.")
                        }
                        return
                      }
                      setEventDateFrom(newFromDate)
                    }
                  }}
                  className="w-full"
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="event-date-to" className="text-sm font-medium text-gray-700 mb-1 block">
                  Event Date To
                </Label>
                <Input
                  id="event-date-to"
                  type="date"
                  value={eventDateTo}
                  min={eventDateFrom || undefined}
                  onChange={(e) => {
                    // CRITICAL: Validate e.target exists and has value property
                    if (e.target && 'value' in e.target && typeof e.target.value === 'string') {
                      const newToDate = e.target.value
                      // CRITICAL: Validate date range - to date should not be before from date
                      if (eventDateFrom && newToDate < eventDateFrom) {
                        if (isMountedRef.current) {
                          toast.warning("End date cannot be before start date. Please adjust the date range.")
                        }
                        return
                      }
                      setEventDateTo(newToDate)
                    }
                  }}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </div>
        {(upcomingFilter || debouncedTitleFilter || eventDateFilter || eventDateFrom || eventDateTo) && (
          <div className="flex justify-end mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setUpcomingFilter(false)
                setTitleFilter("")
                setEventDateFilter("")
                setEventDateFrom("")
                setEventDateTo("")
                setUseDateRange(false)
              }}
              className="text-xs"
            >
              <X className="w-3 h-3 mr-1" />
              Clear All Filters
            </Button>
          </div>
        )}
      </div>
      
      {/* Results Count */}
      {!loading && (
        <div className="mb-4 text-sm text-gray-600">
          {typeof total === 'number' && total > 0 && Array.isArray(events) ? (
            <>
              Showing <span className="font-medium">{events.length}</span> of <span className="font-medium">{total}</span> event{total !== 1 ? 's' : ''}
              {(upcomingFilter || debouncedTitleFilter || eventDateFilter || eventDateFrom || eventDateTo) && (
                <span className="ml-2 text-gray-500">(filtered)</span>
              )}
            </>
          ) : (
            <span>No events found</span>
          )}
        </div>
      )}

      {/* Events List - Table View */}
      {!Array.isArray(events) || events.length === 0 ? (
        <div className="text-center py-12">
          <Calendar className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No events found</p>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden lg:block bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">
                      No.
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Event
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Dates
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Poster Image
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      In-Event Photos
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Array.isArray(events) ? events.map((event, index) => {
                    // CRITICAL: Validate event exists before rendering
                    if (!event || typeof event !== 'object') {
                      return null
                    }
                    return (
                    <tr key={event?.id && typeof event.id === 'string' ? event.id : `event-${index}`} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {index + 1}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{event.title || 'Untitled Event'}</div>
                        {event.description && (
                          <div className="text-sm text-gray-500 mt-1 line-clamp-2">
                            {event.description}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 space-y-1">
                          {event.event_date && (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              <span>Event: {formatTimestamp(event.event_date)}</span>
                            </div>
                          )}
                          {event.start_date && (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              <span>Start: {formatTimestamp(event.start_date)}</span>
                            </div>
                          )}
                          {event.end_date && (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              <span>End: {formatTimestamp(event.end_date)}</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {event.image_url ? (
                          <div className="flex items-center gap-2">
                            <img
                              src={event.image_url}
                              alt={event.image_title || event.title}
                              className="h-16 w-16 rounded object-cover"
                            />
                            <span className="text-xs text-gray-500">{event.image_title || "Poster"}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">No poster</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {event.in_event_photos && event.in_event_photos.length > 0 ? (
                            <span className="text-green-600 font-medium">Yes</span>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              try {
                                const eventDetails = await fetchEventDetails(event.id)
                                // Simple fix: Check if component is mounted before state updates
                                if (!isMountedRef.current) return
                                
                                // CRITICAL: Validate that we have valid event data
                                if (!eventDetails && !event) {
                                  if (isMountedRef.current) {
                                  toast.error("Failed to load event details")
                                  }
                                  return
                                }
                                
                                const eventToEdit = eventDetails || event
                                
                                // CRITICAL: Validate eventToEdit has required fields
                                if (!eventToEdit || !eventToEdit.id) {
                                  if (isMountedRef.current) {
                                  toast.error("Invalid event data")
                                  }
                                  return
                                }
                                
                                setEditingEvent(eventToEdit)
                                setEditSelectedImageId(eventToEdit.image_id || null)
                                
                                // Create snapshot for fallback mechanism - includes ALL event data:
                                // - in_event_photos (all photos)
                                // - title, description, dates
                                // - image_id (poster)
                                // - all other fields
                                // CRITICAL: Use try-catch for deep copy (could fail on circular refs or large objects)
                                if (isMountedRef.current) {
                                try {
                                  setEventSnapshot(JSON.parse(JSON.stringify(eventToEdit)))
                                } catch (copyError) {
                                    logError("Failed to create event snapshot", { function: "EventsPage" }, copyError instanceof Error ? copyError : new Error(String(copyError)))
                                  // Fallback: use shallow copy (less safe but better than nothing)
                                    if (isMountedRef.current) {
                                  setEventSnapshot({ ...eventToEdit })
                                    }
                                  }
                                }
                                
                                if (isMountedRef.current) {
                                setSelectedPhotoIds(new Set())
                                setPendingDeletions(new Set())
                                }
                                setEditPosterFile(null)
                                setEditPosterPreview(null)
                                setFormKey(0) // Reset form key
                                setEditDialogOpen(true)
                              } catch (error) {
                                logError("Failed to open edit dialog", { function: "EventsPage" }, error instanceof Error ? error : new Error(String(error)))
                                if (isMountedRef.current) {
                                toast.error("Failed to load event for editing")
                                }
                              }
                            }}
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteClick(event.id)}
                          >
                            <Trash2 className="w-4 h-4 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                    )
                  }).filter(Boolean) : null}
                </tbody>
              </table>
            </div>
            {/* Page size selector and total count */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{Array.isArray(events) ? events.length : 0}</span> of <span className="font-medium">{typeof total === 'number' ? total : 0}</span> events
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">Items per page:</span>
                <Select
                  value={typeof pageSize === 'number' && !isNaN(pageSize) ? pageSize.toString() : '25'}
                  onValueChange={(value) => {
                    // CRITICAL: Validate value is a string before parsing
                    if (!value || typeof value !== 'string') {
                      return
                    }
                    const parsed = parseInt(value, 10)
                    // CRITICAL: Validate parsed value is reasonable (prevent extremely large page sizes)
                    if (!isNaN(parsed) && parsed > 0 && parsed <= 1000) {
                      setPageSize(parsed)
                    fetchEvents()
                    } else if (parsed > 1000) {
                      if (isMountedRef.current) {
                        toast.warning("Page size cannot exceed 1000. Using maximum value.")
                      }
                      setPageSize(1000)
                      fetchEvents()
                    }
                  }}
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
            {typeof hasMore === 'boolean' && hasMore && (
              <div ref={scrollSentinelRef} className="py-4 flex justify-center">
                {loading && <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
              </div>
            )}
            {typeof hasMore === 'boolean' && !hasMore && Array.isArray(events) && events.length > 0 && (
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-center text-sm text-gray-500">
                No more events to load
              </div>
            )}
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden space-y-4">
            {Array.isArray(events) ? events.map((event, index) => {
              // CRITICAL: Validate event exists before rendering
              if (!event || typeof event !== 'object') {
                return null
              }
              return (
              <div
                key={event?.id && typeof event.id === 'string' ? event.id : `event-${index}`}
                className="bg-white rounded-lg shadow-md overflow-hidden"
              >
                {event.image_url && (
                  <div className="aspect-video bg-gray-100 relative">
                    <img
                      src={event.image_url || ''}
                      alt={event.title || "Event poster"}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // CRITICAL: Handle image loading errors gracefully
                        const target = e.currentTarget
                        if (target && target instanceof HTMLImageElement) {
                          target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="%23e5e7eb"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%239ca3af" font-size="12"%3EImage%3C/text%3E%3C/svg%3E'
                          target.alt = "Failed to load image"
                        }
                      }}
                    />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">No. {typeof index === 'number' && index >= 0 ? index + 1 : 1}</span>
                    <h3 className="font-semibold text-gray-900 flex-1">{event.title}</h3>
                  </div>
                  {event.description && (
                    <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                      {event.description}
                    </p>
                  )}
                  <div className="space-y-1 text-sm text-gray-500 mb-4">
                    {event.event_date && (
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>Event: {formatTimestamp(event.event_date)}</span>
                      </div>
                    )}
                    {event.start_date && (
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>Start: {formatTimestamp(event.start_date)}</span>
                      </div>
                    )}
                    {event.end_date && (
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>End: {formatTimestamp(event.end_date)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 mt-2">
                      <ImageIcon className="w-4 h-4" />
                      <span>In-event photos: {Array.isArray(event.in_event_photos) && event.in_event_photos.length > 0 ? (
                        <span className="text-green-600 font-medium">Yes</span>
                      ) : (
                        <span className="text-gray-400">No</span>
                      )}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={async () => {
                        try {
                          const eventDetails = await fetchEventDetails(event.id)
                                // Simple fix: Check if component is mounted before state updates
                                if (!isMountedRef.current) return
                                
                          // CRITICAL: Validate that we have valid event data
                          if (!eventDetails && !event) {
                            if (isMountedRef.current) {
                            toast.error("Failed to load event details")
                            }
                            return
                          }
                          
                          const eventToEdit = eventDetails || event
                          
                          // CRITICAL: Validate eventToEdit has required fields
                          if (!eventToEdit || !eventToEdit.id) {
                            if (isMountedRef.current) {
                            toast.error("Invalid event data")
                            }
                            return
                          }
                          
                          setEditingEvent(eventToEdit)
                          setEditSelectedImageId(eventToEdit.image_id || null)
                          
                          // Create snapshot for fallback mechanism - includes ALL event data:
                          // - in_event_photos (all photos)
                          // - title, description, dates
                          // - image_id (poster)
                          // - all other fields
                          // CRITICAL: Use try-catch for deep copy (could fail on circular refs or large objects)
                          try {
                            setEventSnapshot(JSON.parse(JSON.stringify(eventToEdit)))
                          } catch (copyError) {
                            logError("Failed to create event snapshot", { function: "EventsPage" }, copyError instanceof Error ? copyError : new Error(String(copyError)))
                            // Fallback: use shallow copy (less safe but better than nothing)
                            setEventSnapshot({ ...eventToEdit })
                          }
                          
                          setSelectedPhotoIds(new Set())
                          setPendingDeletions(new Set())
                          setEditPosterFile(null)
                          setEditPosterPreview(null)
                          setFormKey(0) // Reset form key
                          setEditDialogOpen(true)
                        } catch (error) {
                          logError("Failed to open edit dialog", { function: "EventsPage" }, error instanceof Error ? error : new Error(String(error)))
                          if (isMountedRef.current) {
                          toast.error("Failed to load event for editing")
                          }
                        }
                      }}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDeleteClick(event.id)}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
              )
            }).filter(Boolean) : null}
            {/* Page size selector and total count for mobile */}
            <div className="bg-white rounded-lg shadow px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{events.length}</span> of <span className="font-medium">{total}</span>
              </div>
              <Select
                value={typeof pageSize === 'number' && !isNaN(pageSize) && pageSize > 0 ? pageSize.toString() : '25'}
                onValueChange={(value) => {
                  // CRITICAL: Validate value is a string before parsing
                  if (!value || typeof value !== 'string') {
                    return
                  }
                  const parsed = parseInt(value, 10)
                  // CRITICAL: Validate parsed value is reasonable (prevent extremely large page sizes)
                  if (!isNaN(parsed) && parsed > 0 && parsed <= 1000) {
                    setPageSize(parsed)
                  fetchEvents()
                  } else if (parsed > 1000) {
                    if (isMountedRef.current) {
                      toast.warning("Page size cannot exceed 1000. Using maximum value.")
                    }
                    setPageSize(1000)
                    fetchEvents()
                  }
                }}
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
            {typeof hasMore === 'boolean' && hasMore && (
              <div ref={scrollSentinelRef} className="py-4 flex justify-center">
                {loading && <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
              </div>
            )}
            {typeof hasMore === 'boolean' && !hasMore && Array.isArray(events) && events.length > 0 && (
              <div className="bg-white rounded-lg shadow px-4 py-3 text-center text-sm text-gray-500">
                No more events to load
              </div>
            )}
          </div>
        </>
      )}

      {/* Edit Dialog - Streamlined for Dates and Images */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => {
        if (!open && saving) {
          // CRITICAL: If dialog is being closed while saving, abort all ongoing operations
          if (Array.isArray(abortControllersRef.current)) {
            abortControllersRef.current.forEach(controller => {
              try {
                controller.abort()
              } catch (error) {
                logError("Failed to abort controller on dialog close", { function: "onOpenChange" }, error instanceof Error ? error : new Error(String(error)))
              }
            })
            abortControllersRef.current = []
          }
        }
        setEditDialogOpen(open)
      }}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl lg:max-w-3xl max-h-[90vh] overflow-y-auto w-full">
          <DialogHeader>
            <DialogTitle>Edit Event: {editingEvent?.title}</DialogTitle>
            <DialogDescription>
              Update event description, dates, and images
            </DialogDescription>
          </DialogHeader>
          {editingEvent && (
            <form key={formKey} onSubmit={handleUpdate} className="space-y-6">
              {/* Hidden title field to preserve title during updates */}
              <input type="hidden" name="title" value={editingEvent.title} />
              
              {/* Description Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Event Description</h3>
                <div>
                  <Label htmlFor="edit-description">Description</Label>
                  <Textarea
                    id="edit-description"
                    name="description"
                    rows={4}
                    maxLength={10000}
                    defaultValue={editingEvent.description || ""}
                    disabled={saving}
                    placeholder="Enter event description..."
                    aria-describedby="edit-description-help"
                  />
                  <p id="edit-description-help" className="text-sm text-gray-500 mt-1">Maximum 10,000 characters</p>
                </div>
              </div>

              {/* Dates Section */}
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-lg font-semibold text-gray-900">Event Dates</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="edit-event_date">Event Date</Label>
                    <Input
                      id="edit-event_date"
                      name="event_date"
                      type="date"
                      defaultValue={editingEvent.event_date ? (() => {
                        const formatted = formatTimestamp(editingEvent.event_date)
                        return typeof formatted === 'string' && formatted.length > 0 ? formatted : ''
                      })() : ''}
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-start_date">Start Date</Label>
                    <Input
                      id="edit-start_date"
                      name="start_date"
                      type="date"
                      defaultValue={editingEvent.start_date ? (() => {
                        const formatted = formatTimestamp(editingEvent.start_date)
                        return typeof formatted === 'string' && formatted.length > 0 ? formatted : ''
                      })() : ''}
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-end_date">End Date</Label>
                    <Input
                      id="edit-end_date"
                      name="end_date"
                      type="date"
                      defaultValue={editingEvent.end_date ? (() => {
                        const formatted = formatTimestamp(editingEvent.end_date)
                        return typeof formatted === 'string' && formatted.length > 0 ? formatted : ''
                      })() : ''}
                      disabled={saving}
                    />
                  </div>
                </div>
              </div>

              {/* Poster Image Section */}
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-lg font-semibold text-gray-900">Poster Image (Hero Image)</h3>
                <div>
                  <Label htmlFor="edit-poster">Upload New Poster Image (from device)</Label>
                  <Input
                    id="edit-poster"
                    name="poster"
                    type="file"
                    accept="image/*"
                    disabled={saving}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null
                      // CRITICAL: Validate file type
                      if (file) {
                        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
                        if (!file.type || typeof file.type !== 'string' || !validTypes.includes(file.type)) {
                          if (isMountedRef.current) {
                            toast.error("Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.")
                          }
                          // Reset file input
                          const input = e.target as HTMLInputElement
                          if (input) {
                            input.value = ''
                          }
                          setEditPosterFile(null)
                          setEditPosterPreview(null)
                          return
                        }
                      }
                      
                      // CRITICAL: Cleanup previous preview blob URL before setting new file
                      // This prevents memory leaks when user selects a new file
                      if (editPosterPreview && typeof editPosterPreview === 'string' && editPosterPreview.startsWith('blob:')) {
                        try {
                          URL.revokeObjectURL(editPosterPreview)
                        } catch (error) {
                          // Ignore errors during cleanup
                        }
                      }
                      setEditPosterFile(file)
                      if (file) {
                        const reader = new FileReader()
                        // CRITICAL: Validate fileReadersRef.current is an array before using push
                        if (Array.isArray(fileReadersRef.current)) {
                          fileReadersRef.current.push(reader)
                        }
                        reader.onloadend = () => {
                          // CRITICAL: Check if component is still mounted before updating state
                          if (isMountedRef.current && reader.result && typeof reader.result === 'string') {
                            setEditPosterPreview(reader.result)
                          }
                          // Remove from tracking array
                          fileReadersRef.current = fileReadersRef.current.filter(r => r !== reader)
                        }
                        reader.onerror = () => {
                          // Simple fix: Handle FileReader errors
                          // CRITICAL: Validate reader exists before accessing properties
                          if (!reader) return
                          const fileName = file?.name || 'unknown file'
                          logError("Failed to read edit poster file", { function: "handleUpdate", fileName })
                          if (isMountedRef.current) {
                            toast.error("Failed to read poster image. Please try again.")
                            setEditPosterFile(null)
                            setEditPosterPreview(null)
                          }
                          // Remove from tracking array
                          fileReadersRef.current = fileReadersRef.current.filter(r => r !== reader)
                        }
                        reader.readAsDataURL(file)
                      } else {
                        setEditPosterPreview(null)
                      }
                    }}
                  />
                  {editPosterPreview && (
                    <div className="mt-2">
                      <Label>New Poster Preview</Label>
                      <img
                        src={editPosterPreview}
                        alt="New poster preview"
                        className="h-32 w-auto rounded object-cover border border-gray-200 mt-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-2"
                        onClick={() => {
                          setEditPosterFile(null)
                          setEditPosterPreview(null)
                          // CRITICAL: Validate document.getElementById result before using
                          const input = document.getElementById("edit-poster") as HTMLInputElement | null
                          if (input) {
                            input.value = ""
                          }
                        }}
                        disabled={saving}
                      >
                        Remove new image
                      </Button>
                    </div>
                  )}
                  {editingEvent.image_url && !editPosterPreview && (
                    <div className="mt-2">
                      <Label>Current Poster</Label>
                      <div className="mt-1">
                        <img
                          src={editingEvent.image_url}
                          alt={editingEvent.image_title || editingEvent.title}
                          className="h-32 w-auto rounded object-cover border border-gray-200"
                        />
                      </div>
                    </div>
                  )}
                  <p className="text-sm text-gray-500 mt-1">Upload a new poster image to replace the current one (optional)</p>
                </div>
              </div>

              {/* In-Event Photos Section */}
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">In-Event Photos</h3>
                  <div className="flex items-center gap-2">
                    {selectedPhotoIds instanceof Set && selectedPhotoIds.size > 0 && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={handleMarkForDeletion}
                          disabled={saving}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Delete Selected ({selectedPhotoIds.size})
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedPhotoIds(new Set())}
                          disabled={saving}
                        >
                          Clear Selection
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAddingPhoto(true)}
                      disabled={saving}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Photo
                    </Button>
                  </div>
                </div>
                {pendingDeletions instanceof Set && pendingDeletions.size > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                    <strong>{pendingDeletions.size}</strong> photo{pendingDeletions.size !== 1 ? 's' : ''} marked for deletion. Click "Save Changes" to confirm.
                  </div>
                )}
                {Array.isArray(editingEvent.in_event_photos) && editingEvent.in_event_photos.filter(p => p?.id && !pendingDeletions.has(p.id)).length > 0 ? (
                  <>
                    {/* Selection controls */}
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <button
                        type="button"
                        onClick={() => {
                          // CRITICAL: Validate in_event_photos is an array before using filter
                          const availablePhotos = Array.isArray(editingEvent.in_event_photos) 
                            ? editingEvent.in_event_photos.filter(p => p?.id && !pendingDeletions.has(p.id))
                            : []
                          const allSelected = selectedPhotoIds instanceof Set && selectedPhotoIds.size === availablePhotos.length && availablePhotos.length > 0
                          handleSelectAll(!allSelected)
                        }}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        disabled={saving}
                      >
                        {Array.isArray(editingEvent.in_event_photos) && editingEvent.in_event_photos.filter(p => p?.id && !pendingDeletions.has(p.id)).length > 0 && selectedPhotoIds instanceof Set && selectedPhotoIds.size === editingEvent.in_event_photos.filter(p => p?.id && !pendingDeletions.has(p.id)).length ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                        <span>Select All</span>
                      </button>
                      {selectedPhotoIds instanceof Set && selectedPhotoIds.size > 0 && (
                        <span className="text-sm text-gray-600">
                          {selectedPhotoIds.size} selected
                        </span>
                      )}
                    </div>
                    <DndContext
                      sensors={stableSensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        // Use memoized items array to ensure SortableContext detects changes immediately
                        // This prevents the need for multiple drag operations to see UI updates
                        items={sortableItems}
                        strategy={rectSortingStrategy}
                      >
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                          {Array.isArray(editingEvent.in_event_photos) 
                            ? editingEvent.in_event_photos
                                .filter(p => p?.id && typeof p.id === 'string' && !pendingDeletions.has(p.id))
                                .map((photo, photoIndex) => (
                              <SortablePhotoItem
                                    key={photo?.id && typeof photo.id === 'string' ? photo.id : `photo-${photoIndex}`}
                                photo={photo}
                                eventId={editingEvent.id}
                                onRemove={handleRemovePhoto}
                                saving={saving}
                                removing={removingPhoto === photo.id}
                                isSelected={selectedPhotoIds.has(photo.id) && !pendingDeletions.has(photo.id)}
                                onSelect={(photoId, selected) => {
                                  // Defensive check: prevent selecting photos marked for deletion
                                  // (They're already filtered from display, but this is extra safety)
                                  if (selected && pendingDeletions.has(photoId)) {
                                    toast.info("This photo is marked for deletion and cannot be selected.")
                                    return
                                  }
                                  handleSelectPhoto(photoId, selected)
                                }}
                                showCheckbox={true}
                              />
                                ))
                            : null}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-500 text-sm border border-dashed border-gray-300 rounded-lg">
                    {pendingDeletions instanceof Set && pendingDeletions.size > 0 
                      ? "All photos marked for deletion. Click 'Save Changes' to confirm."
                      : "No in-event photos. Click 'Add Photo' to add photos."}
                  </div>
                )}
              </div>

              {/* Pending Changes Summary */}
              {(pendingDeletions instanceof Set && pendingDeletions.size > 0 || editPosterFile) && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                  <div className="font-semibold text-blue-900 mb-1">Pending Changes:</div>
                  <ul className="list-disc list-inside text-blue-800 space-y-1">
                    {pendingDeletions instanceof Set && pendingDeletions.size > 0 && (
                      <li>{pendingDeletions.size} photo{pendingDeletions.size !== 1 ? 's' : ''} marked for deletion</li>
                    )}
                    {editPosterFile && (
                      <li>New poster image selected</li>
                    )}
                  </ul>
                  <div className="text-xs text-blue-600 mt-2">
                    Click "Save Changes" to apply these changes. Click "Cancel" to discard.
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    // Restore from snapshot if available to discard all changes
                    if (eventSnapshot) {
                      setEditingEvent(eventSnapshot)
                      setPendingDeletions(new Set())
                      setSelectedPhotoIds(new Set())
                      setEditPosterFile(null)
                      setEditPosterPreview(null)
                      // Force form remount to restore form field values
                      setFormKey(prev => {
                        // CRITICAL: Validate prev is a number before arithmetic
                        const safePrev = typeof prev === 'number' && !isNaN(prev) ? prev : 0
                        return safePrev + 1
                      })
                    }
                    // Close dialog and clear all state
                    setEditDialogOpen(false)
                    setEditingEvent(null)
                    setEditPosterFile(null)
                    setEditPosterPreview(null)
                    setEditSelectedImageId(null)
                    setEventSnapshot(null)
                    setSelectedPhotoIds(new Set())
                    setPendingDeletions(new Set())
                    setFormKey(0) // Reset form key for next open
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={saving}
                  className={hasPendingChanges ? "bg-blue-600 hover:bg-blue-700" : ""}
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      {pendingDeletions instanceof Set && pendingDeletions.size > 0 || editPosterFile ? (
                        <>
                          Save Changes
                          {(pendingDeletions instanceof Set && pendingDeletions.size > 0 || editPosterFile) && (
                            <span className="ml-2 bg-white/20 px-2 py-0.5 rounded text-xs">
                              {[
                                pendingDeletions instanceof Set && pendingDeletions.size > 0 ? `${pendingDeletions.size} deletion${pendingDeletions.size !== 1 ? 's' : ''}` : null,
                                editPosterFile ? 'poster' : null
                              ].filter((item): item is string => typeof item === 'string' && item.length > 0).join(', ')}
                            </span>
                          )}
                        </>
                      ) : (
                        "Save Changes"
                      )}
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Photo Dialog */}
      <Dialog open={addingPhoto} onOpenChange={(open) => {
        setAddingPhoto(open)
        if (!open) {
          // Cleanup all preview blob URLs before clearing state
          if (Array.isArray(inEventPhotoPreviews)) {
            inEventPhotoPreviews.forEach(preview => {
              // Data URLs from FileReader don't need cleanup, but blob URLs do
              if (preview?.preview && preview.preview.startsWith('blob:')) {
                URL.revokeObjectURL(preview.preview)
                // CRITICAL: Validate previewBlobUrlsRef.current is a Set before using delete
                if (previewBlobUrlsRef.current instanceof Set) {
                  previewBlobUrlsRef.current.delete(preview.preview)
                }
              }
            })
          }
          setInEventPhotoFiles([])
          setInEventPhotoPreviews([])
          setUploadProgress({ uploaded: 0, total: 0 })
          setUnifiedPhotoList([])
          // Clear the ref
          previewBlobUrlsRef.current.clear()
        }
      }}>
        <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage In-Event Photos</DialogTitle>
            <DialogDescription>
              Select and reorder photos. Drag to reorder, check to select. New photos will be uploaded when you save.
            </DialogDescription>
          </DialogHeader>
          {editingEvent && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="in-event-photos">Add New Images (Multiple files supported)</Label>
                <Input
                  id="in-event-photos"
                  name="in-event-photos"
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploadingPhotos}
                  onChange={(e) => {
                    // CRITICAL: Validate e.target exists and files is a FileList before using Array.from
                    if (!e || !e.target) {
                      logError("Invalid event target in file input onChange", { function: "handleBulkUploadPhotos" })
                      return
                    }
                    const fileList = e.target.files
                    // CRITICAL: Preserve FileList order (user selection order) by using Array.from
                    // FileList maintains the order files were selected by the user
                    const files = fileList && fileList instanceof FileList ? Array.from(fileList) : []
                    
                    // CRITICAL: Validate file types before processing
                    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
                    const invalidFiles: string[] = []
                    
                    files.forEach(file => {
                      if (!file.type || typeof file.type !== 'string' || !validTypes.includes(file.type)) {
                        invalidFiles.push(file.name || 'unknown file')
                      }
                    })
                    
                    if (invalidFiles.length > 0) {
                      if (isMountedRef.current) {
                        toast.error(`${invalidFiles.length} file${invalidFiles.length !== 1 ? 's' : ''} ${invalidFiles.length !== 1 ? 'have' : 'has'} invalid type. Please upload JPEG, PNG, WebP, or GIF images.`)
                      }
                      // Reset file input
                      const input = e.target as HTMLInputElement
                      if (input) {
                        input.value = ''
                      }
                      setInEventPhotoFiles([])
                      setInEventPhotoPreviews([])
                      return
                    }
                    
                    setInEventPhotoFiles(files)
                    
                    if (files.length === 0) {
                      // Cleanup existing preview blob URLs
                      if (Array.isArray(inEventPhotoPreviews)) {
                        inEventPhotoPreviews.forEach(preview => {
                          if (preview?.preview) {
                            if (preview.preview.startsWith('data:')) {
                              // Data URLs don't need cleanup, but track them anyway
                              // CRITICAL: Validate previewBlobUrlsRef.current is a Set before using delete
                              if (previewBlobUrlsRef.current instanceof Set) {
                                previewBlobUrlsRef.current.delete(preview.preview)
                              }
                            } else if (preview.preview.startsWith('blob:')) {
                              URL.revokeObjectURL(preview.preview)
                              // CRITICAL: Validate previewBlobUrlsRef.current is a Set before using delete
                              if (previewBlobUrlsRef.current instanceof Set) {
                                previewBlobUrlsRef.current.delete(preview.preview)
                              }
                            }
                          }
                        })
                      }
                      setInEventPhotoPreviews([])
                      return
                    }
                    
                    // Cleanup old previews that are no longer in the new file list
                    const incomingFileIds = new Set(files.map(f => generatePreviewId(f)))
                    if (Array.isArray(inEventPhotoPreviews)) {
                      inEventPhotoPreviews.forEach(preview => {
                        if (preview?.previewId && !incomingFileIds.has(preview.previewId)) {
                          // This preview is being removed, clean up its blob URL
                          if (preview.preview.startsWith('blob:')) {
                            URL.revokeObjectURL(preview.preview)
                            // CRITICAL: Validate previewBlobUrlsRef.current is a Set before using delete
                            if (previewBlobUrlsRef.current instanceof Set) {
                              previewBlobUrlsRef.current.delete(preview.preview)
                            }
                          }
                        }
                      })
                    }
                    
                    // Create previews asynchronously with stable IDs
                    // First, collect all existing preview IDs to detect duplicates
                    // CRITICAL: Validate filter(Boolean) results to ensure only valid string IDs are included
                    // CRITICAL: Validate filter(Boolean) results and ensure array is not empty before operations
                    const filteredPreviewIds = Array.isArray(inEventPhotoPreviews) 
                      ? inEventPhotoPreviews
                          .map(p => p?.previewId)
                          .filter((id): id is string => typeof id === 'string' && id.length > 0)
                      : []
                    // CRITICAL: Validate array is not empty before creating Set (though empty Set is valid)
                    const existingPreviewIds = new Set(filteredPreviewIds)
                    const newFileIds = new Set<string>()
                    
                    // CRITICAL: Track original selection index to preserve user's file selection order
                    // FileList order represents the order files were selected by the user
                    const previewPromises = files.map((file, originalSelectionIndex) => {
                      return new Promise<{ file: File; preview: string; previewId: string; originalSelectionIndex: number }>((resolve, reject) => {
                        // Generate preview ID, checking against both existing and new files
                        // CRITICAL: Validate Sets exist before spreading
                        const existingIdsArray = existingPreviewIds instanceof Set ? Array.from(existingPreviewIds) : []
                        const newIdsArray = newFileIds instanceof Set ? Array.from(newFileIds) : []
                        const allIds = new Set([...existingIdsArray, ...newIdsArray])
                        const previewId = generatePreviewId(file, allIds)
                        // CRITICAL: Validate newFileIds is a Set before using add
                        if (newFileIds instanceof Set) {
                          newFileIds.add(previewId) // Track this ID for subsequent files
                        }
                        
                        const reader = new FileReader()
                        // CRITICAL: Validate fileReadersRef.current is an array before using push
                        if (Array.isArray(fileReadersRef.current)) {
                          fileReadersRef.current.push(reader)
                        }
                        reader.onloadend = () => {
                          // CRITICAL: Check if component is still mounted before resolving
                          if (!isMountedRef.current) {
                            // Component unmounted, don't resolve (prevents state updates)
                            fileReadersRef.current = fileReadersRef.current.filter(r => r !== reader)
                            return
                          }
                          // CRITICAL: Validate reader.result before using it
                          if (!reader.result || typeof reader.result !== 'string') {
                            fileReadersRef.current = fileReadersRef.current.filter(r => r !== reader)
                            reject(new Error(`Failed to read file: ${file?.name || 'unknown file'}`))
                            return
                          }
                          const preview = reader.result
                          // Track data URLs (they don't need cleanup but track for consistency)
                          // CRITICAL: Validate previewBlobUrlsRef.current is a Set before using add
                          if (previewBlobUrlsRef.current instanceof Set) {
                            previewBlobUrlsRef.current.add(preview)
                          }
                          // Remove from tracking array
                          fileReadersRef.current = fileReadersRef.current.filter(r => r !== reader)
                          // CRITICAL: Include originalSelectionIndex to preserve user's selection order
                          resolve({ file, preview, previewId, originalSelectionIndex })
                        }
                        reader.onerror = () => {
                          // Simple fix: Handle FileReader errors
                          // CRITICAL: Validate reader exists before accessing properties
                          if (!reader) {
                            reject(new Error(`Failed to read file: ${file?.name || 'unknown file'}`))
                            return
                          }
                          const fileName = file?.name || 'unknown file'
                          logError("Failed to read file", { function: "handleBulkUploadPhotos", fileName })
                          // Remove from tracking array
                          fileReadersRef.current = fileReadersRef.current.filter(r => r !== reader)
                          // Reject the promise to properly handle error in Promise.all
                          reject(new Error(`Failed to read file: ${fileName}`))
                        }
                        reader.readAsDataURL(file)
                      })
                    })
                    
                    Promise.all(previewPromises)
                      .then((previews) => {
                        // CRITICAL: Validate previews is an array before using filter
                        if (!Array.isArray(previews)) {
                          logError("Promise.all returned invalid previews", { function: "handleBulkUploadPhotos", previews })
                          if (isMountedRef.current) {
                            toast.error("Failed to load image previews")
                          }
                          return
                        }
                        // CRITICAL: Filter out any failed previews (empty previews indicate errors)
                        const validPreviews = previews.filter(p => p && p.preview && p.preview.length > 0)
                        // CRITICAL: Sort by originalSelectionIndex to preserve user's file selection order
                        // Promise.all preserves array order, but we explicitly sort by originalSelectionIndex
                        // to ensure order is maintained even if some previews fail
                        const sortedPreviews = validPreviews.sort((a, b) => {
                          const indexA = typeof a.originalSelectionIndex === 'number' ? a.originalSelectionIndex : Infinity
                          const indexB = typeof b.originalSelectionIndex === 'number' ? b.originalSelectionIndex : Infinity
                          return indexA - indexB
                        })
                        if (isMountedRef.current) {
                          if (validPreviews.length < previews.length) {
                            // Some files failed to load
                            const failedCount = previews.length - validPreviews.length
                            toast.warning(`${failedCount} image${failedCount !== 1 ? 's' : ''} failed to load. Only ${validPreviews.length} image${validPreviews.length !== 1 ? 's' : ''} will be added.`)
                          }
                          setInEventPhotoPreviews(sortedPreviews)
                        }
                      })
                      .catch((error) => {
                        logError("Failed to create previews", { function: "handleBulkUploadPhotos" }, error instanceof Error ? error : new Error(String(error)))
                        if (isMountedRef.current) {
                          toast.error("Failed to create image previews. Please try again.")
                        }
                    })
                  }}
                />
                <p className="text-sm text-gray-500 mt-1">
                  Select images to add. They will appear below with existing photos. You can reorder and select which ones to include.
                </p>
              </div>

              {uploadingPhotos && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Uploading photos...</span>
                    <span>{typeof uploadProgress.uploaded === 'number' ? uploadProgress.uploaded : 0} / {typeof uploadProgress.total === 'number' ? uploadProgress.total : 0}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress.total > 0 && typeof uploadProgress.uploaded === 'number' && typeof uploadProgress.total === 'number' ? (uploadProgress.uploaded / uploadProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Unified photo list with drag-and-drop */}
              {Array.isArray(unifiedPhotoList) && unifiedPhotoList.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>
                      Photos ({Array.isArray(unifiedPhotoList) ? unifiedPhotoList.filter(p => p && typeof p.isSelected === 'boolean' && p.isSelected).length : 0} selected / {Array.isArray(unifiedPhotoList) ? unifiedPhotoList.length : 0} total)
                    </Label>
                    <div className="flex items-center gap-2">
                      <button
                          type="button"
                          onClick={() => {
                          // CRITICAL: Validate unifiedPhotoList is an array before using every
                          const allSelected = Array.isArray(unifiedPhotoList) && unifiedPhotoList.length > 0
                            ? unifiedPhotoList.every(p => p && typeof p.isSelected === 'boolean' && p.isSelected)
                            : false
                          setUnifiedPhotoList(prev => {
                            // CRITICAL: Validate prev is an array before using map
                            if (!Array.isArray(prev)) return prev
                            return prev.map(item => ({
                              ...item,
                              isSelected: !allSelected
                            }))
                          })
                        }}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                          disabled={uploadingPhotos}
                        >
                        {Array.isArray(unifiedPhotoList) && unifiedPhotoList.length > 0 && unifiedPhotoList.every(p => p && typeof p.isSelected === 'boolean' && p.isSelected) ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                        <span>Select All</span>
                      </button>
                        </div>
                      </div>
                  {uploadingPhotos && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 text-sm text-yellow-800">
                      Upload in progress. Drag and drop is disabled to prevent order conflicts.
                    </div>
                  )}
                  <DndContext
                    sensors={stableSensors} // Always use stable sensors array
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => {
                      // Prevent drag during upload
                      if (uploadingPhotos) return
                      
                      const { active, over } = e
                      // Simple validation: Check active and over have valid IDs
                      if (!over || !active?.id || !over?.id || active.id === over.id) return
                      
                      // CRITICAL: Validate unifiedPhotoList is an array before using findIndex
                      if (!Array.isArray(unifiedPhotoList) || unifiedPhotoList.length === 0) {
                        logError("Invalid unifiedPhotoList for findIndex", { function: "handleBulkUploadPhotos", unifiedPhotoList })
                        return
                      }
                      const oldIndex = unifiedPhotoList.findIndex(item => item?.id === active.id)
                      const newIndex = unifiedPhotoList.findIndex(item => item?.id === over.id)
                      
                      // Simple validation: Check indices are valid before arrayMove
                      // CRITICAL: Validate indices are within bounds
                      if (oldIndex !== -1 && newIndex !== -1 && 
                          oldIndex >= 0 && oldIndex < unifiedPhotoList.length &&
                          newIndex >= 0 && newIndex < unifiedPhotoList.length) {
                        setUnifiedPhotoList(arrayMove(unifiedPhotoList, oldIndex, newIndex))
                      }
                    }}
                  >
                    <SortableContext
                      items={unifiedPhotoList
                        .filter(item => item?.id && typeof item.id === 'string')
                        .map(item => item.id)}
                      strategy={rectSortingStrategy}
                      disabled={uploadingPhotos} // Disable sortable context during upload
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 max-h-[500px] overflow-y-auto border border-gray-200 rounded-lg p-4">
                        {unifiedPhotoList.map((item, itemIndex) => (
                          <SortableUnifiedPhotoItem
                            key={item?.id && typeof item.id === 'string' ? item.id : `item-${itemIndex}`}
                            item={item}
                            disabled={uploadingPhotos}
                            onToggleSelect={(id, selected) => {
                              if (uploadingPhotos) return // Prevent selection changes during upload
                              setUnifiedPhotoList(prev => {
                                // CRITICAL: Validate prev is an array before using map
                                if (!Array.isArray(prev)) return prev
                                return prev.map(p => 
                                  p?.id === id ? { ...p, isSelected: selected } : p
                                )
                              })
                            }}
                          />
                    ))}
                  </div>
                    </SortableContext>
                  </DndContext>
                  <div className="text-xs text-gray-500 flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-green-400 border-2 border-green-500 rounded"></div>
                      Existing
                    </span>
                    <span className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-orange-400 border-2 border-orange-500 rounded"></div>
                      New
                    </span>
                    <span>Drag to reorder • Check to select</span>
                  </div>
                </div>
              )}

              {unifiedPhotoList.length === 0 && !uploadingPhotos && (
                <div className="text-center py-8 text-gray-500 text-sm border border-dashed border-gray-300 rounded-lg">
                  No photos yet. Select images above to add them.
                </div>
              )}

              <div className="flex justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAddingPhoto(false)
                    setInEventPhotoFiles([])
                    setInEventPhotoPreviews([])
                    setUploadProgress({ uploaded: 0, total: 0 })
                    setUnifiedPhotoList([])
                  }}
                  disabled={uploadingPhotos}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (editingEvent?.id) {
                      handleBulkUploadPhotos(editingEvent.id)
                    } else {
                      toast.error("Event ID is missing. Please refresh and try again.")
                    }
                  }}
                  disabled={uploadingPhotos || !editingEvent?.id || (Array.isArray(unifiedPhotoList) ? unifiedPhotoList.filter(p => p?.isSelected && !p?.isExisting).length : 0) === 0}
                >
                  {uploadingPhotos ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-1" />
                      Save ({Array.isArray(unifiedPhotoList) ? unifiedPhotoList.filter(p => p && typeof p.isSelected === 'boolean' && p.isSelected && typeof p.isExisting === 'boolean' && !p.isExisting).length : 0} new, {Array.isArray(unifiedPhotoList) ? unifiedPhotoList.filter(p => p && typeof p.isSelected === 'boolean' && p.isSelected && typeof p.isExisting === 'boolean' && p.isExisting).length : 0} existing)
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <GenericDeleteConfirmationDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm(null)
        }}
        title="Delete Event"
        description="Are you sure you want to delete this event? This action cannot be undone."
        itemName={deleteConfirm ? (() => {
          // CRITICAL: Validate events is an array before using find
          if (!Array.isArray(events)) {
            logError("events is not an array in itemName", { function: "itemName", events })
            return `Event ID: ${deleteConfirm}`
          }
          const event = events.find(e => e?.id === deleteConfirm)
          return event && typeof event.title === 'string' ? event.title : `Event ID: ${deleteConfirm}`
        })() : undefined}
        itemDetails={deleteConfirm ? (() => {
          // CRITICAL: Validate events is an array before using find
          if (!Array.isArray(events)) {
            logError("events is not an array in itemDetails", { function: "itemDetails", events })
            return undefined
          }
          const event = events.find(e => e?.id === deleteConfirm)
          return event ? (
            <div className="space-y-1 text-xs">
              {event.description && (
                <div>
                  <span className="font-medium">Description:</span> {event.description && typeof event.description === 'string' ? (event.description.length > 100 ? event.description.substring(0, 100) + "..." : event.description) : "No description"}
                </div>
              )}
              {event.start_date && (
                <div>
                  <span className="font-medium">Start Date:</span> {formatTimestamp(event.start_date, "MMM dd, yyyy")}
                </div>
              )}
              {event.end_date && (
                <div>
                  <span className="font-medium">End Date:</span> {formatTimestamp(event.end_date, "MMM dd, yyyy")}
                </div>
              )}
            </div>
          ) : undefined
        })() : undefined}
        warningMessage="This event will be permanently deleted from the database. All associated images and data will be removed. This action cannot be undone."
        onConfirm={() => {
          if (deleteConfirm) {
            handleDelete(deleteConfirm)
          }
        }}
        onCancel={() => setDeleteConfirm(null)}
        isLoading={deleting}
        confirmButtonText="Delete Event"
      />
    </div>
  )
}



