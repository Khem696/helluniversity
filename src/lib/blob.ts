import { put, del, list, head } from "@vercel/blob"
import { getTursoClient } from "./turso"

/**
 * Vercel Blob Storage Utilities
 * 
 * Handles image storage in Vercel Blob Storage.
 * Images are stored with metadata in Turso SQLite.
 * 
 * Environment Variables:
 * - BLOB_READ_WRITE_TOKEN: Vercel Blob Storage token (auto-set in Vercel)
 */

/**
 * Upload an image to Vercel Blob Storage
 */
export async function uploadImage(
  file: File | Buffer,
  filename: string,
  options?: {
    contentType?: string
    addRandomSuffix?: boolean
  }
): Promise<{ url: string; pathname: string }> {
  try {
    const blob = await put(filename, file, {
      access: "public",
      contentType: options?.contentType || "image/webp",
      addRandomSuffix: options?.addRandomSuffix ?? true,
    })

    return {
      url: blob.url,
      pathname: blob.pathname,
    }
  } catch (error) {
    console.error("Blob upload error:", error)
    throw new Error(
      `Failed to upload image: ${error instanceof Error ? error.message : "Unknown error"}`
    )
  }
}

/**
 * Delete an image from Vercel Blob Storage
 */
export async function deleteImage(url: string): Promise<void> {
  try {
    await del(url)
  } catch (error) {
    console.error("Blob delete error:", error)
    throw new Error(
      `Failed to delete image: ${error instanceof Error ? error.message : "Unknown error"}`
    )
  }
}

/**
 * Check if an image exists in Blob Storage
 */
export async function imageExists(url: string): Promise<boolean> {
  try {
    await head(url)
    return true
  } catch (error) {
    return false
  }
}

/**
 * Verify if a blob URL exists in Blob Storage
 * Used for verifying deposit evidence URLs before archive restoration
 */
export async function verifyBlobExists(blobUrl: string): Promise<boolean> {
  try {
    if (!blobUrl || typeof blobUrl !== 'string' || blobUrl.trim() === '') {
      return false
    }
    
    // Use HEAD request to check if blob exists without downloading
    await head(blobUrl)
    return true
  } catch (error) {
    // Blob doesn't exist or URL is invalid
    return false
  }
}

/**
 * List images in Blob Storage (with pagination)
 */
export async function listImages(options?: {
  prefix?: string
  limit?: number
  cursor?: string
}) {
  try {
    return await list({
      prefix: options?.prefix,
      limit: options?.limit || 100,
      cursor: options?.cursor,
    })
  } catch (error) {
    console.error("Blob list error:", error)
    throw new Error(
      `Failed to list images: ${error instanceof Error ? error.message : "Unknown error"}`
    )
  }
}

/**
 * Delete image from both Blob Storage and database
 */
export async function deleteImageWithMetadata(imageId: string): Promise<void> {
  const db = getTursoClient()

  try {
    // Get image URL from database
    const result = await db.execute({
      sql: "SELECT blob_url FROM images WHERE id = ?",
      args: [imageId],
    })

    if (result.rows.length === 0) {
      throw new Error(`Image with id ${imageId} not found`)
    }

    const blobUrl = (result.rows[0] as any).blob_url

    // Delete from Blob Storage
    if (blobUrl) {
      await deleteImage(blobUrl)
    }

    // Delete from database
    await db.execute({
      sql: "DELETE FROM images WHERE id = ?",
      args: [imageId],
    })
  } catch (error) {
    console.error("Delete image with metadata error:", error)
    throw error
  }
}


