"use client"

import { useState, useEffect, useRef } from "react"
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
import { Upload, Edit, Loader2, Image as ImageIcon, ChevronDown, ChevronUp, Globe, Image as ImageIcon2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

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
// Ordered: Events (top), AI Space Generator (second), Studio Gallery Page (last)
const SECTIONS: SectionInfo[] = [
  {
    name: "Events",
    description: "Event photos and documentation",
    pageUrl: "/events",
    pageName: "Events",
    icon: "📅",
    categories: ["event"],
  },
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

export default function ImagesPage() {
  const { data: session, status } = useSession()
  const [images, setImages] = useState<Image[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
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
      const json = await response.json()
      
      // Enhanced logging to debug response structure
      console.log("[ImagesPage] API Response:", {
        hasSuccess: 'success' in json,
        success: json.success,
        hasData: 'data' in json,
        hasDataImages: json.data && 'images' in json.data,
        hasDirectImages: 'images' in json,
        dataKeys: Object.keys(json),
        dataDataKeys: json.data ? Object.keys(json.data) : undefined
      })
      
      if (json.success) {
        // API returns { success: true, data: { images: [...], pagination: {...} } }
        // Check both possible response structures for compatibility
        const fetchedImages = Array.isArray(json.data?.images) 
          ? json.data.images 
          : Array.isArray(json.images) 
            ? json.images 
            : []
        
        console.log("[ImagesPage] Fetched images:", {
          count: fetchedImages.length,
          sample: fetchedImages.length > 0 ? fetchedImages.slice(0, 3).map((img: Image) => ({
            id: img.id,
            blob_url: img.blob_url,
            title: img.title,
            category: img.category
          })) : []
        })
        
        setImages(fetchedImages)
      } else {
        const errorMessage = json.error?.message || json.error || "Failed to load images"
        toast.error(errorMessage)
        console.error("[ImagesPage] API error:", json)
        // Set to empty array on error to prevent undefined state
        setImages([])
      }
    } catch (error) {
      toast.error("Failed to load images")
      console.error("[ImagesPage] Fetch error:", error)
      // Set to empty array on error to prevent undefined state
      setImages([])
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

      const json = await response.json()
      if (json.success) {
        toast.success("Image uploaded successfully")
        // Reset form before closing dialog (e.currentTarget may be null after dialog closes)
        if (uploadFormRef.current) {
          uploadFormRef.current.reset()
        } else if (e.currentTarget) {
          e.currentTarget.reset()
        }
        setUploadDialogOpen(false)
        fetchImages()
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

  // Toggle AI selection for an image with automatic ordering
  const toggleAISelection = async (imageId: string, currentValue: number | boolean | undefined) => {
    try {
      const newValue = !currentValue || currentValue === 0
      const response = await fetch(`/api/admin/images/toggle-ai-selection`, {
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
        const totalSelected = json.data?.totalSelected ?? json.totalSelected ?? 0
        toast.success(
          newValue 
            ? `Image selected for AI generation (Order: ${totalSelected})` 
            : "Image deselected from AI generation"
        )
        fetchImages()
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
      const response = await fetch(`/api/admin/images/${editingImage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })

      const json = await response.json()
      if (json.success) {
        toast.success("Image updated successfully")
        setEditDialogOpen(false)
        setEditingImage(null)
        fetchImages()
      } else {
        const errorMessage = json.error?.message || json.error || "Failed to update image"
        toast.error(errorMessage)
      }
    } catch (error) {
      toast.error("Failed to update image")
      console.error(error)
    }
  }

  // Delete image handler
  const handleDelete = async (image: Image) => {
    setImageToDelete(image)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!imageToDelete) return

    try {
      setDeleting(true)
      const response = await fetch(`/api/admin/images/${imageToDelete.id}`, {
        method: "DELETE",
      })
      const json = await response.json()

      if (json.success) {
        toast.success("Image deleted successfully")
        setDeleteDialogOpen(false)
        setImageToDelete(null)
        fetchImages() // Refresh the list
      } else {
        const errorMessage = json.error?.message || json.error || "Failed to delete image"
        toast.error(errorMessage)
      }
    } catch (error) {
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

  // Get uncategorized images
  const uncategorizedImages = filteredImages.filter(
    img => !img.category || !SECTIONS.some(s => img.category && s.categories.includes(img.category))
  )

  // Debug logging for sections
  console.log("[ImagesPage] Section grouping:", {
    sectionsCount: imagesBySection.length,
    sectionsWithImages: imagesBySection.filter(s => s.images.length > 0).map(s => ({
      name: s.name,
      imageCount: s.images.length,
      categories: s.categories
    })),
    uncategorizedCount: uncategorizedImages.length
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

      {/* View Mode Toggle and Category Filter */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
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
                        <div className="flex items-center gap-4">
                          <div className="text-right">
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
                            <ChevronUp className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
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
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                  {subCat.images.map((image: Image) => (
                                    <div
                                      key={image.id}
                                      className="bg-gray-50 rounded-lg overflow-hidden hover:shadow-md transition-shadow border border-gray-200"
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
                                        {/* Order banner for sub-category images */}
                                        <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                                          Display: {image.display_order}
                                        </div>
                                      </div>
                                      <div className="p-3">
                                        <h3 className="font-semibold text-gray-900 mb-1 truncate text-sm">
                                          {image.title || "Untitled"}
                                        </h3>
                                        <p className="text-xs text-gray-600 mb-2">
                                          {image.category && (
                                            <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded mr-2">
                                              {image.category}
                                            </span>
                                          )}
                                          <span className="text-gray-500">
                                            {image.width} × {image.height}
                                          </span>
                                        </p>
                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="flex-1"
                                            onClick={() => {
                                              setEditingImage(image)
                                              setEditDialogOpen(true)
                                            }}
                                          >
                                            <Edit className="w-3 h-3 mr-1" />
                                            Edit
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                            onClick={() => handleDelete(image)}
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        /* Default: show all images in grid */
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {section.images.map((image, index) => {
                            // For AI Space Generator section, show selection indicator
                            const isAISpaceSection = section.name === "AI Space Generator"
                            const isSelectedForAI = isAISpaceSection && (image.ai_selected === 1 || image.ai_selected === true)
                            // Use ai_order for display (automatically managed by backend)
                            const aiOrderNumber = isSelectedForAI && image.ai_order ? image.ai_order : null
                            
                            return (
                              <div
                                key={image.id}
                                className={`bg-gray-50 rounded-lg overflow-hidden hover:shadow-md transition-shadow border ${
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
                                  {isSelectedForAI && aiOrderNumber && (
                                    <div className="absolute top-2 left-2 bg-[#5B9AB8] text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1 shadow-lg">
                                      <span>AI #{aiOrderNumber}</span>
                                    </div>
                                  )}
                                  {isAISpaceSection && (
                                    <div 
                                      className="absolute bottom-2 left-2 cursor-pointer"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        toggleAISelection(image.id, image.ai_selected)
                                      }}
                                    >
                                      <div className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                                        isSelectedForAI 
                                          ? "bg-[#5B9AB8] border-[#5B9AB8]" 
                                          : "bg-white border-gray-300"
                                      }`}>
                                        {isSelectedForAI && (
                                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                          </svg>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                <div className="p-3">
                                  <h3 className="font-semibold text-gray-900 mb-1 truncate text-sm">
                                    {image.title || "Untitled"}
                                  </h3>
                                  <p className="text-xs text-gray-600 mb-2">
                                    {image.category && (
                                      <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded mr-2">
                                        {image.category}
                                      </span>
                                    )}
                                    {isSelectedForAI && (
                                      <span className="inline-block bg-[#5B9AB8] text-white text-xs px-2 py-0.5 rounded mr-2 font-semibold">
                                        Selected for AI
                                      </span>
                                    )}
                                    <span className="text-gray-500">
                                      {image.width} × {image.height}
                                    </span>
                                  </p>
                                  <div className="flex gap-2">
                                    {isAISpaceSection && (
                                      <Button
                                        size="sm"
                                        variant={isSelectedForAI ? "default" : "outline"}
                                        className={`flex-1 ${isSelectedForAI ? "bg-[#5B9AB8] hover:bg-[#4d8ea7]" : ""}`}
                                        onClick={() => toggleAISelection(image.id, image.ai_selected)}
                                      >
                                        {isSelectedForAI ? "✓ Selected" : "Select for AI"}
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className={isAISpaceSection ? "flex-1" : "flex-1"}
                                      onClick={() => {
                                        setEditingImage(image)
                                        setEditDialogOpen(true)
                                      }}
                                    >
                                      <Edit className="w-3 h-3 mr-1" />
                                      Edit
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                      onClick={() => handleDelete(image)}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            )
          })}

          {/* Uncategorized Images */}
          {uncategorizedImages.length > 0 && (
            <Collapsible
              open={expandedSections.has("Uncategorized")}
              onOpenChange={() => toggleSection("Uncategorized")}
            >
              <div className="bg-white rounded-lg shadow-md border border-gray-200">
                <CollapsibleTrigger className="w-full">
                  <div className="p-4 hover:bg-gray-50 transition-colors cursor-pointer">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">📁</span>
                        <div className="text-left">
                          <h2 className="text-xl font-semibold text-gray-900">
                            Uncategorized Images
                          </h2>
                          <p className="text-sm text-gray-600 mt-1">
                            Images without a category or not assigned to any section
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-sm font-semibold text-gray-900">
                            {uncategorizedImages.length} {uncategorizedImages.length === 1 ? "image" : "images"}
                          </div>
                        </div>
                        {expandedSections.has("Uncategorized") ? (
                          <ChevronUp className="w-5 h-5 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {uncategorizedImages.map((image) => (
                        <div
                          key={image.id}
                          className="bg-gray-50 rounded-lg overflow-hidden hover:shadow-md transition-shadow border border-gray-200"
                        >
                          <div className="aspect-video bg-gray-100 relative">
                            <img
                              src={image.blob_url || ''}
                              alt={image.title || "Image"}
                              className="w-full h-full object-cover"
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
                          </div>
                          <div className="p-3">
                            <h3 className="font-semibold text-gray-900 mb-1 truncate text-sm">
                              {image.title || "Untitled"}
                            </h3>
                            <p className="text-xs text-gray-600 mb-2">
                              <span className="text-gray-500">
                                {image.width} × {image.height}
                              </span>
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full"
                              onClick={() => {
                                setEditingImage(image)
                                setEditDialogOpen(true)
                              }}
                            >
                              <Edit className="w-3 h-3 mr-1" />
                              Edit
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                    <SelectItem value="aispace_studio">AI Space Studio</SelectItem>
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Image</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this image? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {imageToDelete && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-900 mb-1">
                  {imageToDelete.title || "Untitled Image"}
                </p>
                <p className="text-xs text-gray-600">
                  {imageToDelete.category && (
                    <span className="inline-block bg-blue-100 text-blue-800 px-2 py-0.5 rounded mr-2">
                      {imageToDelete.category}
                    </span>
                  )}
                  {imageToDelete.width} × {imageToDelete.height}
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteDialogOpen(false)
                    setImageToDelete(null)
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={confirmDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}

