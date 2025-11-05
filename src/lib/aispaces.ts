import { withBasePath } from "@/lib/utils";

/**
 * AI Space Generator Image Manifests
 * 
 * These images are used as reference images for the AI Space Generator.
 * Images should be placed in the public/aispaces/ directory.
 * 
 * Directory Structure:
 * - public/aispaces/hongsee/ - Hongsee reference images (1.jpg, 2.jpg, etc.)
 * - public/aispaces/gallery/ - Gallery reference images (1.jpg, 2.jpg, etc.)
 */

export const HONGSEE_IMAGES: string[] = [
  withBasePath("/aispaces/hongsee/1.jpg"),
  withBasePath("/aispaces/hongsee/2.jpg"),
  withBasePath("/aispaces/hongsee/3.jpg"),
  withBasePath("/aispaces/hongsee/4.jpg"),
  withBasePath("/aispaces/hongsee/5.jpg"),
];

export const GALLERY_IMAGES: string[] = [
  withBasePath("/aispaces/gallery/1.jpg"),
  withBasePath("/aispaces/gallery/2.jpg"),
  withBasePath("/aispaces/gallery/3.jpg"),
  withBasePath("/aispaces/gallery/4.jpg"),
  withBasePath("/aispaces/gallery/5.jpg"),
];

export const ALL_ALLOWED_IMAGES: Set<string> = new Set([
  ...HONGSEE_IMAGES,
  ...GALLERY_IMAGES,
]);

/**
 * Helper function to get all available image categories
 */
export function getImageCategories() {
  return {
    hongsee: HONGSEE_IMAGES,
    gallery: GALLERY_IMAGES,
  };
}

/**
 * Helper function to validate if an image path is allowed
 */
export function isAllowedImage(path: string): boolean {
  return ALL_ALLOWED_IMAGES.has(path);
}


