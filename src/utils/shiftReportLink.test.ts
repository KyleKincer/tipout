import { getShiftReportHref } from './shiftReportLink'

describe('getShiftReportHref', () => {
  it('uses the selected single date for both report boundaries', () => {
    expect(getShiftReportHref({ startDate: '2026-09-29', endDate: '2026-10-01' }, false))
      .toBe('/reports?startDate=2026-09-29&endDate=2026-09-29')
  })

  it('preserves a selected date range', () => {
    expect(getShiftReportHref({ startDate: '2026-09-29', endDate: '2026-10-01' }, true))
      .toBe('/reports?startDate=2026-09-29&endDate=2026-10-01')
  })

  it('preserves the employee filter without restricting source shifts used for payouts', () => {
    expect(getShiftReportHref({ startDate: '2026-09-29', endDate: '2026-09-29', employeeId: 'employee-1' }, false))
      .toBe('/reports?startDate=2026-09-29&endDate=2026-09-29&employeeId=employee-1')
  })

  it('omits an empty employee filter and safely encodes identifiers', () => {
    expect(getShiftReportHref({ startDate: '2026-09-29', endDate: '2026-09-29', employeeId: '' }, false))
      .not.toContain('employeeId')
    const href = getShiftReportHref({ startDate: '2026-09-29', endDate: '2026-09-29', employeeId: 'employee&role=bar' }, false)
    const params = new URL(href, 'https://example.com').searchParams
    expect(params.get('employeeId')).toBe('employee&role=bar')
    expect(params.has('role')).toBe(false)
  })
})
