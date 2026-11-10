import {
  addDays, checkTimeline, describeChanges, isDateOnly, planUndoLatest, planVersionChange, settingsEqual,
  toEngineRole, versionOn, versionsInRange, type RoleSettings, type RoleVersion,
} from './roleVersions'

const pooled: RoleSettings = {
  basePayRate: 3,
  tipPoolGroup: 'server',
  tipouts: [
    { tipoutType: 'bar', percentageRate: 20, paysTipout: true, receivesTipout: false, distributionGroup: null },
    { tipoutType: 'host', percentageRate: 7, paysTipout: true, receivesTipout: false, distributionGroup: null },
  ],
}
const unpooled: RoleSettings = { ...pooled, tipPoolGroup: null }

const version = (id: string, from: string, to: string | null, settings: RoleSettings): RoleVersion => ({
  id, roleId: 'server', effectiveFrom: from, effectiveTo: to, ...settings,
})
const history = [
  version('v1', '2025-03-24', '2025-05-07', { ...pooled, tipouts: [{ ...pooled.tipouts[0], percentageRate: 25 }, pooled.tipouts[1]] }),
  version('v2', '2025-05-07', null, pooled),
]

describe('dated role settings', () => {
  it('finds the version for a day, with exclusive end dates', () => {
    expect(versionOn(history, '2025-05-06')?.id).toBe('v1')
    expect(versionOn(history, '2025-05-07')?.id).toBe('v2')
    expect(versionOn(history, '2025-03-23')).toBeNull()
    expect(versionsInRange(history, '2025-05-01', '2025-05-31').map(v => v.id)).toEqual(['v1', 'v2'])
    expect(versionsInRange(history, '2025-05-07', '2025-05-31').map(v => v.id)).toEqual(['v2'])
  })

  it('turns pooling off from a date without touching earlier days', () => {
    const plan = planVersionChange(history, unpooled, '2026-11-16')
    expect(plan).toEqual({
      ok: true, kind: 'create',
      create: { effectiveFrom: '2026-11-16', settings: expect.objectContaining({ tipPoolGroup: null }) },
      close: { id: 'v2', effectiveTo: '2026-11-16' },
      changes: ['stops pooling tips (was the server pool)'],
    })
  })

  it('refuses dates before the latest change, inside a locked period, or with nothing changed', () => {
    expect(planVersionChange(history, unpooled, '2025-04-01')).toMatchObject({ ok: false, error: expect.stringContaining('already change on 2025-05-07') })
    expect(planVersionChange(history, unpooled, '2026-11-01', [{ startDate: '2026-10-19', endDate: '2026-11-01' }]))
      .toMatchObject({ ok: false, error: expect.stringContaining('locked through 2026-11-01') })
    expect(planVersionChange(history, pooled, '2026-11-16')).toEqual({ ok: false, error: 'Nothing changed.' })
    expect(planVersionChange(history, unpooled, 'Nov 16')).toMatchObject({ ok: false })
  })

  it('corrects the latest change in place when saved on the same start date', () => {
    const plan = planVersionChange(history, { ...pooled, basePayRate: 3.5 }, '2025-05-07')
    expect(plan).toMatchObject({ ok: true, kind: 'replace', replace: { id: 'v2' } })
    // Correcting it back to what came before folds it into the earlier version.
    const back = planVersionChange(history, history[0], '2025-05-07')
    expect(back).toMatchObject({ ok: true, kind: 'merge', delete: 'v2', reopen: 'v1' })
  })

  it('undoes the latest change unless it is locked', () => {
    expect(planUndoLatest(history)).toMatchObject({ ok: true, delete: 'v2', reopen: 'v1' })
    expect(planUndoLatest(history, [{ startDate: '2025-05-01', endDate: '2025-05-14' }])).toMatchObject({ ok: false })
    expect(planUndoLatest([history[0]])).toMatchObject({ ok: false })
  })

  it('rejects settings that cannot work', () => {
    const both = { ...pooled, tipouts: [{ tipoutType: 'bar' as const, percentageRate: 0, paysTipout: true, receivesTipout: true, distributionGroup: 'x' }] }
    expect(planVersionChange(history, both, '2026-12-01')).toMatchObject({ ok: false, error: expect.stringContaining("can't both pay and receive") })
    const ungrouped = { ...pooled, tipouts: [{ tipoutType: 'host' as const, percentageRate: 0, paysTipout: false, receivesTipout: true, distributionGroup: '' }] }
    expect(planVersionChange(history, ungrouped, '2026-12-01')).toMatchObject({ ok: false, error: expect.stringContaining('who shares') })
  })

  it('describes changes in plain words and ignores formatting differences', () => {
    expect(describeChanges(history[0], history[1])).toEqual(['bar tipout 25% → 20%'])
    expect(describeChanges(pooled, { ...unpooled, basePayRate: 4 })).toEqual(['base pay $3.00 → $4.00', 'stops pooling tips (was the server pool)'])
    expect(settingsEqual(pooled, { ...pooled, tipPoolGroup: ' server ', tipouts: [...pooled.tipouts].reverse() })).toBe(true)
  })

  it('flags overlapping or gapped timelines', () => {
    expect(checkTimeline(history)).toEqual([])
    expect(checkTimeline([history[0], { ...history[1], effectiveFrom: '2025-05-01' }])).toEqual([expect.stringContaining('overlap')])
    expect(checkTimeline([history[0], { ...history[1], effectiveFrom: '2025-05-09' }])).toEqual([expect.stringContaining('gap')])
  })

  it('gives the calculation only the settings for the shift date, pool included', () => {
    const role = toEngineRole('server', history[1], '2026-01-05')
    expect(role).toMatchObject({ name: 'server', basePayRate: 3, tipPoolGroup: 'server', versionId: 'v2' })
    expect(role.configs.map(c => [c.tipoutType, c.percentageRate])).toEqual([['bar', 20], ['host', 7]])
    expect(toEngineRole('wine', null, '2026-01-05')).toMatchObject({ basePayRate: 0, tipPoolGroup: null, configs: [] })
  })

  it('handles calendar dates without time zone drift', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(isDateOnly('2026-02-30')).toBe(false)
  })
})
