const path = require('path')

// PWA configuration - only apply in production to avoid Turbopack conflicts
const pwaConfig = {
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development', // Always disable in dev
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts',
        expiration: {
          maxEntries: 4,
          maxAgeSeconds: 365 * 24 * 60 * 60 // 365 days
        }
      }
    },
    {
      urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts-static',
        expiration: {
          maxEntries: 4,
          maxAgeSeconds: 365 * 24 * 60 * 60 // 365 days
        }
      }
    },
    {
      urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'static-image-assets',
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 24 * 60 * 60 // 24 hours
        }
      }
    },
    {
      urlPattern: /\.(?:js|css)$/i,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'static-resources',
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60 // 24 hours
        }
      }
    }
  ]
}

// Detect deployment platform
const isVercel = process.env.VERCEL === '1'
const isGitHubPages = process.env.NODE_ENV === 'production' && !isVercel && process.env.STATIC_EXPORT !== 'false'
const basePath = isVercel ? '' : (isGitHubPages ? '/helluniversity' : '')
const assetPrefix = isVercel ? '' : (isGitHubPages ? '/helluniversity' : '')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Only use static export for GitHub Pages builds, not Vercel
  // In development, API routes will work normally - Turbopack needs this explicit
  output: isGitHubPages ? 'export' : undefined,
  trailingSlash: true,
  typescript: {
    // Skip type checking during build to speed up builds and avoid type-only issues
    // Type checking should be done separately via `npm run lint` or `tsc --noEmit`
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      // BlackForest Labs delivery domains (for reference - images should be proxied)
      {
        protocol: 'https',
        hostname: 'delivery-eu1.bfl.ai',
      },
      {
        protocol: 'https',
        hostname: 'delivery-us1.bfl.ai',
      },
      {
        protocol: 'https',
        hostname: 'delivery-eu.bfl.ai',
      },
      {
        protocol: 'https',
        hostname: 'delivery-us.bfl.ai',
      },
    ],
    formats: ['image/webp', 'image/avif'],
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  poweredByHeader: false,
  generateEtags: false,
  compress: true,
  assetPrefix,
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_BASE_URL: isVercel
      ? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
      : (isGitHubPages
        ? 'https://khem696.github.io/helluniversity'
        : 'http://localhost:3000'),
    // Set to '1' if you want to enable Vercel Analytics on GH Pages
    NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS: process.env.NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS || (isVercel ? '1' : '0'),
    // Detect if we're in static export mode (GitHub Pages)
    // API routes won't work in static export, so use static image manifest
    NEXT_PUBLIC_USE_STATIC_IMAGES: isGitHubPages ? '1' : '0',
  },
  webpack: (config, { dev, isServer }) => {
    // Skip webpack config in development - Turbopack handles everything
    if (dev) {
      return config
    }
    
    // In static export mode, exclude API routes from being processed
    const isStaticExport = isGitHubPages
    
    if (isStaticExport && !isServer) {
      // Exclude API routes directory from client-side bundle
      config.resolve = config.resolve || {}
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        '@/app/api': false,
      }
    }
    
    // Production webpack config (for static export builds)
    // Avoid bundling optional Upstash dependencies when disabled
    if (process.env.NEXT_PUBLIC_ENABLE_UPSTASH !== '1') {
      config.resolve = config.resolve || {}
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        '@upstash/ratelimit': false,
        '@upstash/redis': false,
      }
    }
    // Ensure path aliases work in production builds
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': path.resolve(__dirname, 'src'),
      '@/components': path.resolve(__dirname, 'src/components'),
      '@/lib': path.resolve(__dirname, 'src/lib'),
      '@/styles': path.resolve(__dirname, 'src/styles'),
    }
    return config
  },
  // Add empty turbopack config to satisfy Next.js 16 requirement
  // This tells Next.js we're aware we're using Turbopack in dev
  turbopack: {},
}

// Export config directly
// PWA functionality is handled by client-side components (PWAInstallPrompt, DisableServiceWorker)
// next-pwa has been removed to eliminate deprecated dependency warnings
module.exports = nextConfig