/**
 * AI Space Images API v1
 * 
 * Versioned endpoint for AI space images
 * 
 * Returns a list of available studio images from the public/aispaces/studio/ directory.
 * This allows adding/removing images without code changes.
 */

import { NextResponse } from "next/server"
import { readdir } from "fs/promises"
import { join } from "path"
import { existsSync } from "fs"
import { createRequestLogger } from "@/lib/logger"
import { withErrorHandling, successResponse, errorResponse, ErrorCodes } from "@/lib/api-response"
import { withVersioning } from "@/lib/api-version-wrapper"
import { getRequestPath } from "@/lib/api-versioning"

export const GET = withVersioning(async (request: Request) => {
  return withErrorHandling(async () => {
    const requestId = crypto.randomUUID()
    const endpoint = getRequestPath(request)
    const logger = createRequestLogger(requestId, endpoint)
    
    await logger.info('AI space images discovery request received')
    
    const studioDir = join(process.cwd(), "public", "aispaces", "studio")
    
    // Check if directory exists
    if (!existsSync(studioDir)) {
      await logger.warn('Studio directory not found', { studioDir })
      return errorResponse(
        ErrorCodes.NOT_FOUND,
        "Studio directory not found",
        undefined,
        404,
        { requestId }
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
    
    await logger.info('Studio images discovered', { count: imageFiles.length })

    return successResponse(
      {
        images: imageFiles,
        count: imageFiles.length,
      },
      { requestId }
    )
  }, { endpoint: getRequestPath(request) })
})

