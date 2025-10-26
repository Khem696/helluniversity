'use client'

import { useEffect } from 'react'

export function DisableServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    // Unregister any existing service workers to prevent stale cache during development
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister().catch(() => {}))
    }).catch(() => {})
    // Clear old caches created by the PWA plugin
    if (window.caches && typeof window.caches.keys === 'function') {
      window.caches.keys().then((keys) => {
        keys.forEach((key) => {
          window.caches.delete(key).catch(() => {})
        })
      }).catch(() => {})
    }
  }, [])
  return null
}


