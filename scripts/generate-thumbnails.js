/**
 * Build-time script to generate optimized thumbnails for studio images
 * 
 * This script:
 * 1. Scans public/aispaces/studio/ for images
 * 2. Generates optimized WebP thumbnails (280x280px)
 * 3. Stores them in public/aispaces/studio/thumbnails/
 * 4. Creates a manifest mapping original images to thumbnails
 * 
 * Thumbnails are used in static export mode where API routes are unavailable.
 */

const sharp = require('sharp')
const { readdir, mkdir, writeFile } = require('fs/promises')
const { join } = require('path')
const { existsSync } = require('fs')

const THUMBNAIL_WIDTH = 280
const THUMBNAIL_HEIGHT = 280
const THUMBNAIL_QUALITY = 80

async function generateThumbnails() {
  try {
    const studioDir = join(process.cwd(), 'public', 'aispaces', 'studio')
    const thumbnailsDir = join(studioDir, 'thumbnails')
    const manifestPath = join(process.cwd(), 'public', 'aispaces', 'studio-thumbnails.json')
    
    // Check if studio directory exists
    if (!existsSync(studioDir)) {
      console.warn(`Warning: Studio directory not found at ${studioDir}`)
      // Write empty manifest
      await writeFile(manifestPath, JSON.stringify({ success: true, thumbnails: {}, count: 0 }, null, 2))
      console.log('Generated empty thumbnail manifest')
      return
    }

    // Create thumbnails directory if it doesn't exist
    if (!existsSync(thumbnailsDir)) {
      await mkdir(thumbnailsDir, { recursive: true })
      console.log(`Created thumbnails directory: ${thumbnailsDir}`)
    }

    // Read directory contents
    const files = await readdir(studioDir)
    
    // Filter for image files (exclude thumbnails directory)
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.JPG', '.JPEG', '.PNG', '.WEBP']
    const imageFiles = files
      .filter(file => {
        const ext = file.substring(file.lastIndexOf('.'))
        return imageExtensions.includes(ext) && file !== 'thumbnails'
      })
      .sort((a, b) => {
        // Natural sort: extract numbers and compare
        const numA = parseInt(a.match(/\d+/)?.[0] || '0')
        const numB = parseInt(b.match(/\d+/)?.[0] || '0')
        return numA - numB
      })

    console.log(`\n📸 Processing ${imageFiles.length} image(s)...\n`)

    const thumbnailMap = {}
    let processedCount = 0
    let skippedCount = 0

    // Process each image
    for (const file of imageFiles) {
      const originalPath = join(studioDir, file)
      const originalUrl = `/aispaces/studio/${file}`
      
      // Generate thumbnail filename (replace extension with .webp)
      const nameWithoutExt = file.substring(0, file.lastIndexOf('.'))
      const thumbnailFile = `${nameWithoutExt}.webp`
      const thumbnailPath = join(thumbnailsDir, thumbnailFile)
      const thumbnailUrl = `/aispaces/studio/thumbnails/${thumbnailFile}`

      try {
        // Check if thumbnail already exists and is up-to-date
        if (existsSync(thumbnailPath)) {
          const originalStats = require('fs').statSync(originalPath)
          const thumbnailStats = require('fs').statSync(thumbnailPath)
          
          // Skip if thumbnail is newer than original (no need to regenerate)
          if (thumbnailStats.mtime >= originalStats.mtime) {
            console.log(`⏭️  Skipped (up-to-date): ${file}`)
            thumbnailMap[originalUrl] = thumbnailUrl
            skippedCount++
            continue
          }
        }

        // Generate thumbnail with automatic EXIF orientation handling
        // .rotate() auto-rotates based on EXIF orientation and strips orientation metadata
        await sharp(originalPath)
          .rotate() // Auto-rotate based on EXIF orientation tag (orientation 6 = 90° clockwise)
          .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
            fit: 'cover',
            position: 'center',
            withoutEnlargement: true,
          })
          .webp({ 
            quality: THUMBNAIL_QUALITY,
            effort: 6 // Higher effort for better compression
          })
          .toFile(thumbnailPath)

        thumbnailMap[originalUrl] = thumbnailUrl
        processedCount++
        console.log(`✓ Generated: ${file} → ${thumbnailFile}`)
      } catch (error) {
        console.error(`✗ Failed to process ${file}:`, error.message)
        // Continue with next image
      }
    }

    // Generate manifest
    const manifest = {
      success: true,
      thumbnails: thumbnailMap,
      count: Object.keys(thumbnailMap).length,
      generatedAt: new Date().toISOString(),
      thumbnailSize: {
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        quality: THUMBNAIL_QUALITY,
        format: 'webp'
      }
    }

    // Write manifest file
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    
    console.log(`\n✅ Thumbnail generation complete!`)
    console.log(`   Processed: ${processedCount} image(s)`)
    console.log(`   Skipped: ${skippedCount} image(s) (already up-to-date)`)
    console.log(`   Total thumbnails: ${manifest.count}`)
    console.log(`   Manifest: ${manifestPath}`)
  } catch (error) {
    console.error('Error generating thumbnails:', error)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  generateThumbnails()
}

module.exports = { generateThumbnails }

