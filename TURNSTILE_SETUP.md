# Cloudflare Turnstile CAPTCHA Setup Guide

## Overview
Cloudflare Turnstile has been integrated into both the **Booking Form** and **AI Space Generator** modals to prevent spam and bot submissions.

## Features
- ✅ **Free** - No cost for unlimited requests
- ✅ **Privacy-focused** - No user tracking for advertising
- ✅ **Invisible** - Runs in the background, minimal user interaction
- ✅ **Effective** - Advanced bot detection algorithms
- ✅ **GDPR Compliant** - Privacy-first design

## Setup Instructions

### Step 1: Get Your Turnstile Keys

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Turnstile** section (or visit: https://dashboard.cloudflare.com/?to=/:account/turnstile)
3. Click **"Add Site"**
4. Configure your site:
   - **Site name**: Hell University (or your preferred name)
   - **Domain**: Your domain (e.g., `helluniversity.com`)
   - **Widget mode**: Choose "Managed" (recommended) or "Non-interactive"
5. Copy your **Site Key** (public key) and **Secret Key**

**Important for Local Development:**
- If testing on `localhost:3000`, you need to add `localhost` to the allowed domains
- After creating the widget, click on it to edit
- Under "Domains" or "Hostname Management", add:
  - `localhost`
  - `127.0.0.1` (optional, for IP access)
  - `localhost:3000` (if needed)
- Save the changes

**Alternative for Development:** Use Cloudflare's test keys (see Testing section below) which work on any domain.

### Step 2: Add Environment Variables

1. Create or update your `.env.local` file in the project root
2. Add the following:

```env
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_site_key_here
TURNSTILE_SECRET_KEY=your_secret_key_here
```

3. Replace `your_site_key_here` with your actual Site Key from Step 1
4. Replace `your_secret_key_here` with your actual Secret Key from Step 1

**Important**: 
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is used on the client-side (visible in browser)
- `TURNSTILE_SECRET_KEY` is used on the server-side only (never exposed to browser)

### Step 3: Restart Development Server

If your dev server is running, restart it to load the new environment variable:

```bash
npm run dev
```

## How It Works

### Booking Form Modal
- Turnstile appears at the top of the form
- All form fields are **disabled** until CAPTCHA is verified
- Users must complete verification before filling out the form
- Form submission sends token to `/api/booking` endpoint
- Server validates the token before processing the booking

### AI Space Generator Modal
- Turnstile appears before image selection and prompt input
- Image selection buttons are **disabled** until verified
- Textarea for prompt is **disabled** until verified
- Generate button sends token to `/api/ai-space` endpoint
- Server validates the token before generating images

## Server-Side Validation

✅ **Server-side validation is implemented** - All form submissions are validated on the server before processing.

### API Endpoints

1. **`/api/verify-turnstile`** - Standalone Turnstile verification endpoint
   - Accepts: `{ token: string }`
   - Returns: `{ success: boolean }`

2. **`/api/booking`** - Booking submission with Turnstile validation
   - Accepts: `{ token: string, ...bookingData }`
   - Validates token, then processes booking
   - Returns: `{ success: boolean, message?: string }`

3. **`/api/ai-space`** - AI space generation with Turnstile validation
   - Accepts: `{ token: string, selectedImages: string[], prompt: string }`
   - Validates token, then generates images
   - Returns: `{ success: boolean, images?: string[] }`

## Troubleshooting

### "Invalid domain" Error on Localhost

If you see "Invalid domain contact site administrator" when testing on `localhost:3000`:

**Solution 1: Add localhost to Cloudflare Dashboard**
1. Go to your Cloudflare Turnstile dashboard
2. Click on your widget/site
3. Find "Domains" or "Hostname Management" section
4. Click "Add Domain" or "Manage Hostnames"
5. Add these domains:
   - `localhost`
   - `127.0.0.1` (optional)
   - `localhost:3000` (if your setup requires port)
6. Save changes
7. Wait a few minutes for changes to propagate
8. Refresh your localhost page

**Solution 2: Use Test Keys for Development**
Use Cloudflare's test keys (see Testing section) which work on any domain, including localhost.

### CAPTCHA Not Showing
- Check that `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set in `.env.local`
- Restart your development server
- Check browser console for errors

### "Turnstile configuration missing" Warning
- This appears when the site key is not set
- Make sure your `.env.local` file exists and contains the key
- Remember: Next.js requires server restart for env changes

### Form Fields Always Disabled
- Verify Turnstile widget is loading correctly
- Check browser console for Turnstile errors
- Ensure your domain matches the one configured in Cloudflare dashboard

### Server Validation Errors
- Check that `TURNSTILE_SECRET_KEY` is set in `.env.local`
- Check server logs for verification errors
- Ensure your secret key matches your site key in Cloudflare dashboard
- Restart your development server after adding the secret key

## Testing

For testing purposes, Cloudflare provides test keys that work on **any domain** (including localhost):
- **Site Key**: `1x00000000000000000000AA`
- **Secret Key**: `1x0000000000000000000000000000000AA`

These keys:
- Always pass validation (no real challenge)
- Work on localhost without domain configuration
- Perfect for development and testing
- Can be used in `.env.local` for local development

**Note:** Switch to your real keys when deploying to production!

## Documentation

- [Cloudflare Turnstile Docs](https://developers.cloudflare.com/turnstile/)
- [React Turnstile Package](https://github.com/marsidev/react-turnstile)

