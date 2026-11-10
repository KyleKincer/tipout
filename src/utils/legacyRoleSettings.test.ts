import { legacySettingsOn, versionsFromLegacy, type LegacyConfig } from './legacyRoleSettings'

// The production server role before dated versions: the 25% bar rate was closed and the 20% rate
// opened at 02:02 on May 6, so May 6 shifts (stored at midnight) still used 25%.
const server: LegacyConfig[] = [
  { tipoutType: 'sa', percentageRate: 4, effectiveFrom: '2025-03-24T00:00:00.000Z', effectiveTo: null, paysTipout: true, tipPoolGroup: 'server' },
  { tipoutType: 'host', percentageRate: 7, effectiveFrom: '2025-03-24T00:00:00.000Z', effectiveTo: null, paysTipout: true, tipPoolGroup: 'server' },
  { tipoutType: 'bar', percentageRate: 25, effectiveFrom: '2025-03-24T00:00:00.000Z', effectiveTo: '2025-05-06T02:02:51.067Z', paysTipout: true, tipPoolGroup: 'server' },
  { tipoutType: 'bar', percentageRate: 20, effectiveFrom: '2025-05-06T02:02:51.067Z', effectiveTo: null, paysTipout: true, tipPoolGroup: null },
]

describe('legacy settings conversion', () => {
  it('matches what the old calculation used on each date', () => {
    const rate = (day: string) => legacySettingsOn(server, 3, day).tipouts.find(t => t.tipoutType === 'bar')?.percentageRate
    expect(rate('2025-05-06')).toBe(25)
    expect(rate('2025-05-07')).toBe(20)
    // The 20% config has no pool, but host and SA still do, so the role stays pooled.
    expect(legacySettingsOn(server, 3, '2026-10-26').tipPoolGroup).toBe('server')
    expect(legacySettingsOn(server, 3, '2025-03-23')).toEqual({ basePayRate: 3, tipPoolGroup: null, tipouts: [] })
  })

  it('builds contiguous versions from the first shift date', () => {
    const versions = versionsFromLegacy(server, 3, '2025-02-25')
    expect(versions.map(v => [v.effectiveFrom, v.effectiveTo])).toEqual([
      ['2025-02-25', '2025-03-24'],
      ['2025-03-24', '2025-05-07'],
      ['2025-05-07', null],
    ])
  })

  it('drops a pays flag on a 0% tipout the role receives', () => {
    const bar: LegacyConfig[] = [{ tipoutType: 'bar', percentageRate: 0, effectiveFrom: '2025-03-24T00:00:00.000Z', effectiveTo: null, paysTipout: true, receivesTipout: true, distributionGroup: 'bartenders' }]
    expect(legacySettingsOn(bar, 9.75, '2025-04-01').tipouts).toEqual([
      { tipoutType: 'bar', percentageRate: 0, paysTipout: false, receivesTipout: true, distributionGroup: 'bartenders' },
    ])
  })
})
