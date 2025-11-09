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
import { Upload, Edit, Loader2, Image as ImageIcon } from "lucide-react"
import { toast } from "sonner"

interface Image {
  id: string
  blob_url: string
  title: string | null
  event_info: string | null
  category: string | null
  display_order: number
  format: string
  width: number
  height: number
  file_size: number
  original_filename: string
  created_at: number
  updated_at: number
}

export default function ImagesPage() {
  const { data: session, status } = useSession()
  const [images, setImages] = useState<Image[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [editingImage, setEditingImage] = useState<Image | null>(null)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>("all")

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      redirect("/admin/login")
    }
  }, [status])

  // Fetch images
  const fetchImages = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/admin/images?limit=1000")
      const data = await response.json()
      if (data.success) {
        setImages(data.images)
      } else {
        toast.error(data.error || "Failed to load images")
      }
    } catch (error) {
      toast.error("Failed to load images")
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) {
      fetchImages()
    }
  }, [session])

  // Handle image upload
  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const file = formData.get("file") as File

    if (!file) {
      toast.error("Please select a file")
      return
    }

    setUploading(true)
    try {
      const uploadFormData = new FormData()
      uploadFormData.append("file", file)
      uploadFormData.append("title", formData.get("title") as string || "")
      uploadFormData.append("event_info", formData.get("event_info") as string || "")
      const category = formData.get("category") as string
      if (category) {
        uploadFormData.append("category", category)
      }

      const response = await fetch("/api/admin/images", {
        method: "POST",
        body: uploadFormData,
      })

      const data = await response.json()
      if (data.success) {
        toast.success("Image uploaded successfully")
        setUploadDialogOpen(false)
        e.currentTarget.reset()
        fetchImages()
      } else {
        toast.error(data.error || "Failed to upload image")
      }
    } catch (error) {
      toast.error("Failed to upload image")
      console.error(error)
    } finally {
      setUploading(false)
    }
  }

  // Handle image update
  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingImage) return

    const formData = new FormData(e.currentTarget)
    const updates: any = {}

    const title = formData.get("title") as string
    const eventInfo = formData.get("event_info") as string
    const category = formData.get("category") as string
    const displayOrder = formData.get("display_order") as string

    if (title !== editingImage.title) updates.title = title || null
    if (eventInfo !== editingImage.event_info) updates.event_info = eventInfo || null
    if (category !== editingImage.category) updates.category = category || null
    if (displayOrder !== String(editingImage.display_order)) {
      updates.display_order = parseInt(displayOrder) || 0
    }

    if (Object.keys(updates).length === 0) {
      toast.info("No changes to save")
      return
    }

    try {
      const response = await fetch(`/api/admin/images/${editingImage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })

      const data = await response.json()
      if (data.success) {
        toast.success("Image updated successfully")
        setEditDialogOpen(false)
        setEditingImage(null)
        fetchImages()
      } else {
        toast.error(data.error || "Failed to update image")
      }
    } catch (error) {
      toast.error("Failed to update image")
      console.error(error)
    }
  }

  // Note: Delete functionality not available - no DELETE endpoint exists

  // Get unique categories
  const categories = Array.from(new Set(images.map(img => img.category).filter(Boolean))) as string[]
  const filteredImages = categoryFilter === "all" 
    ? images 
    : images.filter(img => img.category === categoryFilter)

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
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Image Management</h1>
          <p className="text-gray-600">Manage uploaded images and their metadata</p>
        </div>
        <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Upload className="w-4 h-4 mr-2" />
              Upload Image
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Upload New Image</DialogTitle>
              <DialogDescription>
                Upload an image file. It will be converted to WebP format automatically.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <Label htmlFor="file">Image File *</Label>
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept="image/*"
                  required
                  disabled={uploading}
                />
              </div>
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  name="title"
                  type="text"
                  placeholder="Image title"
                  disabled={uploading}
                />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Select name="category" disabled={uploading}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="artwork_studio">Artwork Studio</SelectItem>
                    <SelectItem value="building_studio">Building Studio</SelectItem>
                    <SelectItem value="gallery">Gallery</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="poem">Poem</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="event_info">Event Information</Label>
                <Textarea
                  id="event_info"
                  name="event_info"
                  placeholder="Additional event information"
                  disabled={uploading}
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setUploadDialogOpen(false)}
                  disabled={uploading}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={uploading}>
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    "Upload"
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Category Filter */}
      <div className="mb-6">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Images Grid */}
      {filteredImages.length === 0 ? (
        <div className="text-center py-12">
          <ImageIcon className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No images found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredImages.map((image) => (
            <div
              key={image.id}
              className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
            >
              <div className="aspect-video bg-gray-100 relative">
                <img
                  src={image.blob_url}
                  alt={image.title || "Image"}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 mb-1 truncate">
                  {image.title || "Untitled"}
                </h3>
                <p className="text-sm text-gray-600 mb-2">
                  {image.category && (
                    <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded mr-2">
                      {image.category}
                    </span>
                  )}
                  <span className="text-gray-500">
                    {image.width} × {image.height}
                  </span>
                </p>
                <div className="flex gap-2 mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingImage(image)
                      setEditDialogOpen(true)
                    }}
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Image</DialogTitle>
            <DialogDescription>
              Update image metadata
            </DialogDescription>
          </DialogHeader>
          {editingImage && (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  name="title"
                  type="text"
                  defaultValue={editingImage.title || ""}
                />
              </div>
              <div>
                <Label htmlFor="edit-category">Category</Label>
                <Select name="category" defaultValue={editingImage.category || undefined}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="artwork_studio">Artwork Studio</SelectItem>
                    <SelectItem value="building_studio">Building Studio</SelectItem>
                    <SelectItem value="gallery">Gallery</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="poem">Poem</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-display_order">Display Order</Label>
                <Input
                  id="edit-display_order"
                  name="display_order"
                  type="number"
                  defaultValue={editingImage.display_order}
                />
              </div>
              <div>
                <Label htmlFor="edit-event_info">Event Information</Label>
                <Textarea
                  id="edit-event_info"
                  name="event_info"
                  defaultValue={editingImage.event_info || ""}
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditDialogOpen(false)
                    setEditingImage(null)
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit">Save Changes</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}

