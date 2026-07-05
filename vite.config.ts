import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

// Consume the mbus-client library from its TypeScript source rather than a
// prebuilt dist. The library is dependency-free strict ESM in the same repo
// (packages/mbus-client); aliasing to its source means one `npm install`, one
// build, and no dist-build-ordering step. The library stays authoritative and
// unmodified — the app only imports its public entry. tsc resolves the same
// alias via the `paths` entry in tsconfig.app.json.
const mbusClient = resolve(__dirname, 'packages/mbus-client/src/index.ts')

// Emit a JSON list of the content-hashed build assets so the service worker can
// precache them at install, and stamp a per-build fingerprint into the copied
// public/sw.js so its bytes change between deploys (browsers skip identical SW
// bytes). Pattern derived from mkeys — see NOTICE.
function precacheManifest(): Plugin {
  let outDir = 'dist'
  let root = process.cwd()
  return {
    name: 'mbus-precache-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
      root = config.root
    },
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((fileName) => !fileName.endsWith('.html') && fileName !== 'precache-manifest.json')
        .sort()
      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify(assets),
      })
    },
    closeBundle() {
      const dest = resolve(root, outDir, 'sw.js')
      const source = existsSync(dest) ? dest : resolve(root, 'public/sw.js')
      if (!existsSync(source)) return
      const assets = (() => {
        try {
          return JSON.parse(readFileSync(resolve(root, outDir, 'precache-manifest.json'), 'utf8'))
        } catch {
          return []
        }
      })()
      const buildHash = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12)
      const patched = readFileSync(source, 'utf8').replace(/__BUILD_HASH__/g, buildHash)
      writeFileSync(dest, patched)
    },
  }
}

// Custom domain serves from the root, so base is '/'. VITE_BASE_PATH allows
// building for a subpath preview (e.g. a GitHub Pages project site) if needed.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: { 'mbus-client': mbusClient },
  },
  plugins: [react(), precacheManifest()],
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
