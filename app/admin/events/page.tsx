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
import { Plus, Trash2, Edit, Loader2, Calendar, MapPin, Image as ImageIcon, X, Check } from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"
import { TZDate } from '@date-fns/tz'
import { useAdminData } from "@/hooks/useAdminData"

interface Event {
  id: string
  title: string
  description: string | null
  image_id: string | null
  event_date: number | null
  start_date: number | null
  end_date: number | null
  location: string | null
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

export default function EventsPage() {
  const { data: session, status } = useSession()
  const [saving, setSaving] = useState(false)
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
  const createFormRef = React.useRef<HTMLFormElement>(null)
  
  // Use useAdminData hook for events with optimistic updates
  const {
    data: events,
    loading,
    fetchData: fetchEvents,
    addItem,
    updateItem,
    removeItem,
    replaceItem
  } = useAdminData<Event>({
    endpoint: "/api/admin/events?limit=1000",
    transformResponse: (json) => {
      return Array.isArray(json.data?.events) 
        ? json.data.events 
        : Array.isArray(json.events) 
          ? json.events 
          : []
    },
    isDialogOpen: () => createDialogOpen || editDialogOpen,
    enablePolling: true,
    pollInterval: 30000
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
      const response = await fetch(`/api/admin/events/${eventId}`)
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

  // Add in-event photo
  const handleAddPhoto = async (eventId: string, imageId: string) => {
    try {
      const response = await fetch(`/api/admin/events/${eventId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_id: imageId,
          image_type: "in_event",
        }),
      })

      const json = await response.json()
      if (json.success) {
        toast.success("Photo added successfully")
        setAddingPhoto(false)
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
        const errorMessage = json.error?.message || json.error || "Failed to add photo"
        toast.error(errorMessage)
      }
    } catch (error) {
      toast.error("Failed to add photo")
      console.error(error)
    }
  }

  // Remove in-event photo
  const handleRemovePhoto = async (eventId: string, eventImageId: string) => {
    try {
      const response = await fetch(`/api/admin/events/${eventId}/images/${eventImageId}`, {
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
      const response = await fetch("/api/admin/images?limit=1000")
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
    const eventData = {
      title: formData.get("title") as string,
      description: formData.get("description") as string || null,
      image_id: selectedImageId && selectedImageId.trim() ? selectedImageId : null,
      event_date: formData.get("event_date") as string || null,
      start_date: formData.get("start_date") as string || null,
      end_date: formData.get("end_date") as string || null,
      location: formData.get("location") as string || null,
    }

    try {
      const response = await fetch("/api/admin/events", {
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
    const location = formData.get("location") as string

    if (title !== editingEvent.title) updates.title = title
    if (description !== (editingEvent.description || "")) updates.description = description || null
    const finalImageId = editSelectedImageId && editSelectedImageId.trim() ? editSelectedImageId : null
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
    if (location !== (editingEvent.location || "")) updates.location = location || null

    if (Object.keys(updates).length === 0) {
      toast.info("No changes to save")
      setSaving(false)
      return
    }

    try {
      // Optimistically update UI first
      updateItem(editingEvent.id, updates as Partial<Event>)
      
      const response = await fetch(`/api/admin/events/${editingEvent.id}`, {
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

  // Handle event delete
  const handleDelete = async (eventId: string) => {
    try {
      // Optimistically remove from list
      removeItem(eventId)
      
      const response = await fetch(`/api/admin/events/${eventId}`, {
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

  if (status === "loading" || loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Event Management</h1>
          <p className="text-gray-600">Manage events and their information</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Event
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                <Label htmlFor="create-image_id">Poster Image</Label>
                <Popover open={createImageOpen} onOpenChange={setCreateImageOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={createImageOpen}
                      className="w-full justify-between"
                      disabled={saving}
                    >
                      {selectedImageId ? (
                        <div className="flex items-center gap-2">
                          <img
                            src={images.find(img => img.id === selectedImageId)?.blob_url || ""}
                            alt={images.find(img => img.id === selectedImageId)?.title || ""}
                            className="h-8 w-8 rounded object-cover"
                          />
                          <span className="truncate">
                            {images.find(img => img.id === selectedImageId)?.title || selectedImageId}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Select an image (optional)</span>
                      )}
                      <X className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search images..." />
                      <CommandList>
                        <CommandEmpty>No images found.</CommandEmpty>
                        <CommandGroup>
                          {images
                            .filter(img => img.category === "event")
                            .map((img) => (
                              <CommandItem
                                key={img.id}
                                value={`${img.title || ""} ${img.id}`}
                                onSelect={() => {
                                  setSelectedImageId(img.id === selectedImageId ? null : img.id)
                                  setCreateImageOpen(false)
                                }}
                                className="flex items-center gap-2"
                              >
                                <Check
                                  className={`h-4 w-4 ${selectedImageId === img.id ? "opacity-100" : "opacity-0"}`}
                                />
                                <img
                                  src={img.blob_url}
                                  alt={img.title || "Event image"}
                                  className="h-16 w-16 rounded object-cover"
                                />
                                <span className="flex-1 truncate">{img.title || img.id}</span>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {selectedImageId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setSelectedImageId(null)}
                    disabled={saving}
                  >
                    Clear selection
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
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
              <div>
                <Label htmlFor="create-location">Location</Label>
                <Input
                  id="create-location"
                  name="location"
                  type="text"
                  placeholder="Event location"
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

      {/* Events List */}
      {events.length === 0 ? (
        <div className="text-center py-12">
          <Calendar className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No events found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {events.map((event) => (
            <div
              key={event.id}
              className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
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
                <h3 className="font-semibold text-gray-900 mb-2">{event.title}</h3>
                {event.description && (
                  <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                    {event.description}
                  </p>
                )}
                <div className="space-y-1 text-sm text-gray-500 mb-4">
                  {event.start_date && (
                    <div className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      <span>{formatTimestamp(event.start_date)}</span>
                      {event.end_date && event.end_date !== event.start_date && (
                        <span> - {formatTimestamp(event.end_date)}</span>
                      )}
                    </div>
                  )}
                  {event.location && (
                    <div className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      <span>{event.location}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const eventDetails = await fetchEventDetails(event.id)
                      setEditingEvent(eventDetails || event)
                      setEditDialogOpen(true)
                    }}
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteConfirm(event.id)}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Event</DialogTitle>
            <DialogDescription>
              Update event details
            </DialogDescription>
          </DialogHeader>
          {editingEvent && (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <Label htmlFor="edit-title">Title *</Label>
                <Input
                  id="edit-title"
                  name="title"
                  type="text"
                  defaultValue={editingEvent.title}
                  required
                  disabled={saving}
                />
              </div>
              <div>
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  name="description"
                  defaultValue={editingEvent.description || ""}
                  rows={4}
                  disabled={saving}
                />
              </div>
              <div>
                <Label htmlFor="edit-image_id">Poster Image</Label>
                <Popover open={editImageOpen} onOpenChange={setEditImageOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={editImageOpen}
                      className="w-full justify-between"
                      disabled={saving}
                    >
                      {editSelectedImageId ? (
                        <div className="flex items-center gap-2">
                          <img
                            src={images.find(img => img.id === editSelectedImageId)?.blob_url || ""}
                            alt={images.find(img => img.id === editSelectedImageId)?.title || ""}
                            className="h-8 w-8 rounded object-cover"
                          />
                          <span className="truncate">
                            {images.find(img => img.id === editSelectedImageId)?.title || editSelectedImageId}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Select an image (optional)</span>
                      )}
                      <X className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search images..." />
                      <CommandList>
                        <CommandEmpty>No images found.</CommandEmpty>
                        <CommandGroup>
                          {images
                            .filter(img => img.category === "event")
                            .map((img) => (
                              <CommandItem
                                key={img.id}
                                value={`${img.title || ""} ${img.id}`}
                                onSelect={() => {
                                  setEditSelectedImageId(img.id === editSelectedImageId ? null : img.id)
                                  setEditImageOpen(false)
                                }}
                                className="flex items-center gap-2"
                              >
                                <Check
                                  className={`h-4 w-4 ${editSelectedImageId === img.id ? "opacity-100" : "opacity-0"}`}
                                />
                                <img
                                  src={img.blob_url}
                                  alt={img.title || "Event image"}
                                  className="h-16 w-16 rounded object-cover"
                                />
                                <span className="flex-1 truncate">{img.title || img.id}</span>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {editSelectedImageId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setEditSelectedImageId(null)}
                    disabled={saving}
                  >
                    Clear selection
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
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
              <div>
                <Label htmlFor="edit-location">Location</Label>
                <Input
                  id="edit-location"
                  name="location"
                  type="text"
                  defaultValue={editingEvent.location || ""}
                  disabled={saving}
                />
              </div>

              {/* In-Event Photos Management */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-base font-semibold">In-Event Photos</Label>
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
                  <div className="grid grid-cols-3 gap-3">
                    {editingEvent.in_event_photos.map((photo) => (
                      <div key={photo.id} className="relative group">
                        <div className="aspect-square bg-gray-100 rounded overflow-hidden">
                          <img
                            src={photo.blob_url}
                            alt={photo.title || "Event photo"}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleRemovePhoto(editingEvent.id, photo.id)}
                          disabled={saving}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                        <div className="text-xs text-gray-500 mt-1 text-center">
                          Order: {photo.display_order}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    No in-event photos. Click "Add Photo" to add photos.
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditDialogOpen(false)
                    setEditingEvent(null)
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
      <Dialog open={addingPhoto} onOpenChange={setAddingPhoto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add In-Event Photo</DialogTitle>
            <DialogDescription>
              Select an image to add as an in-event photo
            </DialogDescription>
          </DialogHeader>
          {editingEvent && (
            <div className="space-y-4">
              <Select
                onValueChange={(imageId) => {
                  handleAddPhoto(editingEvent.id, imageId)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an image" />
                </SelectTrigger>
                <SelectContent>
                  {images
                    .filter(img => !editingEvent.in_event_photos?.some(p => p.image_id === img.id))
                    .map(img => (
                      <SelectItem key={img.id} value={img.id}>
                        {img.title || img.id}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {images.filter(img => !editingEvent.in_event_photos?.some(p => p.image_id === img.id)).length === 0 && (
                <p className="text-sm text-gray-500">All available images are already added to this event.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Delete</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this event? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDelete(deleteConfirm)}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

