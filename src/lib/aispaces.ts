import { withBasePath } from "@/lib/utils";

/**
 * AI Space Generator Image Utilities
 * 
 * Helper functions for working with AI space generator images.
 * Images are now discovered dynamically from the public/aispaces/studio/ directory
 * via the /api/ai-space/images endpoint.
 */

/**
 * Helper function to validate if an image path is from the studio directory
 */
export function isStudioImage(path: string): boolean {
  return path.includes("/aispaces/studio/")
}

/**
 * Helper function to get the studio directory path
 */
export function getStudioImagePath(filename: string): string {
  return withBasePath(`/aispaces/studio/${filename}`)
}


