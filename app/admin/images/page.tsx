"use client"

import { useState, useEffect, useRef, useMemo } from "react"
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
import { Upload, Edit, Loader2, Image as ImageIcon, ChevronDown, ChevronUp, Globe, Image as ImageIcon2, Trash2, GripVertical, Check, X } from "lucide-react"
import { toast } from "sonner"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useAdminData } from "@/hooks/useAdminData"
import { API_PATHS, buildApiUrl } from "@/lib/api-config"
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

interface Image {
  id: string
  blob_url: string
  title: string | null
  event_info: string | null
  category: string | null
  display_order: number
  ai_selected?: number | boolean
  ai_order?: number | null
  format: string
  width: number
  height: number
  file_size: number
  original_filename: string
  created_at: number
  updated_at: number
}

interface SectionInfo {
  name: string
  description: string
  pageUrl: string
  pageName: string
  icon: string
  categories: string[]
  subCategories?: { name: string; category: string; label: string }[]
}

// Section mapping: webpage sections and their categories
// Note: Event images are now managed in the Admin Events page, so they are excluded here
// Ordered: AI Space Generator (first), Studio Gallery Page (last)
const SECTIONS: SectionInfo[] = [
  {
    name: "AI Space Generator",
    description: "AI-powered space generation tool with studio images",
    pageUrl: "/",
    pageName: "Home Page (AI Space)",
    icon: "🤖",
    categories: ["aispace_studio"],
  },
  {
    name: "Studio Gallery Page",
    description: "Main gallery page showing artwork, building, and gallery images",
    pageUrl: "/studio-gallery",
    pageName: "Studio Gallery",
    icon: "🎨",
    categories: ["artwork_studio", "building_studio", "gallery"],
    subCategories: [
      { name: "Building Studio", category: "building_studio", label: "Building Studio" },
      { name: "Artwork Studio", category: "artwork_studio", label: "Artwork Studio" },
      { name: "Gallery", category: "gallery", label: "Gallery" },
    ],
  },
]

