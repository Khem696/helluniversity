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

const { readdir, mkdir, writeFile } = require('fs/promises')
const { join } = require('path')
const { existsSync } = require('fs')

// Try to load sharp, but handle gracefully if it fails (e.g., on Vercel build)
let sharp = null
try {
  // Check if sharp module exists before requiring
  require.resolve('sharp')
  // If resolve succeeds, try to actually require it
  sharp = require('sharp')
} catch (error) {
  // Sharp is not available or failed to load - this is OK for Vercel builds
  // where thumbnails aren't critical (API routes are available)
  // Silently set to null - we'll handle this in the function
  sharp = null
}

const THUMBNAIL_WIDTH = 280
const THUMBNAIL_HEIGHT = 280
const THUMBNAIL_QUALITY = 80

async function generateThumbnails() {
  try {
    // If sharp is not available, skip thumbnail generation but create empty manifest
    if (!sharp) {
      const manifestPath = join(process.cwd(), 'public', 'aispaces', 'studio-thumbnails.json')
      await writeFile(manifestPath, JSON.stringify({ 
        success: true, 
        thumbnails: {}, 
        count: 0,
        skipped: true,
        reason: 'sharp module not available'
      }, null, 2))
      console.log('⚠ Skipped thumbnail generation (sharp not available)')
      console.log('  This is normal on Vercel builds where API routes handle image processing')
      console.log('  Generated empty thumbnail manifest')
      return
    }

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
  generateThumbnails().catch((error) => {
    // If sharp failed to load, create empty manifest and exit gracefully
    if (error.message && (error.message.includes('sharp') || error.message.includes('Could not load'))) {
      const { writeFile } = require('fs/promises')
      const { join } = require('path')
      const manifestPath = join(process.cwd(), 'public', 'aispaces', 'studio-thumbnails.json')
      writeFile(manifestPath, JSON.stringify({ 
        success: true, 
        thumbnails: {}, 
        count: 0,
        skipped: true,
        reason: 'sharp module not available'
      }, null, 2)).then(() => {
        console.log('⚠ Skipped thumbnail generation (sharp not available)')
        console.log('  This is normal on Vercel builds where API routes handle image processing')
        console.log('  Generated empty thumbnail manifest')
        process.exit(0)
      }).catch(() => {
        process.exit(1)
      })
    } else {
      console.error('Error generating thumbnails:', error)
      process.exit(1)
    }
  })
}

module.exports = { generateThumbnails }

