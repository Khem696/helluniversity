# GitHub Pages Deployment Guide

This guide will help you deploy your Hell University website to GitHub Pages.

## Prerequisites

1. A GitHub account
2. Your project pushed to a GitHub repository

## Step 1: Update Repository Settings

1. Go to your GitHub repository
2. Click on **Settings** tab
3. Scroll down to **Pages** section
4. Under **Source**, select **GitHub Actions**

## Step 2: Update URLs in Code

Before deploying, you need to replace `yourusername` with your actual GitHub username in the following files:

- `app/layout.tsx` (2 occurrences)
- `app/page.tsx` (2 occurrences) 
- `src/lib/structured-data.ts` (5 occurrences)

Replace `yourusername` with your actual GitHub username in all these files.

## Step 3: Deploy

1. Push your code to the `main` branch
2. The GitHub Actions workflow will automatically:
   - Build your Next.js application
   - Export it as static files
   - Deploy to GitHub Pages

## Step 4: Access Your Site

Once deployed, your site will be available at:
`https://yourusername.github.io/helluniversity`

## Important Notes

### Static Export Limitations

Since GitHub Pages serves static files only, some features are disabled:

- **PWA features**: Service workers and offline functionality are disabled
- **Image optimization**: Images are served unoptimized
- **Server-side features**: No API routes or server-side rendering

### Environment Variables

For GitHub Pages deployment, you don't need to set environment variables in the repository settings. The build process will use the default values.

### Custom Domain (Optional)

If you want to use a custom domain:

1. Add a `CNAME` file to the `public` folder with your domain
2. Update your domain's DNS settings to point to GitHub Pages
3. Update the URLs in the code to use your custom domain

## Troubleshooting

### Build Fails
- Check that all dependencies are in `package.json`
- Ensure there are no TypeScript errors
- Verify that all imports are correct

### Site Not Loading
- Check the GitHub Actions logs for errors
- Verify the repository name matches the URL path
- Ensure the `main` branch is set as the source

### Images Not Loading
- Images are served unoptimized on GitHub Pages
- Check that image paths are correct
- Verify that images are in the `public` folder

## Local Development

To test the static export locally:

```bash
npm run build
npx serve out
```

This will serve the static files locally, similar to how GitHub Pages will serve them.

## Manual Deployment

If you prefer to deploy manually:

```bash
npm run build
# The static files will be in the 'out' folder
# Upload the contents of 'out' to your GitHub Pages repository
```
