# Image Management System

This document explains the image management system for the Hell University website.

## Directory Structure

All images are stored in the `public/` directory and organized by category:

```
public/
├── assets/                    # Main website assets
│   ├── artwork/              # Artwork images (about, contact, home)
│   ├── artwork_studio/       # Studio artwork images
│   ├── building_studio/      # Building studio images
│   ├── gallery/              # Gallery images
│   ├── icons/                # Icon files
│   ├── poem/                 # Poem images
│   └── portrait/             # Portrait images
│
└── aispaces/                 # AI Space Generator reference images
    ├── hongsee/              # Hongsee reference images
    │   ├── 1.jpg
    │   ├── 2.jpg
    │   ├── 3.jpg
    │   ├── 4.jpg
    │   └── 5.jpg
    └── gallery/              # Gallery reference images
        ├── 1.jpg
        ├── 2.jpg
        ├── 3.jpg
        ├── 4.jpg
        └── 5.jpg
```

## Image Management Files

### 1. `src/lib/imageManifests.ts`
Manages images for the main website (Studio Gallery, etc.)

**Usage:**
- Updates automatically reflect across the site
- Uses `withBasePath()` helper for GitHub Pages compatibility
- Exports: `ARTWORK_STUDIO_IMAGES`, `BUILDING_STUDIO_IMAGES`, `GALLERY_IMAGES_PUBLIC`

**To add/update images:**
1. Add image files to `public/assets/{category}/`
2. Update the corresponding array in `imageManifests.ts`
3. Use `withBasePath()` helper for paths

### 2. `src/lib/aispaces.ts`
Manages images for the AI Space Generator

**Usage:**
- Used by `AISpaceGenerator` component
- Images are reference images for AI generation
- Uses `withBasePath()` helper for consistency

**To add/update images:**
1. Add image files to `public/aispaces/{category}/`
2. Update arrays in `aispaces.ts`
3. Use `withBasePath()` helper for paths

## Adding Images for AI Space Generator

### Step 1: Create Directory Structure

If directories don't exist, create them:

```bash
# Windows
mkdir public\aispaces\hongsee
mkdir public\aispaces\gallery

# Linux/Mac
mkdir -p public/aispaces/hongsee
mkdir -p public/aispaces/gallery
```

### Step 2: Add Image Files

Place your reference images in the appropriate directory:

```
public/aispaces/hongsee/
├── 1.jpg  (Your first reference image)
├── 2.jpg  (Your second reference image)
├── 3.jpg  (Your third reference image)
├── 4.jpg  (Your fourth reference image)
└── 5.jpg  (Your fifth reference image)
```

**Image Requirements:**
- Format: JPG, PNG, or WebP
- Recommended size: 1024x1024px or larger
- File size: Keep under 5MB for best performance

### Step 3: Update Image Manifest

Edit `src/lib/aispaces.ts` to add/remove images:

```typescript
export const HONGSEE_IMAGES: string[] = [
  withBasePath("/aispaces/hongsee/1.jpg"),
  withBasePath("/aispaces/hongsee/2.jpg"),
  withBasePath("/aispaces/hongsee/3.jpg"),
  // Add more images here
  withBasePath("/aispaces/hongsee/6.jpg"), // New image
];
```

### Step 4: Test

1. Restart development server: `npm run dev`
2. Visit the AI Space Generator page
3. Verify images appear in the selection buttons

## Quick Setup Script

Create a helper script to set up directories:

**Windows (`setup-images.bat`):**
```batch
@echo off
echo Creating image directories...
if not exist "public\aispaces\hongsee" mkdir "public\aispaces\hongsee"
if not exist "public\aispaces\gallery" mkdir "public\aispaces\gallery"
echo Done! Add your images to:
echo - public\aispaces\hongsee\
echo - public\aispaces\gallery\
```

**Linux/Mac (`setup-images.sh`):**
```bash
#!/bin/bash
echo "Creating image directories..."
mkdir -p public/aispaces/hongsee
mkdir -p public/aispaces/gallery
echo "Done! Add your images to:"
echo "- public/aispaces/hongsee/"
echo "- public/aispaces/gallery/"
```

## Using Existing Images

If you want to use existing images from `public/assets/`:

1. **Option 1: Copy images**
   ```bash
   # Copy existing gallery images
   copy public\assets\gallery\*.jpg public\aispaces\hongsee\
   ```

2. **Option 2: Update manifest to point to existing images**
   ```typescript
   // In src/lib/aispaces.ts
   import { GALLERY_IMAGES_PUBLIC } from "@/lib/imageManifests";
   
   export const HONGSEE_IMAGES: string[] = [
     ...GALLERY_IMAGES_PUBLIC.slice(0, 5), // Use first 5 gallery images
   ];
   ```

## Image Path Resolution

### How Paths Work

1. **Development:** Paths resolve to `http://localhost:3000/aispaces/hongsee/1.jpg`
2. **Production (GitHub Pages):** Paths resolve to `https://khem696.github.io/helluniversity/aispaces/hongsee/1.jpg`

The `withBasePath()` helper handles this automatically.

### Example Usage

```typescript
// In component
import { HONGSEE_IMAGES } from "@/lib/aispaces";

// Images automatically resolve with correct base path
HONGSEE_IMAGES[0] // "/aispaces/hongsee/1.jpg" (dev) or "/helluniversity/aispaces/hongsee/1.jpg" (prod)
```

## Best Practices

1. **Naming Convention:**
   - Use descriptive names: `hongsee-modern-1.jpg`
   - Or sequential: `1.jpg`, `2.jpg`, etc.
   - Keep names consistent

2. **File Organization:**
   - One category per directory
   - Group related images together
   - Use subdirectories for large collections

3. **Image Optimization:**
   - Compress images before adding (use tools like TinyPNG)
   - Use appropriate formats (JPG for photos, PNG for graphics)
   - Consider WebP for better compression

4. **Version Control:**
   - Keep images under 5MB each
   - Use Git LFS for large images if needed
   - Document image sources/licenses

## Troubleshooting

### Images Not Showing

1. Check file exists in `public/aispaces/{category}/`
2. Verify path in `aispaces.ts` matches file name
3. Check browser console for 404 errors
4. Restart dev server after adding images

### Images Wrong Size

1. Check `withBasePath()` is used in manifest
2. Verify base path configuration in `next.config.js`
3. Check environment variables

### Want to Add More Categories

1. Create directory: `public/aispaces/{new-category}/`
2. Add array to `aispaces.ts`:
   ```typescript
   export const NEW_CATEGORY_IMAGES: string[] = [
     withBasePath("/aispaces/new-category/1.jpg"),
     // ...
   ];
   ```
3. Update `ALL_ALLOWED_IMAGES` set
4. Import and use in `AISpaceGenerator.tsx`

## Current Status

✅ **Created:** Directories for `aispaces/hongsee` and `aispaces/gallery`  
✅ **Updated:** `aispaces.ts` to use `withBasePath()` helper  
⚠️ **Required:** Add actual image files to directories  
⚠️ **Optional:** Copy existing images from `public/assets/` for testing  

## Next Steps

1. Add your reference images to `public/aispaces/hongsee/`
2. Name them `1.jpg`, `2.jpg`, etc. (or update manifest)
3. Test the AI Space Generator
4. Repeat for gallery images if needed

