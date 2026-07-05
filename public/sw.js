// Per-build fingerprint, stamped in at build time by the mbus-precache-manifest
// vite plugin (replaces the placeholder). It changes whenever any hashed asset
// changes, so sw.js is no longer byte-identical between deploys — that byte
// difference is what makes the browser re-install the SW and re-run precache().
// In dev (unbuilt), it stays the literal placeholder.
const BUILD_HASH = '__BUILD_HASH__'
// Unbuilt = dev server. A SW must never cache there: localhost origins are
// shared across projects and cache-first pins stale (even cross-project)
// modules. Run as a pure pass-through and drop every existing cache so
// already-poisoned browsers heal on the next SW update check.
const IS_DEV = BUILD_HASH.startsWith('__')
const SHELL_CACHE = `mbus-shell-${BUILD_HASH}`
const RUNTIME_CACHE = `mbus-runtime-${BUILD_HASH}`
const RUNTIME_MAX_ENTRIES = 64
const APP_BASE = new URL('./', self.location.href).pathname
const SHELL_URLS = [APP_BASE, `${APP_BASE}manifest.webmanifest`, `${APP_BASE}mbus-mark.svg`]

async function precache() {
  if (IS_DEV) return
  const cache = await caches.open(SHELL_CACHE)
  await cache.addAll(SHELL_URLS)
  try {
    const response = await fetch(`${APP_BASE}precache-manifest.json`, { cache: 'no-store' })
    if (response.ok) {
      const assets = await response.json()
      if (Array.isArray(assets)) {
        await cache.addAll(assets.map((path) => `${APP_BASE}${path}`))
      }
    }
  } catch {
    // Offline precache of hashed assets is best-effort; ignore failures.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => IS_DEV || (key !== SHELL_CACHE && key !== RUNTIME_CACHE))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - maxEntries; i += 1) {
    await cache.delete(keys[i])
  }
}

self.addEventListener('fetch', (event) => {
  if (IS_DEV) return // pass-through: never answer from caches in dev
  const { request } = event
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return

  // Network-first for navigations: a stale cached index.html points at hashed
  // asset URLs that no longer exist after a deploy, which renders a blank page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)))
          }
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached ?? caches.match(APP_BASE))),
    )
    return
  }

  // Cache-first for everything else: built assets are content-hashed and immutable.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          event.waitUntil(
            caches.open(RUNTIME_CACHE)
              .then((cache) => cache.put(request, copy))
              .then(() => trimCache(RUNTIME_CACHE, RUNTIME_MAX_ENTRIES)),
          )
        }
        return response
      })
    }),
  )
})
