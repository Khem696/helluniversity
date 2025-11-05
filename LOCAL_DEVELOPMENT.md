# Local Development Setup Guide

This guide helps you set up and test the AI Space Generator locally before deploying.

## Prerequisites

1. Node.js 18+ installed
2. BlackForest Labs API key ([Get one here](https://bfl.ai/))
3. Cloudflare Turnstile keys (or use test keys for development)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Copy the example file and update with your keys:

```bash
cp env.example .env.local
```

Edit `.env.local`:

```env
# Development mode (API routes will work)
NODE_ENV=development
STATIC_EXPORT=false

# BlackForest Labs API
PROVIDER_API_KEY=your_actual_api_key_here
BFL_API_URL=https://api.bfl.ai/v1/flux-kontext-pro

# Cloudflare Turnstile (use test keys for local dev)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA

# Local development URLs
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_BASE_PATH=
```

### 3. Add Test Images

The component expects images at `/aispaces/hongsee/`. For local testing:

1. Create directory: `public/aispaces/hongsee/`
2. Add test images: `1.jpg`, `2.jpg`, `3.jpg`, `4.jpg`, `5.jpg`

Or update `src/lib/aispaces.ts` to point to existing images in `public/assets/`

### 4. Start Development Server

```bash
npm run dev
```

Visit: [http://localhost:3000](http://localhost:3000)

## Testing the AI Generator

### Step 1: Complete CAPTCHA
- The Turnstile widget should appear
- With test keys, it will auto-pass
- Form fields will become enabled

### Step 2: Select Images
- Click image buttons to select (you can select multiple, up to any number)
- Selected images will be highlighted in blue
- Counter shows how many batches will be created

### Step 3: Enter Prompt
- Type a description like: "Modern minimalist living room with Scandinavian design"
- Prompt should be descriptive for best results

### Step 4: Generate
- Click "Generate" button
- Loading indicator will show progress
- Status shows batch processing information

### Step 5: View Results
- Generated images appear in a modal carousel
- Use arrow buttons to navigate
- Images are automatically proxied through `/api/images/proxy` to handle CORS

## API Routes Testing

### Test Image Generation API

```bash
curl -X POST http://localhost:3000/api/ai-space \
  -H "Content-Type: application/json" \
  -d '{
    "token": "test-turnstile-token",
    "selectedImages": ["/aispaces/hongsee/1.jpg"],
    "prompt": "Modern living room"
  }'
```

### Test Image Proxy

```bash
curl "http://localhost:3000/api/images/proxy?url=https://delivery-eu1.bfl.ai/sample-image.jpg"
```

## Troubleshooting

### API Routes Not Working

**Issue:** Routes return 404 or don't execute

**Solution:** Make sure `STATIC_EXPORT=false` in `.env.local`:

```env
STATIC_EXPORT=false
NODE_ENV=development
```

Then restart the dev server.

### Images Not Loading

**Issue:** Selected images show 404

**Solution:** 
1. Check that images exist in `public/aispaces/hongsee/`
2. Or update `HONGSEE_IMAGES` in `src/lib/aispaces.ts` to point to existing images

### CORS Errors

**Issue:** Generated images fail to load due to CORS

**Solution:** The code automatically proxies BFL delivery URLs. If you see CORS errors:
1. Check that `/api/images/proxy` route is accessible
2. Verify the proxy route is working: `curl http://localhost:3000/api/images/proxy?url=...`

### API Key Errors

**Issue:** "Insufficient credits" or "Unauthorized" errors

**Solution:**
1. Verify `PROVIDER_API_KEY` is set correctly in `.env.local`
2. Check your BFL account has credits
3. Ensure API key is valid at [BFL Dashboard](https://bfl.ai/)

### Rate Limiting

**Issue:** Getting 429 errors

**Solution:** 
- The code automatically retries with exponential backoff
- Reduce batch size or wait between requests
- Check your BFL account rate limits

## Development vs Production

### Development Mode (`npm run dev`)
- ✅ API routes work (`/api/ai-space`, `/api/images/proxy`)
- ✅ Hot reload enabled
- ✅ Detailed error messages
- ✅ API routes available at `http://localhost:3000/api/*`

### Production Build for GitHub Pages (`npm run build`)
- ⚠️ Static export (no API routes)
- ✅ Static pages work
- ⚠️ API routes won't work (need separate deployment)

## Next Steps

Once local testing works:

1. **For Production with API Routes:**
   - Deploy to Vercel/Netlify (API routes work automatically)
   - Or set up separate serverless functions

2. **For Static GitHub Pages:**
   - Build static version: `npm run build`
   - Deploy `out/` folder to GitHub Pages
   - Note: API features won't work in static export

## Testing Checklist

- [ ] Development server starts without errors
- [ ] Turnstile CAPTCHA loads and verifies
- [ ] Image selection buttons work
- [ ] Prompt input accepts text
- [ ] Generate button triggers API call
- [ ] Loading indicator shows progress
- [ ] Generated images appear in modal
- [ ] Image proxy works for BFL delivery URLs
- [ ] Carousel navigation works
- [ ] Error messages display correctly

## Need Help?

- Check browser console for errors
- Check server terminal for API errors
- Verify all environment variables are set
- Review `BFL_API_INTEGRATION.md` for API details
