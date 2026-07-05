import { describe, expect, it } from 'vitest'
import type { SourceInfo } from 'mbus-client'
import { reconcile, type DesiredMap } from './reconcile'

const src = (sourceId: string, name: string, clientId = 'c1'): SourceInfo => ({
  sourceId,
  name,
  clientId,
})

describe('reconcile', () => {
  it('subscribes a wanted source that is not yet active', () => {
    const sources = [src('s1', 'mchord')]
    const desired: DesiredMap = { mchord: { enabled: true, db: 0 } }
    const plan = reconcile(sources, desired, new Map())
    expect(plan.subscribe.map((s) => s.sourceId)).toEqual(['s1'])
    expect(plan.close).toEqual([])
  })

  it('does nothing for a wanted source already active', () => {
    const sources = [src('s1', 'mchord')]
    const desired: DesiredMap = { mchord: { enabled: true, db: 0 } }
    const active = new Map([['s1', 'mchord']])
    const plan = reconcile(sources, desired, active)
    expect(plan.subscribe).toEqual([])
    expect(plan.close).toEqual([])
  })

  it('does not subscribe sources that are present but not enabled', () => {
    const sources = [src('s1', 'mchord')]
    const plan = reconcile(sources, { mchord: { enabled: false, db: 0 } }, new Map())
    expect(plan.subscribe).toEqual([])
  })

  it('closes an active sub whose source vanished (publisher died)', () => {
    const desired: DesiredMap = { mchord: { enabled: true, db: 0 } }
    const active = new Map([['s1', 'mchord']])
    const plan = reconcile([], desired, active)
    expect(plan.close).toEqual(['s1'])
    expect(plan.subscribe).toEqual([])
  })

  it('re-wires by name: publisher restart with a fresh sourceId', () => {
    // Old sub was s1; the publisher reloaded and now advertises the same name
    // under s2. Expect: close s1, subscribe s2.
    const desired: DesiredMap = { mchord: { enabled: true, db: 0 } }
    const active = new Map([['s1', 'mchord']])
    const plan = reconcile([src('s2', 'mchord')], desired, active)
    expect(plan.close).toEqual(['s1'])
    expect(plan.subscribe.map((s) => s.sourceId)).toEqual(['s2'])
  })

  it('closes an active sub when the user disables its name', () => {
    const active = new Map([['s1', 'mchord']])
    const plan = reconcile([src('s1', 'mchord')], { mchord: { enabled: false, db: 0 } }, active)
    expect(plan.close).toEqual(['s1'])
  })

  it('keeps at most one live subscription per duplicate name', () => {
    const sources = [src('s1', 'drums'), src('s2', 'drums')]
    const desired: DesiredMap = { drums: { enabled: true, db: 0 } }
    const plan = reconcile(sources, desired, new Map())
    expect(plan.subscribe.map((s) => s.sourceId)).toEqual(['s1'])
  })

  it('does not re-subscribe a duplicate name already covered by a live sub', () => {
    const sources = [src('s1', 'drums'), src('s2', 'drums')]
    const desired: DesiredMap = { drums: { enabled: true, db: 0 } }
    const active = new Map([['s1', 'drums']])
    const plan = reconcile(sources, desired, active)
    expect(plan.subscribe).toEqual([])
    expect(plan.close).toEqual([])
  })
})
