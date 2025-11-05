const path = require('path')
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
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
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Only use static export for production builds (GitHub Pages)
  // In development, API routes will work normally
  ...(process.env.NODE_ENV === 'production' && process.env.STATIC_EXPORT !== 'false' 
    ? { output: 'export' } 
    : {}),
  trailingSlash: true,
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
  assetPrefix: process.env.NODE_ENV === 'production' ? '/helluniversity' : '',
  basePath: process.env.NODE_ENV === 'production' ? '/helluniversity' : '',
  env: {
    NEXT_PUBLIC_BASE_PATH: process.env.NODE_ENV === 'production' ? '/helluniversity' : '',
    NEXT_PUBLIC_BASE_URL: process.env.NODE_ENV === 'production'
      ? 'https://khem696.github.io/helluniversity'
      : 'http://localhost:3000',
    // Set to '1' if you want to enable Vercel Analytics on GH Pages
    NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS: process.env.NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS || '0',
  },
  webpack: (config) => {
    // Avoid bundling optional Upstash dependencies when disabled
    if (process.env.NEXT_PUBLIC_ENABLE_UPSTASH !== '1') {
      config.resolve = config.resolve || {}
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        '@upstash/ratelimit': false,
        '@upstash/redis': false,
      }
    }
    // Ensure path aliases work in all environments
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
  // Add empty turbopack config to use webpack for static export
  turbopack: {},
}

module.exports = withPWA(nextConfig)