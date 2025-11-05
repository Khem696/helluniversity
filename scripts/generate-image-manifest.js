/**
 * Build-time script to generate static image manifest for GitHub Pages
 * 
 * This script scans the public/aispaces/studio/ directory and generates
 * a JSON manifest file that can be used in static builds where API routes
 * are not available.
 */

const { readdir } = require('fs/promises')
const { join } = require('path')
const { writeFile } = require('fs/promises')
const { existsSync } = require('fs')

async function generateImageManifest() {
  try {
    const studioDir = join(process.cwd(), 'public', 'aispaces', 'studio')
    const outputPath = join(process.cwd(), 'public', 'aispaces', 'studio-images.json')
    
    // Check if directory exists
    if (!existsSync(studioDir)) {
      console.warn(`Warning: Studio directory not found at ${studioDir}`)
      // Write empty manifest
      await writeFile(outputPath, JSON.stringify({ success: true, images: [], count: 0 }, null, 2))
      console.log('Generated empty image manifest')
      return
    }

    // Read directory contents
    const files = await readdir(studioDir)
    
    // Filter for image files (jpg, jpeg, png, webp, JPG)
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.JPG', '.JPEG', '.PNG', '.WEBP']
    const imageFiles = files
      .filter(file => {
        const ext = file.substring(file.lastIndexOf('.'))
        return imageExtensions.includes(ext)
      })
      .sort((a, b) => {
        // Natural sort: extract numbers and compare
        const numA = parseInt(a.match(/\d+/)?.[0] || '0')
        const numB = parseInt(b.match(/\d+/)?.[0] || '0')
        return numA - numB
      })
      .map(file => `/aispaces/studio/${file}`)

    const manifest = {
      success: true,
      images: imageFiles,
      count: imageFiles.length,
      generatedAt: new Date().toISOString()
    }

    // Write manifest file
    await writeFile(outputPath, JSON.stringify(manifest, null, 2))
    console.log(`✓ Generated image manifest with ${imageFiles.length} images`)
    console.log(`  Output: ${outputPath}`)
  } catch (error) {
    console.error('Error generating image manifest:', error)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  generateImageManifest()
}

module.exports = { generateImageManifest }

