import { NextResponse } from "next/server"
import { readdir, readFile, stat } from "fs/promises"
import { join, relative } from "path"
import { existsSync } from "fs"
import { getTursoClient } from "@/lib/turso"
import { processAndUploadImage } from "@/lib/image-processor"
import { requireAuthorizedDomain, unauthorizedResponse, forbiddenResponse } from "@/lib/auth"
import { randomUUID } from "crypto"

/**
 * Image Migration Route
 * 
 * Migrates static images from public folder to Vercel Blob Storage
 * 
 * POST /api/admin/migrate-images
 * - Scans public/assets and public/aispaces/studio directories
 * - Uploads images to Vercel Blob Storage
 * - Saves metadata to Turso database
 * - Requires Google Workspace authentication
 * 
 * Query parameters:
 * - dryRun: If true, only scans and reports without uploading (default: false)
 * - category: Migrate specific category only (optional)
 */

interface ImageFile {
  path: string
  publicPath: string
  category: string | null
  filename: string
  fullPath: string
}

// Map directory paths to database categories
const CATEGORY_MAP: Record<string, string> = {
  "artwork_studio": "artwork_studio",
  "building_studio": "building_studio",
  "gallery": "gallery",
  "aispaces/studio": "aispace_studio",
  "event": "event",
}

// Directories to skip (like icons, thumbnails, etc.)
const SKIP_DIRECTORIES = ["icons", "thumbnails", "poem"]

// Image file extensions to process
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".JPG", ".JPEG", ".PNG", ".WEBP"]

