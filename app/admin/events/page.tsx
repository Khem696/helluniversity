"use client"

import React, { useState, useEffect } from "react"
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
import { Plus, Trash2, Edit, Loader2, Calendar, Image as ImageIcon, X, Check, GripVertical } from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { TZDate } from '@date-fns/tz'
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

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      <div className="aspect-square bg-gray-100 rounded overflow-hidden border-2 border-transparent hover:border-blue-300 transition-colors">
        <img
          src={photo.blob_url}
          alt={photo.title || "Event photo"}
          className="w-full h-full object-cover"
        />
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="absolute top-2 left-2 bg-black/50 hover:bg-black/70 text-white p-1 rounded cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical className="w-4 h-4" />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onRemove(eventId, photo.id)}
        disabled={saving}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
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
  
  // Initialize drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
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
  const fetchEventDetails = async (eventId: string) => {
    try {
      const response = await fetch(API_PATHS.adminEvent(eventId))
      const json = await response.json()
      if (json.success) {
        // API returns { success: true, data: { event: {...} } }
        return json.data?.event || json.event || null
      }
    } catch (error) {
      console.error("Failed to fetch event details", error)
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

    // Upload each image file
    for (let i = 0; i < inEventPhotoFiles.length; i++) {
      const file = inEventPhotoFiles[i]
      try {
        const uploadFormData = new FormData()
        uploadFormData.append("file", file)
        uploadFormData.append("title", editingEvent?.title ? `${editingEvent.title} - Photo ${i + 1}` : `Event Photo ${i + 1}`)

        const uploadResponse = await fetch(API_PATHS.adminImages, {
          method: "POST",
          body: uploadFormData,
        })

        const uploadJson = await uploadResponse.json()
        if (uploadJson.success && uploadJson.data?.image?.id) {
          uploadedImageIds.push(uploadJson.data.image.id)
          setUploadProgress({ uploaded: i + 1, total: inEventPhotoFiles.length })
        } else {
          const errorMessage = uploadJson.error?.message || uploadJson.error || `Failed to upload ${file.name}`
          errors.push(errorMessage)
        }
      } catch (error) {
        errors.push(`Failed to upload ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
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
        
        // Refresh event details
        if (editingEvent) {
          const updated = await fetchEventDetails(eventId)
          if (updated) {
            setEditingEvent(updated)
            // Update the event in the list with new photo data
            replaceItem(eventId, updated)
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
    if (!editingEvent) return

    const { active, over } = event

    if (!over || active.id === over.id) {
      return
    }

    const oldIndex = editingEvent.in_event_photos?.findIndex(
      (p) => p.id === active.id
    )
    const newIndex = editingEvent.in_event_photos?.findIndex(
      (p) => p.id === over.id
    )

    if (
      oldIndex === undefined ||
      newIndex === undefined ||
      oldIndex === -1 ||
      newIndex === -1
    ) {
      return
    }

    // Optimistically update UI
    const reorderedPhotos = arrayMove(
      editingEvent.in_event_photos || [],
      oldIndex,
      newIndex
    )

    // Update display_order for all photos
    const updatedPhotos = reorderedPhotos.map((photo, index) => ({
      ...photo,
      display_order: index,
    }))

    // Update local state immediately
    setEditingEvent({
      ...editingEvent,
      in_event_photos: updatedPhotos,
    })

    // Update all photos' display_order in the database
    try {
      const updatePromises = updatedPhotos.map((photo, index) =>
        fetch(API_PATHS.adminEventImage(editingEvent.id, photo.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ display_order: index }),
        })
      )

      const results = await Promise.all(updatePromises)
      const allSuccessful = results.every((res) => res.ok)

      if (allSuccessful) {
        toast.success("Photo order updated successfully")
        // No need to refetch - optimistic update already applied
        // The local state is already updated via setEditingEvent()
        // Only update the event in the list to keep it in sync
        replaceItem(editingEvent.id, {
          ...editingEvent,
          in_event_photos: updatedPhotos,
        })
      } else {
        toast.error("Failed to update photo order")
        // Revert on error - refetch to get correct state from server
        const reverted = await fetchEventDetails(editingEvent.id)
        if (reverted) {
          setEditingEvent(reverted)
          replaceItem(editingEvent.id, reverted)
        }
      }
    } catch (error) {
      console.error("Failed to update photo order:", error)
      toast.error("Failed to update photo order")
      // Revert on error - refetch to get correct state from server
      const reverted = await fetchEventDetails(editingEvent.id)
      if (reverted) {
        setEditingEvent(reverted)
        replaceItem(editingEvent.id, reverted)
      }
    }
  }

  // Remove in-event photo
  const handleRemovePhoto = async (eventId: string, eventImageId: string) => {
    try {
      const response = await fetch(API_PATHS.adminEventImage(eventId, eventImageId), {
        method: "DELETE",
      })

      const json = await response.json()
      if (json.success) {
        toast.success("Photo removed successfully")
        // Refresh event details
        if (editingEvent) {
          const updated = await fetchEventDetails(eventId)
          if (updated) {
            setEditingEvent(updated)
            // Update the event in the list with updated photo data
            replaceItem(eventId, updated)
          }
        }
      } else {
        const errorMessage = json.error?.message || json.error || "Failed to remove photo"
        toast.error(errorMessage)
      }
    } catch (error) {
      toast.error("Failed to remove photo")
      console.error(error)
    }
  }

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
    if (!editingEvent) return

    setSaving(true)
    const formData = new FormData(e.currentTarget)
    const updates: any = {}

    const title = formData.get("title") as string
    const description = formData.get("description") as string
    const eventDate = formData.get("event_date") as string
    const startDate = formData.get("start_date") as string
    const endDate = formData.get("end_date") as string

    // Always include title to prevent NOT NULL constraint errors
    // Only update if it actually changed
    if (title && title.trim() && title !== editingEvent.title) {
      updates.title = title.trim()
    } else if (!title || !title.trim()) {
      // If title is missing or empty, use existing title to prevent constraint violation
      updates.title = editingEvent.title
    }
    if (description !== (editingEvent.description || "")) updates.description = description || null
    
    // Upload new poster image if provided
    let finalImageId: string | null = editingEvent.image_id || null
    if (editPosterFile) {
      try {
        const uploadFormData = new FormData()
        uploadFormData.append("file", editPosterFile)
        uploadFormData.append("title", title || "Event Poster")

        const uploadResponse = await fetch(API_PATHS.adminImages, {
          method: "POST",
          body: uploadFormData,
        })

        const uploadJson = await uploadResponse.json()
        if (uploadJson.success && uploadJson.data?.image?.id) {
          finalImageId = uploadJson.data.image.id
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
    
    if (finalImageId !== (editingEvent.image_id || null)) updates.image_id = finalImageId
    if (eventDate) {
      const timestamp = Math.floor(new Date(eventDate).getTime() / 1000)
      if (timestamp !== editingEvent.event_date) updates.event_date = timestamp
    }
    if (startDate) {
      const timestamp = Math.floor(new Date(startDate).getTime() / 1000)
      if (timestamp !== editingEvent.start_date) updates.start_date = timestamp
    }
    if (endDate) {
      const timestamp = Math.floor(new Date(endDate).getTime() / 1000)
      if (timestamp !== editingEvent.end_date) updates.end_date = timestamp
    }

    if (Object.keys(updates).length === 0) {
      toast.info("No changes to save")
      setSaving(false)
      return
    }

    try {
      // Optimistically update UI first
      updateItem(editingEvent.id, updates as Partial<Event>)
      
      const response = await fetch(API_PATHS.adminEvent(editingEvent.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })

      const json = await response.json()
      if (json.success) {
        const updatedEvent = json.data?.event || json.event
        // Replace with server response (ensures sync)
        if (updatedEvent) {
          replaceItem(editingEvent.id, updatedEvent)
        }
        toast.success("Event updated successfully")
        setEditDialogOpen(false)
        setEditingEvent(null)
        setEditPosterFile(null)
        setEditPosterPreview(null)
        setEditSelectedImageId(null)
      } else {
        // Rollback on error
        fetchEvents()
        const errorMessage = json.error?.message || json.error || "Failed to update event"
        toast.error(errorMessage)
      }
    } catch (error) {
      // Rollback on error
      fetchEvents()
      toast.error("Failed to update event")
      console.error(error)
    } finally {
      setSaving(false)
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

  const formatTimestamp = (timestamp: number | null) => {
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
      
      return format(bangkokDate, "yyyy-MM-dd")
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
                              const eventDetails = await fetchEventDetails(event.id)
                              setEditingEvent(eventDetails || event)
                              setEditSelectedImageId(event.image_id || null)
                              setEditDialogOpen(true)
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
                        const eventDetails = await fetchEventDetails(event.id)
                        setEditingEvent(eventDetails || event)
                        setEditSelectedImageId(event.image_id || null)
                        setEditDialogOpen(true)
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
            <form onSubmit={handleUpdate} className="space-y-6">
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
                {editingEvent.in_event_photos && editingEvent.in_event_photos.length > 0 ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={editingEvent.in_event_photos.map((p) => p.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                        {editingEvent.in_event_photos.map((photo) => (
                          <SortablePhotoItem
                            key={photo.id}
                            photo={photo}
                            eventId={editingEvent.id}
                            onRemove={handleRemovePhoto}
                            saving={saving}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="text-center py-8 text-gray-500 text-sm border border-dashed border-gray-300 rounded-lg">
                    No in-event photos. Click "Add Photo" to add photos.
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditDialogOpen(false)
                    setEditingEvent(null)
                    setEditPosterFile(null)
                    setEditPosterPreview(null)
                    setEditSelectedImageId(null)
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
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
                  <span className="font-medium">Start Date:</span> {format(new Date(event.start_date * 1000), "MMM dd, yyyy")}
                </div>
              )}
              {event.end_date && (
                <div>
                  <span className="font-medium">End Date:</span> {format(new Date(event.end_date * 1000), "MMM dd, yyyy")}
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

