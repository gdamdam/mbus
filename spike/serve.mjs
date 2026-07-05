#!/usr/bin/env node
/**
 * Zero-dependency static server for the mbus spike pages.
 *
 * Serves the repo root so the pages can import the built client library
 * (/packages/mbus-client/dist/index.js) with plain ES module paths.
 * Localhost only — this is a dev harness, not a deployment story.
 *
 * Usage: node spike/serve.mjs [port]   (default 8137)
 * Then open http://localhost:8137/spike/sender.html
 *       and http://localhost:8137/spike/receiver.html
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.argv[2] ?? 8137)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // Resolve inside the repo root only.
    const path = normalize(join(root, decodeURIComponent(url.pathname)))
    if (!path.startsWith(root)) {
      res.writeHead(403).end('forbidden')
      return
    }
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`mbus spike: http://localhost:${port}/spike/sender.html`)
  console.log(`            http://localhost:${port}/spike/receiver.html`)
  console.log(`            http://localhost:${port}/spike/loopback.html`)
})
