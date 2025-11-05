# BlackForest Labs API Integration Guide

This document outlines the implementation of BlackForest Labs API best practices for this Next.js project.

## Reference Documentation

- [BFL API Integration Guidelines](https://docs.bfl.ai/api_integration/integration_guidelines)
- [BFL Best Practices](https://docs.bfl.ai/api_integration/integration_guidelines#best-practices)

## Implemented Features

### ✅ 1. API Endpoint Configuration

**Status:** Implemented

- Updated to use primary global endpoint: `api.bfl.ai`
- Supports regional endpoints via environment variable:
  - `api.bfl.ai` - Global (default)
  - `api.eu.bfl.ai` - EU region
  - `api.us.bfl.ai` - US region

**Configuration:**
```env
BFL_API_URL=https://api.bfl.ai/v1/flux-kontext-pro
```

### ✅ 2. Polling URL Support

**Status:** Implemented

- Automatically detects `polling_url` in API responses
- Implements async polling when needed (required for `api.bfl.ai` endpoint)
- Polling interval: 500ms, max attempts: 60 (30 seconds timeout)

**Reference:** [Polling URL Usage](https://docs.bfl.ai/api_integration/integration_guidelines#polling-url-usage)

### ✅ 3. Error Handling

**Status:** Implemented

- **Rate Limiting (429):** Exponential backoff retry (1s, 2s, 4s)
- **Insufficient Credits (402):** Clear error message
- **Network Errors:** Retry logic with exponential backoff
- **Other Errors:** Proper error propagation with details

**Reference:** [Error Handling](https://docs.bfl.ai/api_integration/integration_guidelines#error-handling)

### ✅ 4. Rate Limiting Compliance

**Status:** Implemented

- Sequential batch processing (respects 24 concurrent request limit)
- Automatic retry with exponential backoff for 429 responses
- Proper error messages for rate limit exceeded

**Reference:** [Rate Limiting](https://docs.bfl.ai/api_integration/integration_guidelines#rate-limiting)

### ✅ 5. Response Format Handling

**Status:** Implemented

- Supports multiple response formats:
  - Async polling result format (`result.sample`)
  - Direct response format (`data`, `images`, `url`, etc.)
- Handles both single and array responses

## ⚠️ Important Considerations

### Image Delivery URLs

**Critical Issue:** BFL delivery URLs have the following limitations:

1. **10-Minute Expiration:** Generated images expire after 10 minutes
2. **No CORS Support:** Cannot be used directly in browsers
3. **Not for Direct Serving:** Should not be served directly to end users

**Reference:** [Content Delivery Guidelines](https://docs.bfl.ai/api_integration/integration_guidelines#content-delivery-and-storage-guidelines)

### Recommended Solution

**Status:** Image Proxy Route Created (`app/api/images/proxy/route.ts`)

The proxy route downloads images from BFL delivery URLs and serves them through your own infrastructure:

```typescript
// Usage example:
const proxyUrl = `/api/images/proxy?url=${encodeURIComponent(bflDeliveryUrl)}`
```

**Benefits:**
- ✅ Images cached and served from your infrastructure
- ✅ CORS enabled
- ✅ No expiration issues
- ✅ Better performance

### ⚠️ Static Export Limitation

**Important:** This project uses `output: 'export'` for static deployment (GitHub Pages).

**Issue:** API routes (including the image proxy) **will not work** in static export deployments.

**Solutions:**

1. **Use a Serverless Function:**
   - Deploy API routes to Vercel, Netlify Functions, or AWS Lambda
   - Keep static assets on GitHub Pages
   - Proxy images through serverless function

2. **Use a Separate Image Service:**
   - Implement image download/storage on a separate service
   - Use cloud storage (AWS S3, Cloudflare R2, etc.)
   - Serve images from CDN

3. **Use Client-Side Proxy:**
   - For development/testing only
   - Download images client-side and convert to base64/data URLs
   - ⚠️ Not recommended for production (large payloads)

4. **Deploy to Platform with Server Support:**
   - Deploy to Vercel, Netlify, or similar
   - Remove `output: 'export'` from `next.config.js`
   - API routes will work normally

## Implementation Checklist

### For Production Deployment

- [ ] Deploy API routes to serverless platform (Vercel/Netlify)
- [ ] Set up image storage (S3, Cloudflare R2, etc.)
- [ ] Implement image download immediately upon generation
- [ ] Set up CDN for serving cached images
- [ ] Configure proper cache headers
- [ ] Monitor rate limits and adjust batch sizes if needed

### Current Implementation Status

✅ API endpoint updated to `api.bfl.ai`  
✅ Polling URL support implemented  
✅ Error handling (429, 402, network errors)  
✅ Retry logic with exponential backoff  
✅ Response format handling  
✅ Image proxy route created (requires server environment)  
⚠️ Image storage solution needed for static export  

## Testing

### Test Rate Limiting

```bash
# Test with multiple concurrent requests
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/ai-space \
    -H "Content-Type: application/json" \
    -d '{"token":"...","selectedImages":["..."],"prompt":"test"}' &
done
```

### Test Error Handling

```bash
# Test with invalid API key (should return 401/403)
# Test with insufficient credits (should return 402)
# Test with rate limit (should retry automatically)
```

## Additional Resources

- [BFL API Status](https://status.bfl.ai/)
- [BFL API Pricing](https://bfl.ai/pricing/api)
- [BFL API Reference](https://docs.bfl.ai/api-reference)

## Support

For API issues, contact BlackForest Labs support or check their [Help Center](https://help.bfl.ai/).
