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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: photo.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const isPendingDeletion = false // Will be managed by parent

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <div className={`aspect-square bg-gray-100 rounded overflow-hidden border-2 transition-colors ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-300' : 
        isPendingDeletion ? 'border-red-300 opacity-50' :
        'border-transparent hover:border-blue-300'
      }`}>
        <img
          src={photo.blob_url}
          alt={photo.title || "Event photo"}
          className="w-full h-full object-cover"
        />
        {/* Checkbox - show when selection mode is active */}
        {showCheckbox && onSelect && !saving && !removing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelect(photo.id, !isSelected)
            }}
            className="absolute top-2 left-2 bg-white/90 hover:bg-white border-2 border-gray-300 rounded p-1 opacity-100 transition-opacity z-10"
            aria-label={isSelected ? "Deselect photo" : "Select photo"}
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-blue-600" />
            ) : (
              <Square className="w-4 h-4 text-gray-400" />
            )}
          </button>
        )}
        {/* Drag handle - only show when not saving/removing and not in selection mode */}
        {!saving && !removing && !showCheckbox && (
          <div
            {...attributes}
            {...listeners}
            className="absolute top-2 left-2 bg-black/50 hover:bg-black/70 text-white p-1 rounded cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
      </div>
      {/* Single delete button - only show when not in selection mode */}
      {!showCheckbox && (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onRemove(eventId, photo.id)}
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
      abortControllersRef.current.forEach(controller => {
        try {
          controller.abort()
        } catch (error) {
          // Ignore errors during cleanup
        }
      })
      abortControllersRef.current = []
    }
  }, [])
  
  // Warn user before leaving page with unsaved changes
  // CRITICAL: Check for form field changes by comparing with snapshot
  useEffect(() => {
    if (!editDialogOpen || !editingEvent) return
    
    // Check if there are any unsaved changes:
    // 1. Pending deletions
    // 2. New poster file
    // 3. Form field changes (by comparing with snapshot)
    const hasPendingDeletions = pendingDeletions.size > 0
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
      e.preventDefault()
      e.returnValue = '' // Empty string triggers default browser message
      return e.returnValue
    }
    
    // Note: popstate is harder to intercept reliably across browsers
    // We rely on beforeunload for most cases
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [editDialogOpen, editingEvent, pendingDeletions.size, editPosterFile, eventSnapshot])
  
  // Cleanup object URLs for preview images to prevent memory leaks
  useEffect(() => {
    return () => {
      // Cleanup poster preview
      if (editPosterPreview && editPosterPreview.startsWith('blob:')) {
        URL.revokeObjectURL(editPosterPreview)
      }
      // Cleanup in-event photo previews
      // Note: These are handled in the upload component, but add safety here
    }
  }, [editPosterPreview])
  
  // Initialize drag and drop sensors - must be called at top level (hooks rule)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const [inEventPhotoFiles, setInEventPhotoFiles] = useState<File[]>([])
  const [inEventPhotoPreviews, setInEventPhotoPreviews] = useState<Array<{ file: File; preview: string }>>([])
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number }>({ uploaded: 0, total: 0 })
  const createFormRef = React.useRef<HTMLFormElement>(null)
  const [titleFilter, setTitleFilter] = useState("")
  const [debouncedTitleFilter, setDebouncedTitleFilter] = useState("")
  const [upcomingFilter, setUpcomingFilter] = useState(false)
  
  // Debounce title search input (500ms delay)
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTitleFilter(titleFilter)
    }, 500)
    return () => clearTimeout(timer)
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
    if (debouncedTitleFilter) {
      params.append("title", debouncedTitleFilter)
    }
    if (useDateRange) {
      if (eventDateFrom) {
        params.append("eventDateFrom", eventDateFrom)
      }
      if (eventDateTo) {
        params.append("eventDateTo", eventDateTo)
      }
    } else if (eventDateFilter) {
      params.append("eventDate", eventDateFilter)
    }
    params.append("sortBy", sortBy)
    params.append("sortOrder", sortOrder)
    return buildApiUrl(API_PATHS.adminEvents, Object.fromEntries(params))
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
      return Array.isArray(json.data?.events) 
        ? json.data.events 
        : Array.isArray(json.events) 
          ? json.events 
          : []
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
    try {
      const response = await fetch(API_PATHS.adminEvent(eventId), {
        signal, // Support abort signal for cancellation
      })
      
      // CRITICAL: Check if response is OK before parsing
      if (!response.ok) {
        console.error("Failed to fetch event details:", response.status, response.statusText)
        return null
      }
      
      // CRITICAL: Handle JSON parsing errors
      let json: any
      try {
        json = await response.json()
      } catch (parseError) {
        console.error("Failed to parse event details JSON:", parseError)
        return null
      }
      
      if (json.success) {
        // API returns { success: true, data: { event: {...} } }
        return json.data?.event || json.event || null
      }
    } catch (error) {
      // CRITICAL: Don't log AbortError (expected when cancelled)
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error("Failed to fetch event details", error)
      }
    }
    return null
  }

  // Handle bulk upload of in-event photos
  const handleBulkUploadPhotos = async (eventId: string) => {
    if (inEventPhotoFiles.length === 0) {
      toast.error("Please select at least one image")
      return
    }

    setUploadingPhotos(true)
    setUploadProgress({ uploaded: 0, total: inEventPhotoFiles.length })

    const uploadedImageIds: string[] = []
    const errors: string[] = []

    try {
      // Step 1: Process images on client-side (resize, normalize, strip EXIF)
      const { processMultipleImages } = await import("@/lib/client-image-processor")
      toast.info("Processing images...")
      
      // Get processing settings from environment variables (with defaults)
      const maxWidth = parseInt(process.env.NEXT_PUBLIC_MAX_IMAGE_WIDTH || '1920', 10)
      const maxHeight = parseInt(process.env.NEXT_PUBLIC_MAX_IMAGE_HEIGHT || '1920', 10)
      const quality = parseFloat(process.env.NEXT_PUBLIC_IMAGE_QUALITY || '0.85')
      const format = (process.env.NEXT_PUBLIC_IMAGE_FORMAT || 'webp') as 'webp' | 'jpeg' | 'png'
      
      const processedImages = await processMultipleImages(
        inEventPhotoFiles,
        {
          maxWidth,
          maxHeight,
          quality,
          format,
        },
        (processed, total) => {
          // Update progress during processing
          setUploadProgress({ uploaded: 0, total }) // Reset for upload phase
        }
      )

      toast.success(`Processed ${processedImages.length} image${processedImages.length !== 1 ? 's' : ''}, uploading...`)
      setUploadProgress({ uploaded: 0, total: processedImages.length })

      // Step 2: Upload processed images with intelligent batch splitting
      const { splitIntoBatches, uploadBatch, uploadSingle } = await import("@/lib/batch-upload-helper")
      
      if (processedImages.length === 1) {
        // Single file upload
        const processed = processedImages[0]
        try {
          const result = await uploadSingle(processed, API_PATHS.adminImages, {
            title: editingEvent?.title ? `${editingEvent.title} - Photo 1` : `Event Photo 1`,
            eventInfo: editingEvent?.description || null,
          })
          
          if (result.success && result.image?.id) {
            uploadedImageIds.push(result.image.id)
            setUploadProgress({ uploaded: 1, total: 1 })
          } else {
            const errorMessage = result.error || `Failed to upload ${processed.file.name}`
            errors.push(errorMessage)
          }
        } catch (error) {
          errors.push(`Failed to upload ${processed.file.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        // Multiple files - split into batches and upload sequentially
        const titlePrefix = editingEvent?.title || "Event Photo"
        const batches = splitIntoBatches(processedImages, {
          titlePrefix,
          eventInfo: editingEvent?.description || null,
        })
        
        let totalUploaded = 0
        
        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i]
          
          try {
            // Show progress for current batch
            if (batches.length > 1) {
              toast.info(`Uploading batch ${i + 1} of ${batches.length} (${batch.length} image${batch.length !== 1 ? 's' : ''})...`)
            }
            
            const result = await uploadBatch(batch, API_PATHS.adminImagesBatch, {
              titlePrefix,
              eventInfo: editingEvent?.description || null,
            })
            
            if (result.success && result.images) {
              result.images.forEach((image: any) => {
                if (image?.id) {
                  uploadedImageIds.push(image.id)
                }
              })
              totalUploaded += result.images.length
              setUploadProgress({ uploaded: totalUploaded, total: processedImages.length })
              
              if (result.errors && result.errors.length > 0) {
                errors.push(...result.errors)
              }
              
              if (result.message) {
                toast.warning(result.message)
              }
            } else {
              const errorMessage = result.errors?.join(', ') || "Failed to upload batch"
              errors.push(`Batch ${i + 1}: ${errorMessage}`)
            }
          } catch (error) {
            errors.push(`Batch ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      toast.error(`Failed to process images: ${errorMessage}`)
      errors.push(errorMessage)
    }

    // Add all uploaded images to the event
    if (uploadedImageIds.length > 0) {
      const addErrors: string[] = []
      for (const imageId of uploadedImageIds) {
        try {
          const response = await fetch(API_PATHS.adminEventImages(eventId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image_id: imageId,
              image_type: "in_event",
            }),
          })

          const json = await response.json()
          if (!json.success) {
            const errorMessage = json.error?.message || json.error || "Failed to add photo to event"
            addErrors.push(errorMessage)
          }
        } catch (error) {
          addErrors.push(`Failed to add photo: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      if (addErrors.length === 0) {
        toast.success(`Successfully added ${uploadedImageIds.length} photo${uploadedImageIds.length !== 1 ? 's' : ''}`)
        setAddingPhoto(false)
        setInEventPhotoFiles([])
        setInEventPhotoPreviews([])
        setUploadProgress({ uploaded: 0, total: 0 })
        
        // Refresh event details - preserve pending deletions
        if (editingEvent) {
          const updated = await fetchEventDetails(eventId)
          if (updated) {
            // Preserve pending deletions when refreshing after adding photos
            // The new photos from server should be merged with existing state
            setEditingEvent(updated)
            // Update the event in the list with new photo data
            replaceItem(eventId, updated)
            // Note: pendingDeletions are preserved - they're tracked separately
            // and will be processed on save
          }
        }
      } else {
        toast.error(`Added ${uploadedImageIds.length - addErrors.length} photos, but ${addErrors.length} failed`)
      }
    }

    if (errors.length > 0) {
      toast.error(`${errors.length} upload${errors.length !== 1 ? 's' : ''} failed: ${errors.join(', ')}`)
    }

    setUploadingPhotos(false)
  }

  // Handle drag end for photo reordering
  const handleDragEnd = async (event: DragEndEvent) => {
    // CRITICAL: Check ref synchronously to prevent race conditions
    if (isReorderingRef.current) {
      return // Already reordering, ignore this drag
    }
    
    // Prevent drag during reordering, if no event, or if there are pending deletions
    // Pending deletions make the photo array inconsistent - prevent reordering until save
    if (!editingEvent || reorderingPhotos || pendingDeletions.size > 0) {
      if (pendingDeletions.size > 0) {
        toast.info("Please save or cancel pending deletions before reordering photos")
      }
      return
    }

    // CRITICAL: Validate in_event_photos exists and is an array
    if (!Array.isArray(editingEvent.in_event_photos)) {
      console.error("in_event_photos is not an array", editingEvent.in_event_photos)
      toast.error("Invalid photo data. Please refresh and try again.")
      return
    }

    const { active, over } = event

    if (!over || active.id === over.id) {
      return
    }

    // Get the visible photos (filtered array) for finding indices
    // But we need to reorder the full array
    const visiblePhotos = editingEvent.in_event_photos.filter(
      p => !pendingDeletions.has(p.id)
    )
    const fullPhotosArray = editingEvent.in_event_photos
    
    // Find indices in visible array
    const visibleOldIndex = visiblePhotos.findIndex((p) => p.id === active.id)
    const visibleNewIndex = visiblePhotos.findIndex((p) => p.id === over.id)

    if (visibleOldIndex === -1 || visibleNewIndex === -1) {
      return
    }

    // Map visible indices to full array indices
    const fullOldIndex = fullPhotosArray.findIndex((p) => p.id === active.id)
    const fullNewIndex = fullPhotosArray.findIndex((p) => p.id === over.id)

    if (fullOldIndex === -1 || fullNewIndex === -1) {
      return
    }

    // CRITICAL: Set ref synchronously to prevent race conditions
    isReorderingRef.current = true
    setReorderingPhotos(true)

    // CRITICAL: Create abort controller for reordering requests
    const abortController = new AbortController()
    const signal = abortController.signal
    abortControllersRef.current.push(abortController)
    
    const cleanupAbortController = () => {
      abortControllersRef.current = abortControllersRef.current.filter(
        c => c !== abortController
      )
    }

    try {
      // Reorder the full array (including pending deletions if any)
      // CRITICAL: arrayMove creates a new array, doesn't mutate original
      const reorderedPhotos = arrayMove(
        fullPhotosArray,
        fullOldIndex,
        fullNewIndex
      )

      // Update display_order for all photos in full array
      const updatedPhotos = reorderedPhotos.map((photo, index) => ({
        ...photo,
        display_order: index,
      }))

      // CRITICAL: Check if component is still mounted before updating state
      if (!isMountedRef.current) {
        cleanupAbortController()
        isReorderingRef.current = false
        return
      }

      // Update local state immediately
      setEditingEvent({
        ...editingEvent,
        in_event_photos: updatedPhotos,
      })
      
      // Also update snapshot to keep it in sync
      if (eventSnapshot) {
        try {
          setEventSnapshot({
            ...eventSnapshot,
            in_event_photos: updatedPhotos,
          })
        } catch (snapshotError) {
          console.error("Failed to update snapshot:", snapshotError)
        }
      }

      // Update all photos' display_order in the database
      // CRITICAL: Use Promise.allSettled to handle partial failures gracefully
      const updatePromises = updatedPhotos.map((photo, index) =>
        fetch(API_PATHS.adminEventImage(editingEvent.id, photo.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ display_order: index }),
          signal, // Add abort signal for cancellation
        }).then(async (res) => {
          // CRITICAL: Check if request was aborted
          if (signal.aborted) {
            throw new Error("Request aborted")
          }
          if (!res.ok) {
            const errorJson = await res.json().catch(() => ({}))
            throw new Error(errorJson.error?.message || `Failed to update photo ${photo.id}`)
          }
          return res
        })
      )

      const results = await Promise.allSettled(updatePromises)
      const successful = results.filter(r => r.status === 'fulfilled').length
      const failed = results.filter(r => r.status === 'rejected').length

      // CRITICAL: Check if request was aborted
      if (signal.aborted) {
        cleanupAbortController()
        isReorderingRef.current = false
        return
      }

      if (failed === 0) {
        if (isMountedRef.current) {
          toast.success("Photo order updated successfully")
          // No need to refetch - optimistic update already applied
          // The local state is already updated via setEditingEvent()
          // Only update the event in the list to keep it in sync
          replaceItem(editingEvent.id, {
            ...editingEvent,
            in_event_photos: updatedPhotos,
          })
          // Update snapshot to reflect new order
          if (eventSnapshot) {
            try {
              setEventSnapshot({
                ...eventSnapshot,
                in_event_photos: updatedPhotos,
              })
            } catch (snapshotError) {
              console.error("Failed to update snapshot:", snapshotError)
            }
          }
        }
      } else {
        // CRITICAL: Check if component is still mounted before showing error
        if (isMountedRef.current) {
          toast.error(`Failed to update order for ${failed} photo${failed !== 1 ? 's' : ''}. Reverting changes.`)
          // Revert on error - refetch to get correct state from server
          const reverted = await fetchEventDetails(editingEvent.id, signal)
          if (reverted && isMountedRef.current) {
            setEditingEvent(reverted)
            replaceItem(editingEvent.id, reverted)
            // Restore snapshot
            if (eventSnapshot) {
              try {
                setEventSnapshot(JSON.parse(JSON.stringify(reverted)))
              } catch (copyError) {
                console.error("Failed to restore snapshot:", copyError)
                setEventSnapshot({ ...reverted })
              }
            }
          }
        }
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
        console.error("Failed to update photo order:", error)
        toast.error("Failed to update photo order")
        // Revert on error - refetch to get correct state from server
        const reverted = await fetchEventDetails(editingEvent.id)
        if (reverted && isMountedRef.current) {
          setEditingEvent(reverted)
          replaceItem(editingEvent.id, reverted)
          // Restore snapshot
          if (eventSnapshot) {
            try {
              setEventSnapshot(JSON.parse(JSON.stringify(reverted)))
            } catch (copyError) {
              console.error("Failed to restore snapshot:", copyError)
              setEventSnapshot({ ...reverted })
            }
          }
        }
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
    // CRITICAL: Check ref synchronously to prevent race conditions
    if (isReorderingRef.current) {
      toast.info("Please wait for photo reordering to complete")
      return
    }
    
    // Prevent removal if:
    // 1. Already removing this photo
    // 2. Reordering is in progress
    // 3. Save is in progress
    // 4. Photo is marked for pending deletion (use bulk delete instead)
    if (removingPhoto === eventImageId || reorderingPhotos || saving || pendingDeletions.has(eventImageId)) {
      if (pendingDeletions.has(eventImageId)) {
        toast.info("This photo is marked for deletion. Use 'Save Changes' to confirm, or cancel to remove the deletion.")
      }
      return
    }
    
    // CRITICAL: Validate editingEvent and in_event_photos
    if (!editingEvent || !Array.isArray(editingEvent.in_event_photos)) {
      toast.error("Invalid event data. Please refresh and try again.")
      return
    }

    setRemovingPhoto(eventImageId)
    try {
      const response = await fetch(API_PATHS.adminEventImage(eventId, eventImageId), {
        method: "DELETE",
      })

      const json = await response.json()
      if (json.success) {
        // Check if component is still mounted before updating state
        if (!isMountedRef.current) {
          setRemovingPhoto(null)
          return
        }
        
        toast.success("Photo removed successfully")
        
        // Optimistically update UI by removing the photo and reordering remaining photos
        if (editingEvent && editingEvent.in_event_photos) {
          // Remove the deleted photo from the list
          const remainingPhotos = editingEvent.in_event_photos.filter(
            (p) => p.id !== eventImageId
          )
          
          // Reorder remaining photos to have sequential display_order (0, 1, 2, ...)
          const reorderedPhotos = remainingPhotos
            .sort((a, b) => a.display_order - b.display_order)
            .map((photo, index) => ({
              ...photo,
              display_order: index,
            }))
          
          // CRITICAL: Create abort controller for removal requests
          const abortController = new AbortController()
          const signal = abortController.signal
          abortControllersRef.current.push(abortController)
          
          const cleanupAbortController = () => {
            abortControllersRef.current = abortControllersRef.current.filter(
              c => c !== abortController
            )
          }
          
          // Update display_order in database for all remaining photos
          try {
            const updatePromises = reorderedPhotos.map((photo, index) =>
              fetch(API_PATHS.adminEventImage(eventId, photo.id), {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ display_order: index }),
                signal, // Add abort signal for cancellation
              }).then(async (res) => {
                // CRITICAL: Check if request was aborted
                if (signal.aborted) {
                  throw new Error("Request aborted")
                }
                if (!res.ok) {
                  const errorJson = await res.json().catch(() => ({}))
                  throw new Error(errorJson.error?.message || `Failed to update photo ${photo.id}`)
                }
                return res
              })
            )
            
            // CRITICAL: Use Promise.allSettled instead of Promise.all for better error handling
            const results = await Promise.allSettled(updatePromises)
            const failed = results.filter(r => r.status === 'rejected').length
            
            // CRITICAL: Check if request was aborted
            if (signal.aborted) {
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
            replaceItem(eventId, updatedEvent)
            
            // CRITICAL: Update snapshot to reflect the new state after removal
            if (eventSnapshot) {
              try {
                setEventSnapshot(JSON.parse(JSON.stringify(updatedEvent)))
              } catch (copyError) {
                console.error("Failed to update snapshot:", copyError)
                setEventSnapshot({ ...updatedEvent })
              }
            }
            
            // CRITICAL: Remove from selectedPhotoIds if it was selected
            setSelectedPhotoIds(prev => {
              const newSet = new Set(prev)
              newSet.delete(eventImageId)
              return newSet
            })
            
            // CRITICAL: Remove from pendingDeletions if it was pending
            setPendingDeletions(prev => {
              const newSet = new Set(prev)
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
            
            console.error("Failed to update photo order after deletion:", updateError)
            // If order update fails, still refresh from server
            if (isMountedRef.current) {
              const updated = await fetchEventDetails(eventId)
              if (updated && isMountedRef.current) {
                setEditingEvent(updated)
                replaceItem(eventId, updated)
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
              replaceItem(eventId, updated)
            }
          }
        }
      } else {
        const errorMessage = json.error?.message || json.error || "Failed to remove photo"
        toast.error(errorMessage)
      }
    } catch (error) {
      toast.error("Failed to remove photo")
      console.error(error)
    } finally {
      setRemovingPhoto(null)
    }
  }

  // Handle photo selection for bulk delete (memoized with useCallback)
  // Note: We don't check pendingDeletions here because photos marked for deletion
  // are filtered from display, so they can't be selected. The check is done in the render.
  const handleSelectPhoto = useCallback((photoId: string, selected: boolean) => {
    setSelectedPhotoIds(prev => {
      const newSet = new Set(prev)
      if (selected) {
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
        .filter(p => !pendingDeletions.has(p.id))
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
      toast.error("No event selected")
      return
    }
    
    // CRITICAL: Validate in_event_photos exists and is an array
    if (!Array.isArray(editingEvent.in_event_photos)) {
      toast.error("Invalid event data. Please refresh and try again.")
      return
    }
    
    // Capture selected IDs immediately to avoid stale closure issues
    const idsToDelete = Array.from(selectedPhotoIds)
    
    if (idsToDelete.length === 0) {
      toast.info("No photos selected")
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
      toast.error("No valid photos selected for deletion")
      // Clear invalid selection
      setSelectedPhotoIds(new Set())
      return
    }
    
    // Warn if some IDs were invalid
    if (validIdsToDelete.length < idsToDelete.length) {
      const invalidCount = idsToDelete.length - validIdsToDelete.length
      toast.warning(`${invalidCount} invalid photo${invalidCount !== 1 ? 's' : ''} skipped`)
    }

    // Add selected photos to pending deletions
    setPendingDeletions(prev => {
      const newSet = new Set(prev)
      validIdsToDelete.forEach(id => newSet.add(id))
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
    toast.success(`${validIdsToDelete.length} photo${validIdsToDelete.length !== 1 ? 's' : ''} marked for deletion. Click "Save Changes" to confirm.`)
  }, [selectedPhotoIds, editingEvent])

  // Keyboard shortcuts handler (optimized with useCallback)
  useEffect(() => {
    if (!editDialogOpen || !editingEvent) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when dialog is open and not in an input field
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
        e.preventDefault()
        // Use current state values from closure (they're in dependency array)
        const currentEditingEvent = editingEvent
        const currentPendingDeletions = pendingDeletions
        const currentSelectedPhotoIds = selectedPhotoIds
        
        if (currentEditingEvent?.in_event_photos) {
          const availablePhotos = currentEditingEvent.in_event_photos.filter(
            p => !currentPendingDeletions.has(p.id)
          )
          const allSelected = currentSelectedPhotoIds.size === availablePhotos.length && availablePhotos.length > 0
          handleSelectAll(!allSelected)
        }
      }

      // Delete or Backspace: Delete selected photos
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPhotoIds.size > 0) {
        e.preventDefault()
        handleMarkForDeletion()
      }

      // Escape: Clear selection
      if (e.key === 'Escape' && selectedPhotoIds.size > 0) {
        e.preventDefault()
        setSelectedPhotoIds(new Set())
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editDialogOpen, editingEvent, selectedPhotoIds, pendingDeletions, saving, reorderingPhotos, handleSelectAll, handleMarkForDeletion])

  // Fetch images for selection
  const fetchImages = async () => {
    try {
      const response = await fetch(buildApiUrl(API_PATHS.adminImages, { limit: 1000 }))
      const json = await response.json()
      if (json.success) {
        // API returns { success: true, data: { images: [...], pagination: {...} } }
        // Check both possible response structures for compatibility
        const fetchedImages = Array.isArray(json.data?.images) 
          ? json.data.images 
          : Array.isArray(json.images) 
            ? json.images 
            : []
        setImages(fetchedImages)
      } else {
        // Set to empty array on error to prevent undefined state
        setImages([])
      }
    } catch (error) {
      console.error("Failed to load images", error)
      // Set to empty array on error to prevent undefined state
      setImages([])
    }
  }

  useEffect(() => {
    if (session) {
      fetchImages()
    }
  }, [session])

  // Handle event create
  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaving(true)

    const formData = new FormData(e.currentTarget)
    let imageId: string | null = null

    // Upload poster image if provided
    if (posterFile) {
      try {
        const uploadFormData = new FormData()
        uploadFormData.append("file", posterFile)
        uploadFormData.append("title", formData.get("title") as string || "Event Poster")

        const uploadResponse = await fetch(API_PATHS.adminImages, {
          method: "POST",
          body: uploadFormData,
        })

        const uploadJson = await uploadResponse.json()
        if (uploadJson.success && uploadJson.data?.image?.id) {
          imageId = uploadJson.data.image.id
        } else {
          const errorMessage = uploadJson.error?.message || uploadJson.error || "Failed to upload poster image"
          toast.error(errorMessage)
          setSaving(false)
          return
        }
      } catch (error) {
        toast.error("Failed to upload poster image")
        console.error(error)
        setSaving(false)
        return
      }
    }

    const eventData = {
      title: formData.get("title") as string,
      description: formData.get("description") as string || null,
      image_id: imageId,
      event_date: formData.get("event_date") as string || null,
      start_date: formData.get("start_date") as string || null,
      end_date: formData.get("end_date") as string || null,
    }

    try {
      const response = await fetch(API_PATHS.adminEvents, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventData),
      })

      const json = await response.json()
      if (json.success) {
        const newEvent = json.data?.event || json.event
        // Optimistically add to list (instant UI update)
        if (newEvent) {
          addItem(newEvent)
        }
        toast.success("Event created successfully")
        setCreateDialogOpen(false)
        setPosterFile(null)
        setPosterPreview(null)
        setSelectedImageId(null)
        // Reset form safely
        if (createFormRef.current) {
          createFormRef.current.reset()
        } else if (e.currentTarget) {
          e.currentTarget.reset()
        }
      } else {
        const errorMessage = json.error?.message || json.error || "Failed to create event"
        toast.error(errorMessage)
      }
    } catch (error) {
      toast.error("Failed to create event")
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  // Handle event update
  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    // CRITICAL: Capture editingEvent at the start to avoid stale closure issues
    // But also validate it exists and hasn't changed
    const currentEditingEvent = editingEvent
    if (!currentEditingEvent) {
      toast.error("No event selected for editing")
      return
    }

    // CRITICAL: Prevent double submission
    if (saving) {
      toast.info("Save operation already in progress. Please wait.")
      return
    }

    setSaving(true)
    
    // CRITICAL: Create abort controller for request cancellation
    const abortController = new AbortController()
    const signal = abortController.signal
    
    // Store abort controller for cleanup on unmount
    abortControllersRef.current.push(abortController)
    
    // Cleanup function to remove from ref when done
    const cleanupAbortController = () => {
      abortControllersRef.current = abortControllersRef.current.filter(
        c => c !== abortController
      )
    }
    
    // CRITICAL: Extract form data immediately to capture current state
    const formData = new FormData(e.currentTarget)
    const updates: any = {}

    // CRITICAL: Extract form values - handle null/undefined properly
    const title = formData.get("title") as string | null
    const description = formData.get("description") as string | null
    const eventDate = formData.get("event_date") as string | null
    const startDate = formData.get("start_date") as string | null
    const endDate = formData.get("end_date") as string | null

    // CRITICAL: Validate title - must not be empty
    // Handle null/undefined title from form
    const titleValue = title ?? ""
    const trimmedTitle = titleValue.trim()
    if (!trimmedTitle) {
      // If title is missing or empty, use existing title to prevent constraint violation
      if (!currentEditingEvent.title) {
        cleanupAbortController()
        toast.error("Event title is required")
        setSaving(false)
        return
      }
      updates.title = currentEditingEvent.title
    } else if (trimmedTitle !== currentEditingEvent.title) {
      // CRITICAL: Validate title length (prevent database errors)
      if (trimmedTitle.length > 500) {
        cleanupAbortController()
        toast.error("Event title is too long (maximum 500 characters)")
        setSaving(false)
        return
      }
      updates.title = trimmedTitle
    }
    
    // CRITICAL: Validate description length
    // Handle null/undefined description from form
    const descriptionValue = description ?? ""
    if (descriptionValue !== (currentEditingEvent.description || "")) {
      if (descriptionValue && descriptionValue.length > 10000) {
        cleanupAbortController()
        toast.error("Event description is too long (maximum 10,000 characters)")
        setSaving(false)
        return
      }
      // Empty string becomes null (database expects null for empty)
      updates.description = descriptionValue.trim() || null
    }
    
    // Upload new poster image if provided
    let finalImageId: string | null = currentEditingEvent.image_id || null
    if (editPosterFile) {
      // CRITICAL: Validate file before upload
      if (editPosterFile.size > 10 * 1024 * 1024) { // 10MB limit
        cleanupAbortController()
        toast.error("Poster image is too large (maximum 10MB)")
        setSaving(false)
        return
      }
      
      // CRITICAL: Validate file type
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
      if (!validTypes.includes(editPosterFile.type)) {
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
        if (signal.aborted) {
          cleanupAbortController()
          setSaving(false)
          return
        }
        
        // CRITICAL: Check if response is OK before parsing
        if (!uploadResponse.ok) {
          cleanupAbortController()
          toast.error(`Failed to upload poster image: ${uploadResponse.status} ${uploadResponse.statusText}`)
          setSaving(false)
          return
        }

        // CRITICAL: Handle JSON parsing errors
        let uploadJson: any
        try {
          uploadJson = await uploadResponse.json()
        } catch (parseError) {
          cleanupAbortController()
          console.error("Failed to parse upload response JSON:", parseError)
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
          const errorMessage = uploadJson?.error?.message || uploadJson?.error || "Failed to upload poster image"
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
        console.error(error)
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
        // CRITICAL: Validate timestamp is reasonable (not too far in past/future)
        if (timestamp > 0 && timestamp < 2147483647) { // Max 32-bit signed int
          if (timestamp !== (currentEditingEvent.event_date || null)) {
            updates.event_date = timestamp
          }
        } else {
          cleanupAbortController()
          toast.error("Invalid event date: date is out of valid range")
          setSaving(false)
          return
        }
      } catch (error) {
        cleanupAbortController()
        const errorMessage = error instanceof Error ? error.message : "Invalid event date format"
        toast.error(errorMessage)
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
        // CRITICAL: Validate timestamp is reasonable
        if (startTimestamp > 0 && startTimestamp < 2147483647) {
          if (startTimestamp !== (currentEditingEvent.start_date || null)) {
            updates.start_date = startTimestamp
          }
        } else {
          cleanupAbortController()
          toast.error("Invalid start date: date is out of valid range")
          setSaving(false)
          return
        }
      } catch (error) {
        cleanupAbortController()
        const errorMessage = error instanceof Error ? error.message : "Invalid start date format"
        toast.error(errorMessage)
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
        // CRITICAL: Validate timestamp is reasonable
        if (endTimestamp > 0 && endTimestamp < 2147483647) {
          if (endTimestamp !== (currentEditingEvent.end_date || null)) {
            updates.end_date = endTimestamp
          }
        } else {
          cleanupAbortController()
          toast.error("Invalid end date: date is out of valid range")
          setSaving(false)
          return
        }
      } catch (error) {
        cleanupAbortController()
        const errorMessage = error instanceof Error ? error.message : "Invalid end date format"
        toast.error(errorMessage)
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
      toast.error("Start date must be before or equal to end date")
      setSaving(false)
      return
    }

    // Handle pending photo deletions via background jobs
    // CRITICAL: Capture initial deletion state at the start to avoid stale closure issues
    const initialPendingDeletionsSize = pendingDeletions.size
    const hadDeletionsAtStart = initialPendingDeletionsSize > 0
    
    let deletionQueued = false
    let deletionSucceeded = false // Track if deletion actually succeeded (not just queued)
    if (hadDeletionsAtStart) {
      try {
        // CRITICAL: Validate that all pending deletion IDs still exist in the event
        // This prevents errors if photos were deleted externally
        // Use currentEditingEvent to avoid stale closure
        // CRITICAL: Capture pendingDeletions at this moment to avoid race conditions
        const currentPendingDeletionsArray = Array.from(pendingDeletions)
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
          console.error("validPendingDeletions is not an array:", validPendingDeletions)
          toast.error("Error validating deletions. Please try again.")
          deletionQueued = false
        } else {
          // Handle case where some deletions are invalid
          if (validPendingDeletions.length < currentPendingDeletionsArray.length) {
            const invalidCount = currentPendingDeletionsArray.length - validPendingDeletions.length
            toast.warning(`${invalidCount} photo${invalidCount !== 1 ? 's' : ''} marked for deletion no longer exist. They will be skipped.`)
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
            toast.info("No valid photos to delete.")
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
              console.error("Unexpected: validPendingDeletions is empty after validation")
              toast.error("No valid photos to delete")
              deletionQueued = false
            } else {
              // CRITICAL: Validate all IDs are non-empty strings before sending
              const invalidIds = validPendingDeletions.filter(id => typeof id !== 'string' || id.trim().length === 0)
              if (invalidIds.length > 0) {
                console.error("Invalid photo IDs in deletion request:", invalidIds)
                toast.error("Invalid photo IDs. Please try again.")
                deletionQueued = false
              } else {
                const deleteResponse = await fetch(API_PATHS.adminEventImagesBatchDelete(currentEditingEvent.id), {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageIds: validPendingDeletions }),
                signal, // Add abort signal for cancellation
              })

              // CRITICAL: Check if request was aborted
              if (signal.aborted) {
                cleanupAbortController()
                setSaving(false)
                return
              }

              // CRITICAL: Handle JSON parsing errors
              let deleteJson: any
              try {
                deleteJson = await deleteResponse.json()
              } catch (parseError) {
                cleanupAbortController()
                if (!isMountedRef.current) {
                  setSaving(false)
                  return
                }
                console.error("Failed to parse deletion response JSON:", parseError)
                toast.error("Invalid response from server. Please try again.")
                // Don't fail the entire save - continue with other updates
                // Set deletionQueued to false so we know it failed
                deletionQueued = false
              }
              
              // CRITICAL: Check if response is OK before processing
              if (!deleteResponse.ok) {
                cleanupAbortController()
                if (!isMountedRef.current) {
                  setSaving(false)
                  return
                }
                const errorMessage = `Failed to delete photos: ${deleteResponse.status} ${deleteResponse.statusText}`
                toast.error(errorMessage)
                deletionQueued = false
              } else if (deleteJson && deleteJson.success) {
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
                  console.error("Invalid deletion response counts:", { deletedCount, attemptedCount })
                  toast.warning("Received invalid response from server. Some deletions may have failed.")
                  deletionQueued = false
                } else if (deletedCount === 0) {
                  // No photos were deleted at all
                  deletionQueued = false
                  toast.error(`Failed to delete ${attemptedCount} photo${attemptedCount !== 1 ? 's' : ''}. Please try again.`)
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
                  toast.success(`Successfully deleted ${deletedCount} photo${deletedCount !== 1 ? 's' : ''}`)
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
                  toast.warning(warningMessage)
                }
              } else {
                // deleteJson exists but success is false
                const errorMessage = deleteJson?.data?.message || deleteJson?.error?.message || deleteJson?.error || "Failed to delete photos"
                toast.error(errorMessage)
                deletionQueued = false
                // Don't fail the entire save if deletion fails - continue with other updates
              }
              }
            }
          }
        }
      } catch (error) {
        cleanupAbortController()
        
        // CRITICAL: Check if error is from abort (request cancelled)
        if (error instanceof Error && error.name === 'AbortError') {
          // Request was aborted - don't show error, just return
          if (isMountedRef.current) {
            setSaving(false)
          }
          return
        }
        
        console.error("Failed to queue photo deletions:", error)
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
    const hasUpdates = Object.keys(updates).length > 0
    // CRITICAL: Only consider deletions as "changes" if we actually queued them or if there are still pending ones
    // If all deletions were invalid, we don't have any changes related to deletions
    const hasDeletions = hadDeletionsAtStart && (deletionQueued || pendingDeletions.size > 0)
    const hasAnyChanges = hasUpdates || hasDeletions
    
    if (!hasAnyChanges) {
      cleanupAbortController()
      toast.info("No changes to save")
      setSaving(false)
      return
    }

    try {
      // CRITICAL: Re-validate editingEvent still exists before proceeding
      // It might have been deleted externally
      if (!editingEvent || editingEvent.id !== currentEditingEvent.id) {
        cleanupAbortController()
        toast.error("Event was modified or deleted. Please refresh and try again.")
        await restoreEventState(currentEditingEvent.id)
        setSaving(false)
        return
      }
      
      // Optimistically update UI first (only if there are actual updates)
      if (Object.keys(updates).length > 0) {
        updateItem(currentEditingEvent.id, updates as Partial<Event>)
      }
      
      // Only send PATCH request if there are actual updates
      let updateSuccess = true
      if (Object.keys(updates).length > 0) {
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
          console.error("Failed to parse response JSON:", parseError)
          setSaving(false)
          return
        }
        
        // Handle 409 CONFLICT (concurrent edit detected)
        if (response.status === 409 || json.error?.code === 'CONFLICT') {
          updateSuccess = false
          const errorMessage = json.error?.message || "Another admin is currently editing this event. Please refresh and try again."
          toast.error(errorMessage)
          // Refresh event data to get latest state
          if (isMountedRef.current) {
            const latest = await fetchEventDetails(currentEditingEvent.id, signal)
            if (latest && isMountedRef.current) {
              setEditingEvent(latest)
              // CRITICAL: Use try-catch for deep copy
              try {
                setEventSnapshot(JSON.parse(JSON.stringify(latest)))
              } catch (copyError) {
                console.error("Failed to create snapshot:", copyError)
                setEventSnapshot({ ...latest })
              }
              replaceItem(currentEditingEvent.id, latest)
              toast.info("Event data has been refreshed with the latest changes.")
            }
          }
        } else if (json.success) {
          // Check if component is still mounted before updating state
          if (!isMountedRef.current) {
            cleanupAbortController()
            setSaving(false)
            return
          }
          
          const updatedEvent = json.data?.event || json.event
          // CRITICAL: Validate updatedEvent structure before using
          if (updatedEvent && typeof updatedEvent === 'object') {
            // CRITICAL: Validate required fields exist
            if (!updatedEvent.id || updatedEvent.id !== currentEditingEvent.id) {
              console.error("Updated event ID mismatch:", { 
                expected: currentEditingEvent.id, 
                received: updatedEvent.id 
              })
              toast.warning("Event data mismatch. Please refresh the page.")
            } else if (!updatedEvent.title || typeof updatedEvent.title !== 'string') {
              console.error("Updated event missing title:", updatedEvent)
              toast.warning("Invalid event data received. Please refresh the page.")
            } else {
              // Data is valid - proceed with update
              replaceItem(currentEditingEvent.id, updatedEvent)
              // Update editingEvent with server response
              setEditingEvent(updatedEvent)
              // CRITICAL: Update snapshot after successful event update
              // This ensures snapshot reflects latest saved state, even if deletions failed
              try {
                setEventSnapshot(JSON.parse(JSON.stringify(updatedEvent)))
              } catch (copyError) {
                console.error("Failed to update snapshot:", copyError)
                setEventSnapshot({ ...updatedEvent })
              }
            }
          } else {
            // Invalid event data - don't update state
            console.error("Invalid updated event data:", updatedEvent)
            toast.warning("Invalid event data received. Please refresh the page.")
          }
        } else {
          updateSuccess = false
          const errorMessage = json.error?.message || json.error || "Failed to update event"
          toast.error(errorMessage)
        }
      }

      // CRITICAL: Re-validate editingEvent still exists before finalizing
      if (!editingEvent || editingEvent.id !== currentEditingEvent.id) {
        cleanupAbortController()
        toast.error("Event was modified or deleted during save. Please refresh and try again.")
        await restoreEventState(currentEditingEvent.id)
        setSaving(false)
        return
      }

      if (updateSuccess) {
        // CRITICAL: Check deletion status
        // Use deletionSucceeded flag instead of checking pendingDeletions.size
        // because state updates are async and might be stale
        const noDeletionsRequested = !hadDeletionsAtStart
        
        // Only show warning if deletions were requested but didn't succeed
        if (hadDeletionsAtStart && !deletionSucceeded) {
          // Deletions were requested but failed
          toast.warning("Event updated, but photo deletions failed. Please try deleting photos again.")
        }
        
        // Only clear snapshot and close dialog if everything succeeded
        // (event update succeeded AND deletions succeeded OR no deletions were requested)
        if (deletionSucceeded || noDeletionsRequested) {
          setEventSnapshot(null)
          setFormKey(0) // Reset form key
          // Only show "Event updated successfully" if there were actual event updates
          // If only deletions happened, the deletion success message is sufficient
          if (Object.keys(updates).length > 0) {
            toast.success("Event updated successfully")
          }
          setEditDialogOpen(false)
          setEditingEvent(null)
          setEditPosterFile(null)
          setEditPosterPreview(null)
          setEditSelectedImageId(null)
          setSelectedPhotoIds(new Set())
          setPendingDeletions(new Set())
        } else {
          // Keep dialog open if deletions failed - user can retry or cancel
          // Keep snapshot updated with latest event state but don't clear it
          // so user can still restore if needed
          toast.info("Event updated. Please retry photo deletions or cancel to discard changes.")
        }
      } else {
        // Fallback: Restore from snapshot or refetch from server
        await restoreEventState(editingEvent.id)
      }
    } catch (error) {
      // Fallback: Restore from snapshot or refetch from server
      await restoreEventState(currentEditingEvent.id)
      toast.error("Failed to update event")
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  // Check if there are pending changes (memoized for performance)
  // This checks for deletions and poster changes that are visible in state
  // Form field changes are validated in handleUpdate
  const hasPendingChanges = useMemo(() => {
    // Check for pending deletions
    if (pendingDeletions.size > 0) return true
    
    // Check for poster image change
    if (editPosterFile) return true
    
    return false
  }, [pendingDeletions, editPosterFile])

  // Restore event state from snapshot or server (fallback mechanism)
  // This restores ALL event details including form fields, photos, and poster
  const restoreEventState = async (eventId: string) => {
    // Fallback 1: Restore from snapshot if available (includes ALL original data: in_event_photos, dates, description, etc.)
    if (eventSnapshot) {
      // Verify event still exists before restoring (snapshot might be stale)
      try {
        const verifyEvent = await fetchEventDetails(eventId)
        if (!verifyEvent) {
          // Event was deleted - can't restore
          toast.error("Event no longer exists. Closing editor.")
          setEditDialogOpen(false)
          setEditingEvent(null)
          setEventSnapshot(null)
          setPendingDeletions(new Set())
          setSelectedPhotoIds(new Set())
          setEditPosterFile(null)
          setEditPosterPreview(null)
          return
        }
      } catch (error) {
        console.error("Failed to verify event exists:", error)
        // Continue with snapshot restore anyway
      }
      
      setEditingEvent(eventSnapshot)
      setPendingDeletions(new Set())
      setSelectedPhotoIds(new Set())
      setEditPosterFile(null)
      setEditPosterPreview(null)
      // Force form remount to restore form field values (defaultValue only works on mount)
      setFormKey(prev => prev + 1)
      toast.info("Changes have been reverted to the last saved state")
    }
    
    // Fallback 2: Refetch from server (most reliable)
    try {
      const latest = await fetchEventDetails(eventId)
      if (latest) {
        setEditingEvent(latest)
        setPendingDeletions(new Set())
        setSelectedPhotoIds(new Set())
        setEditPosterFile(null)
        setEditPosterPreview(null)
        // Force form remount to restore form field values
        setFormKey(prev => prev + 1)
        replaceItem(eventId, latest)
        if (!eventSnapshot) {
          toast.info("Event state has been refreshed from server")
        }
      } else {
        // Event not found - might have been deleted
        toast.error("Event no longer exists. Closing editor.")
        setEditDialogOpen(false)
        setEditingEvent(null)
        setEventSnapshot(null)
        setPendingDeletions(new Set())
        setSelectedPhotoIds(new Set())
        setEditPosterFile(null)
        setEditPosterPreview(null)
      }
    } catch (error) {
      console.error("Failed to refetch event details:", error)
      // If refetch fails, at least we tried to restore from snapshot
      toast.error("Failed to restore event state. Please refresh the page.")
    }
  }

  // Handle event delete - open confirmation dialog
  const handleDeleteClick = (eventId: string) => {
    setDeleteConfirm(eventId)
  }

  // Confirm event delete - actually perform the deletion
  const handleDelete = async (eventId: string) => {
    try {
      setDeleting(true)
      // Optimistically remove from list
      removeItem(eventId)
      
      const response = await fetch(API_PATHS.adminEvent(eventId), {
        method: "DELETE",
      })

      const json = await response.json()
      if (json.success) {
        toast.success("Event deleted successfully")
        setDeleteConfirm(null)
      } else {
        // Rollback on error
        fetchEvents()
        const errorMessage = json.error?.message || json.error || "Failed to delete event"
        toast.error(errorMessage)
      }
    } catch (error) {
      // Rollback on error
      fetchEvents()
      toast.error("Failed to delete event")
      console.error(error)
    } finally {
      setDeleting(false)
    }
  }

  const formatTimestamp = (timestamp: number | null, dateFormat: string = "yyyy-MM-dd") => {
    if (!timestamp) return ""
    try {
      // Handle both Unix timestamp (seconds) and milliseconds
      const timestampMs = timestamp > 1000000000000 
        ? timestamp // Already in milliseconds
        : timestamp * 1000 // Convert from seconds to milliseconds
      
      // CRITICAL: Convert UTC timestamp to Bangkok timezone for display
      // Timestamps in DB are UTC but represent Bangkok time
      const utcDate = new Date(timestampMs)
      const bangkokDate = new TZDate(utcDate.getTime(), 'Asia/Bangkok')
      
      return format(bangkokDate, dateFormat)
    } catch (error) {
      console.error("Error formatting timestamp:", timestamp, error)
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
                  disabled={saving}
                />
              </div>
              <div>
                <Label htmlFor="create-description">Description</Label>
                <Textarea
                  id="create-description"
                  name="description"
                  rows={4}
                  disabled={saving}
                />
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
                    setPosterFile(file)
                    if (file) {
                      const reader = new FileReader()
                      reader.onloadend = () => {
                        setPosterPreview(reader.result as string)
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
                        setPosterFile(null)
                        setPosterPreview(null)
                        const input = document.getElementById("create-poster") as HTMLInputElement
                        if (input) input.value = ""
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
              onChange={(e) => setUpcomingFilter(e.target.checked)}
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
                  onChange={(e) => setTitleFilter(e.target.value)}
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
                  setEventDateFilter(e.target.value)
                  setUseDateRange(false)
                  setEventDateFrom("")
                  setEventDateTo("")
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
                setUseDateRange(e.target.checked)
                if (e.target.checked) {
                  setEventDateFilter("")
                } else {
                  setEventDateFrom("")
                  setEventDateTo("")
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
                  onChange={(e) => setEventDateFrom(e.target.value)}
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
                  onChange={(e) => setEventDateTo(e.target.value)}
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
          {total > 0 ? (
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
      {events.length === 0 ? (
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
                  {events.map((event, index) => (
                    <tr key={event.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {index + 1}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{event.title}</div>
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
                                // CRITICAL: Validate that we have valid event data
                                if (!eventDetails && !event) {
                                  toast.error("Failed to load event details")
                                  return
                                }
                                
                                const eventToEdit = eventDetails || event
                                
                                // CRITICAL: Validate eventToEdit has required fields
                                if (!eventToEdit || !eventToEdit.id) {
                                  toast.error("Invalid event data")
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
                                  console.error("Failed to create event snapshot:", copyError)
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
                                console.error("Failed to open edit dialog:", error)
                                toast.error("Failed to load event for editing")
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
                  ))}
                </tbody>
              </table>
            </div>
            {/* Page size selector and total count */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{events.length}</span> of <span className="font-medium">{total}</span> events
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">Items per page:</span>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => {
                    setPageSize(parseInt(value))
                    fetchEvents()
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
            {hasMore && (
              <div ref={scrollSentinelRef} className="py-4 flex justify-center">
                {loading && <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
              </div>
            )}
            {!hasMore && events.length > 0 && (
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-center text-sm text-gray-500">
                No more events to load
              </div>
            )}
          </div>

          {/* Mobile Card View */}
          <div className="lg:hidden space-y-4">
            {events.map((event, index) => (
              <div
                key={event.id}
                className="bg-white rounded-lg shadow-md overflow-hidden"
              >
                {event.image_url && (
                  <div className="aspect-video bg-gray-100 relative">
                    <img
                      src={event.image_url}
                      alt={event.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded">No. {index + 1}</span>
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
                      <span>In-event photos: {event.in_event_photos && event.in_event_photos.length > 0 ? (
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
                          // CRITICAL: Validate that we have valid event data
                          if (!eventDetails && !event) {
                            toast.error("Failed to load event details")
                            return
                          }
                          
                          const eventToEdit = eventDetails || event
                          
                          // CRITICAL: Validate eventToEdit has required fields
                          if (!eventToEdit || !eventToEdit.id) {
                            toast.error("Invalid event data")
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
                            console.error("Failed to create event snapshot:", copyError)
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
                          console.error("Failed to open edit dialog:", error)
                          toast.error("Failed to load event for editing")
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
            ))}
            {/* Page size selector and total count for mobile */}
            <div className="bg-white rounded-lg shadow px-4 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing <span className="font-medium">{events.length}</span> of <span className="font-medium">{total}</span>
              </div>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => {
                  setPageSize(parseInt(value))
                  fetchEvents()
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
            {hasMore && (
              <div ref={scrollSentinelRef} className="py-4 flex justify-center">
                {loading && <Loader2 className="w-6 h-6 animate-spin text-gray-400" />}
              </div>
            )}
            {!hasMore && events.length > 0 && (
              <div className="bg-white rounded-lg shadow px-4 py-3 text-center text-sm text-gray-500">
                No more events to load
              </div>
            )}
          </div>
        </>
      )}

      {/* Edit Dialog - Streamlined for Dates and Images */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
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
                    defaultValue={editingEvent.description || ""}
                    disabled={saving}
                    placeholder="Enter event description..."
                  />
                  <p className="text-sm text-gray-500 mt-1">Provide a description for this event</p>
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
                      defaultValue={formatTimestamp(editingEvent.event_date)}
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-start_date">Start Date</Label>
                    <Input
                      id="edit-start_date"
                      name="start_date"
                      type="date"
                      defaultValue={formatTimestamp(editingEvent.start_date)}
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-end_date">End Date</Label>
                    <Input
                      id="edit-end_date"
                      name="end_date"
                      type="date"
                      defaultValue={formatTimestamp(editingEvent.end_date)}
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
                      setEditPosterFile(file)
                      if (file) {
                        const reader = new FileReader()
                        reader.onloadend = () => {
                          setEditPosterPreview(reader.result as string)
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
                          const input = document.getElementById("edit-poster") as HTMLInputElement
                          if (input) input.value = ""
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
                    {selectedPhotoIds.size > 0 && (
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
                {pendingDeletions.size > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                    <strong>{pendingDeletions.size}</strong> photo{pendingDeletions.size !== 1 ? 's' : ''} marked for deletion. Click "Save Changes" to confirm.
                  </div>
                )}
                {editingEvent.in_event_photos && editingEvent.in_event_photos.filter(p => !pendingDeletions.has(p.id)).length > 0 ? (
                  <>
                    {/* Selection controls */}
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <button
                        type="button"
                        onClick={() => {
                          const availablePhotos = editingEvent.in_event_photos?.filter(p => !pendingDeletions.has(p.id)) || []
                          const allSelected = selectedPhotoIds.size === availablePhotos.length && availablePhotos.length > 0
                          handleSelectAll(!allSelected)
                        }}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        disabled={saving}
                      >
                        {editingEvent.in_event_photos && editingEvent.in_event_photos.filter(p => !pendingDeletions.has(p.id)).length > 0 && selectedPhotoIds.size === editingEvent.in_event_photos.filter(p => !pendingDeletions.has(p.id)).length ? (
                          <CheckSquare className="w-4 h-4" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                        <span>Select All</span>
                      </button>
                      {selectedPhotoIds.size > 0 && (
                        <span className="text-sm text-gray-600">
                          {selectedPhotoIds.size} selected
                        </span>
                      )}
                      <span className="text-xs text-gray-500 ml-auto">
                        Keyboard shortcuts: Ctrl+A (select all), Delete (delete selected), Esc (clear)
                      </span>
                    </div>
                    <DndContext
                      sensors={pendingDeletions.size > 0 ? [] : sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        // Use filtered array for drag context (only visible photos can be dragged)
                        // This ensures drag indices match displayed photos
                        items={editingEvent.in_event_photos
                          .filter(p => !pendingDeletions.has(p.id))
                          .map((p) => p.id)}
                        strategy={rectSortingStrategy}
                      >
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                          {editingEvent.in_event_photos
                            .filter(p => !pendingDeletions.has(p.id))
                            .map((photo) => (
                              <SortablePhotoItem
                                key={photo.id}
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
                            ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-500 text-sm border border-dashed border-gray-300 rounded-lg">
                    {pendingDeletions.size > 0 
                      ? "All photos marked for deletion. Click 'Save Changes' to confirm."
                      : "No in-event photos. Click 'Add Photo' to add photos."}
                  </div>
                )}
              </div>

              {/* Pending Changes Summary */}
              {(pendingDeletions.size > 0 || editPosterFile) && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                  <div className="font-semibold text-blue-900 mb-1">Pending Changes:</div>
                  <ul className="list-disc list-inside text-blue-800 space-y-1">
                    {pendingDeletions.size > 0 && (
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
                      setFormKey(prev => prev + 1)
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
                      {pendingDeletions.size > 0 || editPosterFile ? (
                        <>
                          Save Changes
                          {(pendingDeletions.size > 0 || editPosterFile) && (
                            <span className="ml-2 bg-white/20 px-2 py-0.5 rounded text-xs">
                              {[
                                pendingDeletions.size > 0 && `${pendingDeletions.size} deletion${pendingDeletions.size !== 1 ? 's' : ''}`,
                                editPosterFile && 'poster'
                              ].filter(Boolean).join(', ')}
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
          setInEventPhotoFiles([])
          setInEventPhotoPreviews([])
          setUploadProgress({ uploaded: 0, total: 0 })
        }
      }}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add In-Event Photos</DialogTitle>
            <DialogDescription>
              Upload multiple images from your device to add as in-event photos
            </DialogDescription>
          </DialogHeader>
          {editingEvent && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="in-event-photos">Select Images (Multiple files supported)</Label>
                <Input
                  id="in-event-photos"
                  name="in-event-photos"
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploadingPhotos}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || [])
                    setInEventPhotoFiles(files)
                    
                    if (files.length === 0) {
                      setInEventPhotoPreviews([])
                      return
                    }
                    
                    // Create previews asynchronously
                    const previewPromises = files.map((file) => {
                      return new Promise<{ file: File; preview: string }>((resolve) => {
                        const reader = new FileReader()
                        reader.onloadend = () => {
                          resolve({ file, preview: reader.result as string })
                        }
                        reader.readAsDataURL(file)
                      })
                    })
                    
                    Promise.all(previewPromises).then((previews) => {
                      setInEventPhotoPreviews(previews)
                    })
                  }}
                />
                <p className="text-sm text-gray-500 mt-1">
                  You can select multiple images at once. All selected images will be uploaded and added to the event.
                </p>
              </div>

              {uploadingPhotos && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Uploading photos...</span>
                    <span>{uploadProgress.uploaded} / {uploadProgress.total}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(uploadProgress.uploaded / uploadProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {inEventPhotoPreviews.length > 0 && !uploadingPhotos && (
                <div className="space-y-2">
                  <Label>Selected Images ({inEventPhotoPreviews.length})</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 max-h-[400px] overflow-y-auto border border-gray-200 rounded-lg p-4">
                    {inEventPhotoPreviews.map((preview, index) => (
                      <div key={index} className="relative group">
                        <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                          <img
                            src={preview.preview}
                            alt={`Preview ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => {
                            const newFiles = inEventPhotoFiles.filter((_, i) => i !== index)
                            const newPreviews = inEventPhotoPreviews.filter((_, i) => i !== index)
                            setInEventPhotoFiles(newFiles)
                            setInEventPhotoPreviews(newPreviews)
                            // Reset file input
                            const input = document.getElementById("in-event-photos") as HTMLInputElement
                            if (input) {
                              const dataTransfer = new DataTransfer()
                              newFiles.forEach(file => dataTransfer.items.add(file))
                              input.files = dataTransfer.files
                            }
                          }}
                          disabled={uploadingPhotos}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                        <div className="text-xs text-gray-500 mt-1 truncate">
                          {preview.file.name}
                        </div>
                      </div>
                    ))}
                  </div>
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
                  }}
                  disabled={uploadingPhotos}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => handleBulkUploadPhotos(editingEvent.id)}
                  disabled={uploadingPhotos || inEventPhotoFiles.length === 0}
                >
                  {uploadingPhotos ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-1" />
                      Upload {inEventPhotoFiles.length} Photo{inEventPhotoFiles.length !== 1 ? 's' : ''}
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
          const event = events.find(e => e.id === deleteConfirm)
          return event ? event.title : `Event ID: ${deleteConfirm}`
        })() : undefined}
        itemDetails={deleteConfirm ? (() => {
          const event = events.find(e => e.id === deleteConfirm)
          return event ? (
            <div className="space-y-1 text-xs">
              {event.description && (
                <div>
                  <span className="font-medium">Description:</span> {event.description.substring(0, 100)}{event.description.length > 100 ? "..." : ""}
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