// Sortable image item component
function SortableImageItem({
  image,
  onEdit,
  onDelete,
  onToggleAI,
  isAISpaceSection,
  uploading,
}: {
  image: Image
  onEdit: (image: Image) => void
  onDelete: (image: Image) => void
  onToggleAI: (imageId: string, currentValue: number | boolean | undefined) => void
  isAISpaceSection: boolean
  uploading: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const isSelectedForAI = isAISpaceSection && (image.ai_selected === 1 || image.ai_selected === true)
  const aiOrderNumber = isSelectedForAI && image.ai_order ? image.ai_order : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group bg-gray-50 rounded-lg overflow-hidden hover:shadow-md transition-shadow border ${
        isSelectedForAI
          ? "border-[#5B9AB8] border-2 ring-2 ring-[#5B9AB8]/20"
          : "border-gray-200"
      }`}
    >
      <div className="aspect-video bg-gray-100 relative">
        <img
          src={image.blob_url || ''}
          alt={image.title || "Image"}
          className="w-full h-full object-cover"
          style={{ imageOrientation: 'none' }}
          onError={(e) => {
            console.error("Image failed to load:", {
              id: image.id,
              blob_url: image.blob_url,
              title: image.title
            })
            const target = e.target as HTMLImageElement
            target.style.display = 'none'
            const parent = target.parentElement
            if (parent && !parent.querySelector('.image-error')) {
              const errorDiv = document.createElement('div')
              errorDiv.className = 'image-error absolute inset-0 flex items-center justify-center bg-red-50 border-2 border-red-200'
              errorDiv.innerHTML = `
                <div class="text-center p-2">
                  <p class="text-xs text-red-600 font-semibold">Failed to load</p>
                  <p class="text-xs text-red-500 mt-1 break-all">${image.blob_url ? image.blob_url.substring(0, 30) + '...' : 'No URL'}</p>
                </div>
              `
              parent.appendChild(errorDiv)
            }
          }}
          onLoad={(e) => {
            const target = e.target as HTMLImageElement
            const parent = target.parentElement
            const errorDiv = parent?.querySelector('.image-error')
            if (errorDiv) {
              errorDiv.remove()
            }
          }}
        />
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="absolute top-2 left-2 bg-black/50 hover:bg-black/70 text-white p-1 rounded cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical className="w-4 h-4" />
        </div>
        {/* Order banner - only show for selected AI images, hide for unselected */}
        {isSelectedForAI && aiOrderNumber && (
          <div className="absolute top-2 right-2 bg-[#5B9AB8] text-white px-2 py-1 rounded text-xs font-semibold">
            <span>AI Order: {aiOrderNumber}</span>
          </div>
        )}
        {isSelectedForAI && aiOrderNumber && (
          <div className="absolute bottom-2 left-2 bg-[#5B9AB8] text-white px-2 py-1 rounded text-xs font-semibold">
            <span>AI #{aiOrderNumber}</span>
          </div>
        )}
        {/* Display order badge */}
        <div className="absolute bottom-2 right-2 bg-gray-800/70 text-white px-2 py-1 rounded text-xs">
          Display: {image.display_order}
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-gray-900 truncate">
              {image.title || "Untitled"}
            </h3>
            {image.category && (
              <p className="text-xs text-gray-500 mt-1">{image.category}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAISpaceSection && (
            <button
              onClick={() => onToggleAI(image.id, image.ai_selected)}
              className="flex items-center gap-2 text-sm"
            >
              <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                isSelectedForAI
                  ? "bg-[#5B9AB8] border-[#5B9AB8]"
                  : "bg-white border-gray-300"
              }`}>
                {isSelectedForAI && (
                  <Check className="w-4 h-4 text-white" />
                )}
              </div>
              <span className="text-xs text-gray-600">
                {isSelectedForAI ? "Selected" : "Select for AI"}
              </span>
            </button>
          )}
          <div className="flex gap-1 ml-auto">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(image)}
              disabled={uploading}
            >
              <Edit className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDelete(image)}
              disabled={uploading}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ImagesPage() {
  const { data: session, status } = useSession()
  const [uploading, setUploading] = useState(false)
  
  // Initialize drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const [editingImage, setEditingImage] = useState<Image | null>(null)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [imageToDelete, setImageToDelete] = useState<Image | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(SECTIONS.map(s => s.name)))
  const [viewMode, setViewMode] = useState<"sections" | "grid">("sections")
  const uploadFormRef = useRef<HTMLFormElement>(null)
  const [titleFilter, setTitleFilter] = useState("")
  const [debouncedTitleFilter, setDebouncedTitleFilter] = useState("")
  const [sortBy, setSortBy] = useState<"created_at" | "updated_at" | "display_order" | "title">("display_order")
  const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">("ASC")
  
  // Debounce title search input (500ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTitleFilter(titleFilter)
    }, 500)
    return () => clearTimeout(timer)
  }, [titleFilter])
  
  // Build endpoint with filters (memoized to trigger refetch when filters change)
  const endpoint = useMemo(() => {
    const params = new URLSearchParams()
    params.append("limit", "1000")
    if (categoryFilter !== "all") {
      params.append("category", categoryFilter)
    }
    if (debouncedTitleFilter) {
      params.append("title", debouncedTitleFilter)
    }
    params.append("sortBy", sortBy)
    params.append("sortOrder", sortOrder)
    return buildApiUrl(API_PATHS.adminImages, Object.fromEntries(params))
  }, [categoryFilter, debouncedTitleFilter, sortBy, sortOrder])
  
  // Use useAdminData hook for images with optimistic updates
  const {
    data: images,
    loading,
    fetchData: fetchImages,
    addItem,
    updateItem,
    removeItem,
    replaceItem
  } = useAdminData<Image>({
    endpoint,
    transformResponse: (json) => {
      return Array.isArray(json.data?.images) 
        ? json.data.images 
        : Array.isArray(json.images) 
          ? json.images 
          : []
    },
    isDialogOpen: () => uploadDialogOpen || editDialogOpen || deleteDialogOpen
  })

  // Redirect if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      redirect("/admin/login")
    }
  }, [status])

  // No need for useEffect - useAdminData handles initial fetch

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

      const response = await fetch(API_PATHS.adminImages, {
        method: "POST",
        body: uploadFormData,
      })

      const json = await response.json()
      if (json.success) {
        const newImage = json.data?.image || json.image
        // Optimistically add to list (instant UI update)
        if (newImage) {
          addItem(newImage)
        }
        toast.success("Image uploaded successfully")
        // Reset form before closing dialog (e.currentTarget may be null after dialog closes)
        if (uploadFormRef.current) {
          uploadFormRef.current.reset()
        } else if (e.currentTarget) {
          e.currentTarget.reset()
        }
        setUploadDialogOpen(false)
      } else {
        const errorMessage = json.error?.message || json.error || "Failed to upload image"
        toast.error(errorMessage)
      }
    } catch (error) {
      toast.error("Failed to upload image")
      console.error(error)
    } finally {
      setUploading(false)
    }
  }

  // Handle drag end for image reordering within category
  const handleDragEnd = async (event: DragEndEvent, category: string) => {
    const { active, over } = event

    if (!over || active.id === over.id) {
      return
    }

    // Get all images in this category
    const categoryImages = images.filter((img) => img.category === category)
    const sortedImages = [...categoryImages].sort((a, b) => a.display_order - b.display_order)

    const oldIndex = sortedImages.findIndex((img) => img.id === active.id)
    const newIndex = sortedImages.findIndex((img) => img.id === over.id)

    if (oldIndex === -1 || newIndex === -1) {
      return
    }

    // Optimistically update UI
    const reorderedImages = arrayMove(sortedImages, oldIndex, newIndex)

    // Calculate new display_order for all images
    const updatedImages = reorderedImages.map((img, index) => ({
      ...img,
      display_order: index,
    }))

    // If this is aispace_studio category, also calculate ai_order for selected images
    // This ensures we update both values in a single batch
    if (category === "aispace_studio") {
      const selectedImages = updatedImages
        .filter((img) => img.ai_selected === 1 || img.ai_selected === true)
        .sort((a, b) => a.display_order - b.display_order)

      // Update ai_order in the same batch
      selectedImages.forEach((img, index) => {
        const imgIndex = updatedImages.findIndex((i) => i.id === img.id)
        if (imgIndex !== -1) {
          updatedImages[imgIndex] = {
            ...updatedImages[imgIndex],
            ai_order: index + 1,
          }
        }
      })
    }

    // Update local state immediately with all changes (display_order + ai_order)
    // Single batch update for better performance
    updatedImages.forEach((img) => {
      replaceItem(img.id, img)
    })

    // Update all images in the database
    // For selected aispace_studio images, update both display_order and ai_order in one call
    try {
      const updatePromises = updatedImages.map((img) => {
        const updateBody: { display_order: number; ai_order?: number } = {
          display_order: img.display_order,
        }

        // Include ai_order if this is a selected aispace_studio image
        if (
          category === "aispace_studio" &&
          (img.ai_selected === 1 || img.ai_selected === true) &&
          img.ai_order !== undefined &&
          img.ai_order !== null
        ) {
          updateBody.ai_order = img.ai_order
        }

        return fetch(API_PATHS.adminImage(img.id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateBody),
        })
      })

      const results = await Promise.all(updatePromises)
      const allSuccessful = results.every((res) => res.ok)

      if (allSuccessful) {
        toast.success("Image order updated successfully")
        // No need to refetch - optimistic update already applied
      } else {
        toast.error("Failed to update image order")
        // Revert on error - refetch to get correct state from server
        fetchImages()
      }
    } catch (error) {
      console.error("Failed to update image order:", error)
      toast.error("Failed to update image order")
      // Revert on error - refetch to get correct state from server
      fetchImages()
    }
  }

  // Toggle AI selection for an image with automatic ordering
  const toggleAISelection = async (imageId: string, currentValue: number | boolean | undefined) => {
    try {
      const newValue = !currentValue || currentValue === 0
      const response = await fetch(API_PATHS.adminImageToggleAISelection, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          imageId,
          selected: newValue 
        }),
      })

      const json = await response.json()
      if (json.success) {
        // API returns { success: true, data: { image: {...}, totalSelected: ... } }
        const updatedImage = json.data?.image || json.image
        const totalSelected = json.data?.totalSelected ?? json.totalSelected ?? 0
        
        // Optimistically update the image
        if (updatedImage) {
          replaceItem(imageId, updatedImage)
        }
        
        toast.success(
          newValue 
            ? `Image selected for AI generation (Order: ${totalSelected})` 
            : "Image deselected from AI generation"
        )
      } else {
        const errorMessage = json.error?.message || json.error || "Failed to update image selection"
        toast.error(errorMessage)
      }
    } catch (error) {
      toast.error("Failed to update image selection")
      console.error(error)
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
      // Optimistically update UI first
      updateItem(editingImage.id, updates as Partial<Image>)
      
      const response = await fetch(API_PATHS.adminImage(editingImage.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })

      const json = await response.json()
      if (json.success) {
        const updatedImage = json.data?.image || json.image
        // Replace with server response (ensures sync)
        if (updatedImage) {
          replaceItem(editingImage.id, updatedImage)
        }
        toast.success("Image updated successfully")
        setEditDialogOpen(false)
        setEditingImage(null)
      } else {
        // Rollback on error
        fetchImages()
        const errorMessage = json.error?.message || json.error || "Failed to update image"
        toast.error(errorMessage)
      }
    } catch (error) {
      // Rollback on error
      fetchImages()
      toast.error("Failed to update image")
      console.error(error)
    }
  }

  // Handle delete image - open confirmation dialog
  const handleDelete = (image: Image) => {
    setImageToDelete(image)
    setDeleteDialogOpen(true)
  }

  // Confirm delete image - actually perform the deletion
  const confirmDelete = async () => {
    if (!imageToDelete) return

    try {
      setDeleting(true)
      // Optimistically remove from list
      removeItem(imageToDelete.id)
      
      const response = await fetch(API_PATHS.adminImage(imageToDelete.id), {
        method: "DELETE",
      })
      const json = await response.json()

      if (json.success) {
        toast.success("Image deleted successfully")
        setDeleteDialogOpen(false)
        setImageToDelete(null)
      } else {
        // Rollback on error
        fetchImages()
        const errorMessage = json.error?.message || json.error || "Failed to delete image"
        toast.error(errorMessage)
      }
    } catch (error) {
      // Rollback on error
      fetchImages()
      toast.error("Failed to delete image")
      console.error(error)
    } finally {
      setDeleting(false)
    }
  }

  // Get unique categories
  const categories = Array.from(new Set(images.map(img => img.category).filter(Boolean))) as string[]
  const filteredImages = categoryFilter === "all" 
    ? images 
    : images.filter(img => img.category === categoryFilter)

  // Debug logging for image filtering
  console.log("[ImagesPage] Image filtering:", {
    totalImages: images.length,
    categoryFilter,
    filteredImagesCount: filteredImages.length,
    categories: categories,
    imagesSample: images.slice(0, 3).map(img => ({
      id: img.id,
      category: img.category,
      blob_url: img.blob_url?.substring(0, 50) + '...'
    }))
  })

  // Group images by section
  const imagesBySection = SECTIONS.map(section => {
    const sectionImages = filteredImages
      .filter(img => section.categories.includes(img.category || ""))
      .sort((a, b) => {
        // For AI Space Generator, prioritize selected images and sort by ai_order
        if (section.name === "AI Space Generator") {
          const aSelected = a.ai_selected === 1 || a.ai_selected === true
          const bSelected = b.ai_selected === 1 || b.ai_selected === true
          
          // Selected images first
          if (aSelected && !bSelected) return -1
          if (!aSelected && bSelected) return 1
          
          // If both selected, sort by ai_order
          if (aSelected && bSelected) {
            if (a.ai_order !== null && b.ai_order !== null) {
              return (a.ai_order || 0) - (b.ai_order || 0)
            }
            if (a.ai_order !== null) return -1
            if (b.ai_order !== null) return 1
          }
        }
        
        // Default: Sort by display_order first, then by created_at
        if (a.display_order !== b.display_order) {
          return a.display_order - b.display_order
        }
        return a.created_at - b.created_at
      })

    // If section has sub-categories, group images by sub-category
    if (section.subCategories) {
      const subCategoryGroups = section.subCategories.map(subCat => ({
        ...subCat,
        images: sectionImages
          .filter(img => img.category === subCat.category)
          .sort((a, b) => {
            if (a.display_order !== b.display_order) {
              return a.display_order - b.display_order
            }
            return a.created_at - b.created_at
          }),
      }))
      
      return {
        ...section,
        images: sectionImages,
        subCategoryGroups,
      }
    }

    return {
      ...section,
      images: sectionImages,
    }
  })

  // Debug logging for sections
  console.log("[ImagesPage] Section grouping:", {
    sectionsCount: imagesBySection.length,
    sectionsWithImages: imagesBySection.filter(s => s.images.length > 0).map(s => ({
      name: s.name,
      imageCount: s.images.length,
      categories: s.categories
    }))
  })

  const toggleSection = (sectionName: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(sectionName)) {
      newExpanded.delete(sectionName)
    } else {
      newExpanded.add(sectionName)
    }
    setExpandedSections(newExpanded)
  }

  if (status === "loading" || loading) {
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
      <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2">Image Management</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage uploaded images and their metadata</p>
        </div>
        <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Upload className="w-4 h-4 mr-2" />
              Upload Image
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[95vw] sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Upload New Image</DialogTitle>
              <DialogDescription>
                Upload an image file. It will be converted to WebP format automatically.
              </DialogDescription>
            </DialogHeader>
            <form ref={uploadFormRef} onSubmit={handleUpload} className="space-y-4">
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
                <Select name="category" disabled={uploading} defaultValue="">
                  <SelectTrigger>
                    <SelectValue placeholder="Select category (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="artwork_studio">Artwork Studio</SelectItem>
                    <SelectItem value="building_studio">Building Studio</SelectItem>
                    <SelectItem value="gallery">Gallery</SelectItem>
                    <SelectItem value="aispace_studio">AI Space Studio</SelectItem>
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

      {/* View Mode Toggle, Filters, and Sorting */}
      <div className="mb-6 space-y-4">
        {/* First Row: View Mode and Category Filter */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <div className="flex items-center gap-2 border rounded-lg p-1">
              <Button
                variant={viewMode === "sections" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("sections")}
                className="h-8"
              >
                <ImageIcon2 className="w-4 h-4 mr-2" />
                By Sections
              </Button>
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className="h-8"
              >
                <ImageIcon className="w-4 h-4 mr-2" />
                All Images
              </Button>
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-48 lg:w-64">
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
        </div>
        {/* Second Row: Search, Sort By, Sort Order */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative w-full sm:w-64">
            <Input
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
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="display_order">Display Order</SelectItem>
              <SelectItem value="created_at">Created Date</SelectItem>
              <SelectItem value="updated_at">Updated Date</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as typeof sortOrder)}>
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue placeholder="Order" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ASC">Ascending</SelectItem>
              <SelectItem value="DESC">Descending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Images Display */}
      {filteredImages.length === 0 ? (
        <div className="text-center py-12">
          <ImageIcon className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600">No images found</p>
        </div>
      ) : viewMode === "sections" ? (
        <div className="space-y-6">
          {/* Sections */}
          {imagesBySection.map((section) => {
            if (section.images.length === 0) return null
            
            const isExpanded = expandedSections.has(section.name)
            
            return (
              <Collapsible
                key={section.name}
                open={isExpanded}
                onOpenChange={() => toggleSection(section.name)}
              >
                <div className="bg-white rounded-lg shadow-md border border-gray-200">
                  <CollapsibleTrigger className="w-full">
                    <div className="p-4 hover:bg-gray-50 transition-colors cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{section.icon}</span>
                          <div className="text-left">
                            <h2 className="text-xl font-semibold text-gray-900">
                              {section.name}
                            </h2>
                            <p className="text-sm text-gray-600 mt-1">
                              {section.description}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              <Globe className="w-4 h-4 text-gray-400" />
                              <span className="text-xs text-gray-500">
                                Used on: <span className="font-medium">{section.pageName}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                          <div className="text-left sm:text-right">
                            <div className="text-sm font-semibold text-gray-900">
                              {section.images.length} {section.images.length === 1 ? "image" : "images"}
                            </div>
                            <div className="text-xs text-gray-500">
                              {section.categories.join(", ")}
                            </div>
                            {section.name === "AI Space Generator" && section.images.length > 0 && (
                              <div className="text-xs text-[#5B9AB8] font-semibold mt-1">
                                {section.images.filter((img: Image) => img.ai_selected === 1 || img.ai_selected === true).length} of {section.images.length} selected for AI
                              </div>
                            )}
                          </div>
                          {isExpanded ? (
                            <ChevronUp className="w-5 h-5 text-gray-400 self-end sm:self-auto" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-gray-400 self-end sm:self-auto" />
                          )}
                        </div>
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-4">
                      {/* If section has sub-categories, show them grouped */}
                      {(section as any).subCategoryGroups ? (
                        <div className="space-y-6">
                          {(section as any).subCategoryGroups.map((subCat: any) => {
                            if (subCat.images.length === 0) return null
                            
                            return (
                              <div key={subCat.category} className="space-y-3">
                                <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
                                  <h3 className="text-lg font-semibold text-gray-800">
                                    {subCat.label}
                                  </h3>
                                  <span className="text-sm text-gray-500">
                                    ({subCat.images.length} {subCat.images.length === 1 ? "image" : "images"})
                                  </span>
                                </div>
                                <DndContext
                                  sensors={sensors}
                                  collisionDetection={closestCenter}
                                  onDragEnd={(e) => handleDragEnd(e, subCat.category)}
                                >
                                  <SortableContext
                                    items={subCat.images.map((img: Image) => img.id)}
                                    strategy={rectSortingStrategy}
                                  >
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                      {subCat.images.map((image: Image) => (
                                        <SortableImageItem
                                          key={image.id}
                                          image={image}
                                          onEdit={(img: Image) => {
                                            setEditingImage(img)
                                            setEditDialogOpen(true)
                                          }}
                                          onDelete={handleDelete}
                                          onToggleAI={toggleAISelection}
                                          isAISpaceSection={section.name === "AI Space Generator"}
                                          uploading={uploading}
                                        />
                                      ))}
                                    </div>
                                  </SortableContext>
                                </DndContext>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        /* Default: show all images in grid */
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(e) => {
                            // Get the category from the first image (all images in section should have same category)
                            const category = section.images[0]?.category
                            if (category) {
                              handleDragEnd(e, category)
                            }
                          }}
                        >
                          <SortableContext
                            items={section.images.map((img) => img.id)}
                            strategy={rectSortingStrategy}
                          >
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {section.images.map((image) => {
                                const isAISpaceSection = section.name === "AI Space Generator"
                                return (
                                  <SortableImageItem
                                    key={image.id}
                                    image={image}
                                    onEdit={(img: Image) => {
                                      setEditingImage(img)
                                      setEditDialogOpen(true)
                                    }}
                                    onDelete={handleDelete}
                                    onToggleAI={toggleAISelection}
                                    isAISpaceSection={isAISpaceSection}
                                    uploading={uploading}
                                  />
                                )
                              })}
                            </div>
                          </SortableContext>
                        </DndContext>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            )
          })}

        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredImages.map((image) => {
            // Check if image is selected for AI (aispace_studio category)
            const isSelectedForAI = image.category === "aispace_studio" && (image.ai_selected === 1 || image.ai_selected === true)
            const aiOrderNumber = isSelectedForAI && image.ai_order ? image.ai_order : null
            
            return (
              <div
                key={image.id}
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
              >
                <div className="aspect-video bg-gray-100 relative">
                  <img
                    src={image.blob_url || ''}
                    alt={image.title || "Image"}
                    className="w-full h-full object-cover"
                    style={{ imageOrientation: 'none' }}
                    onError={(e) => {
                      console.error("Image failed to load:", {
                        id: image.id,
                        blob_url: image.blob_url,
                        title: image.title
                      })
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      // Show error placeholder
                      const parent = target.parentElement
                      if (parent && !parent.querySelector('.image-error')) {
                        const errorDiv = document.createElement('div')
                        errorDiv.className = 'image-error absolute inset-0 flex items-center justify-center bg-red-50 border-2 border-red-200'
                        errorDiv.innerHTML = `
                          <div class="text-center p-2">
                            <p class="text-xs text-red-600 font-semibold">Failed to load</p>
                            <p class="text-xs text-red-500 mt-1 break-all">${image.blob_url ? image.blob_url.substring(0, 30) + '...' : 'No URL'}</p>
                          </div>
                        `
                        parent.appendChild(errorDiv)
                      }
                    }}
                    onLoad={(e) => {
                      // Remove any error placeholders when image loads successfully
                      const parent = (e.target as HTMLImageElement).parentElement
                      const errorDiv = parent?.querySelector('.image-error')
                      if (errorDiv) {
                        errorDiv.remove()
                      }
                    }}
                  />
                  {/* Order banner - only show for selected AI images, hide for unselected */}
                  {isSelectedForAI && aiOrderNumber && (
                    <div className="absolute top-2 right-2 bg-[#5B9AB8] text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1 shadow-lg">
                      <span>AI Order: {aiOrderNumber}</span>
                    </div>
                  )}
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
                    className="flex-1"
                    onClick={() => {
                      setEditingImage(image)
                      setEditDialogOpen(true)
                    }}
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                    onClick={() => handleDelete(image)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl">
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
                    <SelectItem value="aispace_studio">AI Space Studio</SelectItem>
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

      {/* Delete Confirmation Dialog */}
      <GenericDeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Image"
        description="Are you sure you want to delete this image? This action cannot be undone."
        itemName={imageToDelete ? (imageToDelete.title || "Untitled Image") : undefined}
        itemDetails={imageToDelete ? (
          <div className="space-y-1 text-xs">
            {imageToDelete.category && (
              <div>
                <span className="inline-block bg-blue-100 text-blue-800 px-2 py-0.5 rounded mr-2">
                  {imageToDelete.category}
                </span>
              </div>
            )}
            <div>
              <span className="font-medium">Dimensions:</span> {imageToDelete.width} × {imageToDelete.height}
            </div>
            {imageToDelete.format && (
              <div>
                <span className="font-medium">Format:</span> {imageToDelete.format}
              </div>
            )}
            {imageToDelete.file_size && (
              <div>
                <span className="font-medium">File Size:</span> {(imageToDelete.file_size / 1024).toFixed(2)} KB
              </div>
            )}
          </div>
        ) : undefined}
        warningMessage="This image will be permanently deleted from storage and the database. This action cannot be undone."
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteDialogOpen(false)
          setImageToDelete(null)
        }}
        isLoading={deleting}
        confirmButtonText="Delete Image"
      />

    </div>
  )
}

