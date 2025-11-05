import { NextResponse } from "next/server"
import { readdir } from "fs/promises"
import { join } from "path"
import { existsSync } from "fs"

/**
 * API Route to dynamically discover studio images
 * 
 * Returns a list of available studio images from the public/aispaces/studio/ directory.
 * This allows adding/removing images without code changes.
 */

export async function GET() {
  try {
    const studioDir = join(process.cwd(), "public", "aispaces", "studio")
    
    // Check if directory exists
    if (!existsSync(studioDir)) {
      return NextResponse.json(
        { 
          success: false, 
          error: "Studio directory not found",
          images: [] 
        },
        { status: 404 }
      )
    }

    // Read directory contents
    const files = await readdir(studioDir)
    
    // Filter for image files (jpg, jpeg, png, webp)
    const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"]
    const imageFiles = files
      .filter(file => {
        const ext = file.toLowerCase().substring(file.lastIndexOf("."))
        return imageExtensions.includes(ext)
      })
      .sort((a, b) => {
        // Natural sort: extract numbers and compare
        const numA = parseInt(a.match(/\d+/)?.[0] || "0")
        const numB = parseInt(b.match(/\d+/)?.[0] || "0")
        return numA - numB
      })
      .map(file => `/aispaces/studio/${file}`)

    return NextResponse.json({
      success: true,
      images: imageFiles,
      count: imageFiles.length,
    })
  } catch (error) {
    console.error("Error discovering studio images:", error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error",
        images: [] 
      },
      { status: 500 }
    )
  }
}


