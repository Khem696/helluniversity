"use client"

import { useState, useEffect } from "react"
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
import { Plus, Trash2, Edit, Loader2, Calendar, MapPin, Image as ImageIcon } from "lucide-react"
import { toast } from "sonner"
import { format } from "date-fns"

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
}

export default function EventsPage() {
  const { data: session, status } = useSession()
  const [events, setEvents] = useState<Event[]>([])
  const [images, setImages] = useState<Image[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [addingPhoto, setAddingPhoto] = useState(false)

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      redirect("/admin/login")
    }
  }, [status])

  // Fetch events
  const fetchEvents = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/admin/events?limit=1000")
      const data = await response.json()
      if (data.success) {
        setEvents(data.events)
      } else {
        toast.error(data.error || "Failed to load events")
      }
    } catch (error) {
      toast.error("Failed to load events")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  // Fetch event details with in-event photos
  const fetchEventDetails = async (eventId: string) => {
    try {
      const response = await fetch(`/api/admin/events/${eventId}`)
      const data = await response.json()
      if (data.success) {
        return data.event
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

      const data = await response.json()
      if (data.success) {
        toast.success("Photo added successfully")
        setAddingPhoto(false)
        // Refresh event details
        if (editingEvent) {
          const updated = await fetchEventDetails(eventId)
          if (updated) {
            setEditingEvent(updated)
          }
        }
        fetchEvents()
      } else {
        toast.error(data.error || "Failed to add photo")
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

      const data = await response.json()
      if (data.success) {
        toast.success("Photo removed successfully")
        // Refresh event details
        if (editingEvent) {
          const updated = await fetchEventDetails(eventId)
          if (updated) {
            setEditingEvent(updated)
          }
        }
        fetchEvents()
      } else {
        toast.error(data.error || "Failed to remove photo")
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
      const data = await response.json()
      if (data.success) {
        setImages(data.images)
      }
    } catch (error) {
      console.error("Failed to load images", error)
    }
  }

  useEffect(() => {
    if (session) {
      fetchEvents()
      fetchImages()
    }
  }, [session])

  // Handle event create
  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaving(true)

    const formData = new FormData(e.currentTarget)
    const imageId = formData.get("image_id") as string
    const eventData = {
      title: formData.get("title") as string,
      description: formData.get("description") as string || null,
      image_id: imageId && imageId.trim() ? imageId : null,
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

      const data = await response.json()
      if (data.success) {
        toast.success("Event created successfully")
        setCreateDialogOpen(false)
        e.currentTarget.reset()
        fetchEvents()
      } else {
        toast.error(data.error || "Failed to create event")
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
    const imageId = formData.get("image_id") as string
    const eventDate = formData.get("event_date") as string
    const startDate = formData.get("start_date") as string
    const endDate = formData.get("end_date") as string
    const location = formData.get("location") as string

    if (title !== editingEvent.title) updates.title = title
    if (description !== (editingEvent.description || "")) updates.description = description || null
    const finalImageId = imageId && imageId.trim() ? imageId : null
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
      const response = await fetch(`/api/admin/events/${editingEvent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })

      const data = await response.json()
      if (data.success) {
        toast.success("Event updated successfully")
        setEditDialogOpen(false)
        setEditingEvent(null)
        fetchEvents()
      } else {
        toast.error(data.error || "Failed to update event")
      }
    } catch (error) {
      toast.error("Failed to update event")
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  // Handle event delete
  const handleDelete = async (eventId: string) => {
    try {
      const response = await fetch(`/api/admin/events/${eventId}`, {
        method: "DELETE",
      })

      const data = await response.json()
      if (data.success) {
        toast.success("Event deleted successfully")
        setDeleteConfirm(null)
        fetchEvents()
      } else {
        toast.error(data.error || "Failed to delete event")
      }
    } catch (error) {
      toast.error("Failed to delete event")
      console.error(error)
    }
  }

  const formatTimestamp = (timestamp: number | null) => {
    if (!timestamp) return ""
    return format(new Date(timestamp * 1000), "yyyy-MM-dd")
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
            <form onSubmit={handleCreate} className="space-y-4">
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
                <Select name="image_id" disabled={saving}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an image (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {images.map(img => (
                      <SelectItem key={img.id} value={img.id}>
                        {img.title || img.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <Select name="image_id" defaultValue={editingEvent.image_id || undefined} disabled={saving}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an image (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {images.map(img => (
                      <SelectItem key={img.id} value={img.id}>
                        {img.title || img.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

