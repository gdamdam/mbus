/*
 * reconcile.ts — pure patch reconciliation.
 *
 * The user's routing intent is keyed by source *name* (the only key stable
 * across a publisher restart — sourceIds die with the connection, per
 * docs/protocol.md and HANDOFF §"Deliberate deferrals"). The bridge directory,
 * meanwhile, is keyed by sourceId. This module diffs the two into a concrete
 * subscribe/close plan so the patchbay re-wires by name automatically when a
 * publisher reloads with a fresh sourceId.
 *
 * Pure: no client, no Web Audio, no DOM — the whole re-wire policy is testable.
 */

import type { SourceInfo } from 'mbus-client'

/** Per-name routing intent set by the user (enable + fader position in dB). */
export interface DesiredChannel {
  enabled: boolean
  db: number
}

export type DesiredMap = Readonly<Record<string, DesiredChannel>>

/** What the caller currently holds a live subscription for: sourceId → name. */
export type ActiveMap = ReadonlyMap<string, string>

export interface ReconcilePlan {
  /** sourceIds to subscribe now (wanted, not yet active). */
  subscribe: SourceInfo[]
  /** sourceIds to close now (active but gone from the directory, or unwanted). */
  close: string[]
}

/**
 * Diff a directory snapshot against user intent and the live subscriptions.
 *
 * Policy:
 *  - At most one live subscription per *name*. If several sources advertise the
 *    same name (protocol allows duplicates), the first in the snapshot wins;
 *    the rest are left alone. This keeps re-wire-by-name unambiguous.
 *  - A wanted name with no live sub gets subscribed to its current sourceId.
 *  - A live sub is closed when its sourceId left the directory (publisher died)
 *    or its name is no longer enabled.
 */
export function reconcile(
  sources: readonly SourceInfo[],
  desired: DesiredMap,
  active: ActiveMap,
): ReconcilePlan {
  const present = new Set(sources.map((s) => s.sourceId))
  const close: string[] = []

  // Close anything that vanished or is no longer wanted; track which names
  // remain covered by a surviving live subscription.
  const coveredNames = new Set<string>()
  for (const [sourceId, name] of active) {
    const stillWanted = desired[name]?.enabled === true
    if (!present.has(sourceId) || !stillWanted) {
      close.push(sourceId)
    } else {
      coveredNames.add(name)
    }
  }

  // Subscribe wanted names that have no surviving live subscription, first
  // matching source per name.
  const subscribe: SourceInfo[] = []
  for (const s of sources) {
    if (desired[s.name]?.enabled !== true) continue
    if (coveredNames.has(s.name)) continue
    if (active.has(s.sourceId) && !close.includes(s.sourceId)) continue
    coveredNames.add(s.name)
    subscribe.push(s)
  }

  return { subscribe, close }
}