async function scanDirectory(
  dirPath: string,
  publicBasePath: string,
  category: string | null = null
): Promise<ImageFile[]> {
  const images: ImageFile[] = []

  if (!existsSync(dirPath)) {
    return images
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      const publicPath = `${publicBasePath}/${entry.name}`

      if (entry.isDirectory()) {
        // Skip certain directories
        if (SKIP_DIRECTORIES.includes(entry.name)) {
          continue
        }

        // Determine category from directory name
        let dirCategory = category
        if (!dirCategory) {
          // Check if this directory maps to a category
          const relativePath = fullPath.replace(process.cwd() + "/public/", "")
          dirCategory = CATEGORY_MAP[relativePath] || null
        }

        // Recursively scan subdirectories
        const subImages = await scanDirectory(fullPath, publicPath, dirCategory)
        images.push(...subImages)
      } else if (entry.isFile()) {
        // Check if it's an image file
        const ext = entry.name.substring(entry.name.lastIndexOf("."))
        if (IMAGE_EXTENSIONS.includes(ext)) {
          // Determine category
          let fileCategory = category
          // Get relative path from public directory (cross-platform)
          const publicDirPath = join(process.cwd(), "public")
          const relativePath = relative(publicDirPath, fullPath).replace(/\\/g, "/")
          
          if (!fileCategory) {
            // Check parent directory
            for (const [dirPattern, cat] of Object.entries(CATEGORY_MAP)) {
              if (relativePath.includes(dirPattern.replace(/\\/g, "/"))) {
                fileCategory = cat
                break
              }
            }
          }

          images.push({
            path: relativePath,
            publicPath: publicPath,
            category: fileCategory,
            filename: entry.name,
            fullPath: fullPath,
          })
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error)
  }

  return images
}

async function imageAlreadyMigrated(
  db: any,
  publicPath: string,
  filename: string
): Promise<boolean> {
  try {
    // Check if image with this original filename or path already exists
    const result = await db.execute({
      sql: `
        SELECT id FROM images 
        WHERE original_filename = ? OR blob_url LIKE ?
      `,
      args: [filename, `%${filename}%`],
    })
    return result.rows.length > 0
  } catch (error) {
    console.error("Error checking if image exists:", error)
    return false
  }
}

export async function POST(request: Request) {
  try {
    // Check authentication and authorization
    try {
      await requireAuthorizedDomain()
    } catch (error) {
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        return unauthorizedResponse("Authentication required")
      }
      return forbiddenResponse("Access denied: Must be from authorized Google Workspace domain")
    }

    const { searchParams } = new URL(request.url)
    const dryRun = searchParams.get("dryRun") === "true"
    const categoryFilter = searchParams.get("category")

    // Scan directories
    const publicDir = join(process.cwd(), "public")
    const imagesToMigrate: ImageFile[] = []

    // Scan assets directory
    const assetsDir = join(publicDir, "assets")
    const assetsImages = await scanDirectory(assetsDir, "/assets")
    imagesToMigrate.push(...assetsImages)

    // Scan aispaces/studio directory
    const studioDir = join(publicDir, "aispaces", "studio")
    const studioImages = await scanDirectory(studioDir, "/aispaces/studio")
    imagesToMigrate.push(...studioImages)

    // Filter by category if specified
    const filteredImages = categoryFilter
      ? imagesToMigrate.filter((img) => img.category === categoryFilter)
      : imagesToMigrate

    if (filteredImages.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No images found to migrate",
        stats: {
          total: 0,
          migrated: 0,
          skipped: 0,
          failed: 0,
        },
      })
    }

    if (dryRun) {
      // Return scan results without migrating
      const byCategory: Record<string, number> = {}
      filteredImages.forEach((img) => {
        const cat = img.category || "uncategorized"
        byCategory[cat] = (byCategory[cat] || 0) + 1
      })

      return NextResponse.json({
        success: true,
        message: `Dry run: Found ${filteredImages.length} images to migrate`,
        dryRun: true,
        images: filteredImages.map((img) => ({
          path: img.publicPath,
          category: img.category,
          filename: img.filename,
        })),
        stats: {
          total: filteredImages.length,
          byCategory,
        },
      })
    }

    // Perform migration
    const db = getTursoClient()
    const results = {
      migrated: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    }

    for (const imageFile of filteredImages) {
      try {
        // Check if already migrated
        const alreadyMigrated = await imageAlreadyMigrated(
          db,
          imageFile.publicPath,
          imageFile.filename
        )

        if (alreadyMigrated) {
          results.skipped++
          continue
        }

        // Read file
        const fileBuffer = await readFile(imageFile.fullPath)
        const fileStat = await stat(imageFile.fullPath)

        // Process and upload image
        const processed = await processAndUploadImage(
          fileBuffer,
          imageFile.filename,
          {
            maxWidth: 1920,
            maxHeight: 1920,
            quality: 85,
            format: "webp",
          }
        )

        // Save to database
        const imageId = randomUUID()
        const now = Math.floor(Date.now() / 1000)

        // Get max display_order for this category
        let displayOrder = 0
        if (imageFile.category) {
          const maxResult = await db.execute({
            sql: `SELECT COALESCE(MAX(display_order), -1) + 1 as next_order FROM images WHERE category = ?`,
            args: [imageFile.category],
          })
          displayOrder = (maxResult.rows[0] as any).next_order
        }

        await db.execute({
          sql: `
            INSERT INTO images (
              id, blob_url, title, event_info, category, display_order, format, 
              width, height, file_size, original_filename, 
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [
            imageId,
            processed.url,
            imageFile.filename.replace(/\.[^/.]+$/, ""), // Title from filename
            null, // event_info
            imageFile.category,
            displayOrder,
            processed.format,
            processed.width,
            processed.height,
            processed.fileSize,
            imageFile.filename,
            now,
            now,
          ],
        })

        results.migrated++
      } catch (error) {
        results.failed++
        const errorMsg = `Failed to migrate ${imageFile.filename}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
        results.errors.push(errorMsg)
        console.error(errorMsg, error)
      }
    }

    return NextResponse.json({
      success: true,
      message: `Migration completed: ${results.migrated} migrated, ${results.skipped} skipped, ${results.failed} failed`,
      stats: {
        total: filteredImages.length,
        migrated: results.migrated,
        skipped: results.skipped,
        failed: results.failed,
      },
      errors: results.errors.length > 0 ? results.errors : undefined,
    })
  } catch (error) {
    console.error("Image migration error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to migrate images",
      },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint to check migration status
 */
export async function GET() {
  try {
    const db = getTursoClient()

    // Count images by category
    const categoryResult = await db.execute({
      sql: `
        SELECT category, COUNT(*) as count 
        FROM images 
        WHERE category IS NOT NULL
        GROUP BY category
      `,
    })

    const byCategory: Record<string, number> = {}
    categoryResult.rows.forEach((row: any) => {
      byCategory[row.category] = row.count
    })

    // Total count
    const totalResult = await db.execute({
      sql: `SELECT COUNT(*) as count FROM images`,
    })
    const total = (totalResult.rows[0] as any).count

    return NextResponse.json({
      success: true,
      stats: {
        total,
        byCategory,
      },
    })
  } catch (error) {
    console.error("Migration status check error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to check migration status",
      },
      { status: 500 }
    )
  }
}

