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
5. Copy your **Site Key** (public key)

### Step 2: Add Environment Variable

1. Create or update your `.env.local` file in the project root
2. Add the following:

```env
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your_site_key_here
```

3. Replace `your_site_key_here` with your actual Site Key from Step 1

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
- Form submission requires valid Turnstile token

### AI Space Generator Modal
- Turnstile appears before image selection and prompt input
- Image selection buttons are **disabled** until verified
- Textarea for prompt is **disabled** until verified
- Generate button requires valid Turnstile token

## Security Notes

⚠️ **Important**: The Turnstile token should be verified on your backend server before processing form submissions. The current implementation only validates client-side.

For production, you should:
1. Send the Turnstile token to your backend API
2. Verify the token using Cloudflare's verification endpoint
3. Only process the form if verification succeeds

Example backend verification (Next.js API route):
```typescript
// app/api/verify-turnstile/route.ts
export async function POST(request: Request) {
  const { token } = await request.json()
  
  const response = await fetch(
    `https://challenges.cloudflare.com/turnstile/v0/siteverify`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
      }),
    }
  )
  
  const data = await response.json()
  return Response.json({ success: data.success })
}
```

## Troubleshooting

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

## Testing

For testing purposes, Cloudflare provides test keys:
- **Site Key**: `1x00000000000000000000AA`
- **Secret Key**: `1x0000000000000000000000000000000AA`

These keys always pass validation and are useful for development.

## Documentation

- [Cloudflare Turnstile Docs](https://developers.cloudflare.com/turnstile/)
- [React Turnstile Package](https://github.com/marsidev/react-turnstile)

