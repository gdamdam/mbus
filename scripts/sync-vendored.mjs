#!/usr/bin/env node
/**
 * Check or re-sync the mbus-client copies vendored into sibling instrument
 * repos. The canonical source is packages/mbus-client/src; each registered
 * sibling carries a byte-for-byte copy of client.ts + protocol.ts under
 * src/transport/mbus/ (its index.ts is per-repo — it holds the credit header —
 * so it is required to exist but never compared or copied).
 *
 *   npm run vendored:check   # exit 1 if any copy is stale/missing (default)
 *   npm run vendored:sync    # re-copy client.ts + protocol.ts to all siblings
 *
 * Add new consumers/publishers to SIBLINGS as the suite rollout lands them.
 * Siblings are sister checkouts of this repo (../<name>); a missing checkout
 * fails the check — clone it or remove it from the list.
 */

import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIBLINGS = ['mfx', 'mchord', 'mkeys', 'mdrone', 'mgrains', 'mvox']
const FILES = ['client.ts', 'protocol.ts']

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const upstream = join(root, 'packages', 'mbus-client', 'src')
const mode = process.argv.includes('--sync') ? 'sync' : 'check'

let failures = 0
const note = (s) => console.log(s)

for (const sib of SIBLINGS) {
  const dir = join(root, '..', sib, 'src', 'transport', 'mbus')
  if (!existsSync(dir)) {
    note(`✗ ${sib}: ${dir} missing (repo not cloned, or not yet wired?)`)
    failures++
    continue
  }
  if (!existsSync(join(dir, 'index.ts'))) {
    note(`✗ ${sib}: index.ts (credit header) missing`)
    failures++
  }
  for (const f of FILES) {
    const src = join(upstream, f)
    const dst = join(dir, f)
    const same = existsSync(dst) && readFileSync(dst).equals(readFileSync(src))
    if (same) {
      note(`✓ ${sib}/${f} in sync`)
    } else if (mode === 'sync') {
      copyFileSync(src, dst)
      note(`↻ ${sib}/${f} re-copied`)
    } else {
      note(`✗ ${sib}/${f} ${existsSync(dst) ? 'DIFFERS from upstream' : 'missing'}`)
      failures++
    }
  }
}

if (mode === 'check' && failures > 0) {
  note(`\n${failures} problem(s). Run \`npm run vendored:sync\` to re-copy.`)
  process.exit(1)
}
note(mode === 'sync' ? '\nAll siblings synced.' : '\nAll vendored copies in sync.')
