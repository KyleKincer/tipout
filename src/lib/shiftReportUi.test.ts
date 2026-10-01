import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import { transpileModule, ModuleKind, ScriptTarget, JsxEmit } from 'typescript'
import { calculateDailyReport } from './reportCalculations'
import { filterShiftReportResults } from './shiftReportRows'
import { resolveEmployeeFilterId } from './employeeFilter'
import type { Shift } from '@/types/reports'

// Render the actual page source with deterministic framework/auth/data adapters.
// No production auth/data is bypassed: this is an isolated component test.
const source = readFileSync(join(__dirname, '../app/(dashboard)/shifts/page.tsx'), 'utf8')
const code = transpileModule(source, { compilerOptions: {
  module: ModuleKind.CommonJS, target: ScriptTarget.ES2020, jsx: JsxEmit.ReactJSX,
} }).outputText
const rows: Shift[] = [
  { id: 'bar', employee: { id: 'bar', name: 'Bartender' }, date: '2026-09-29T00:00:00.000Z', hours: 6.86,
    cashTips: 0, creditTips: 153.2, liquorSales: 0, role: { name: 'bar', basePayRate: 0, configs: [
      { id: 'bar', tipoutType: 'bar', percentageRate: 0, effectiveFrom: '2025-01-01', effectiveTo: null,
        paysTipout: false, receivesTipout: true, distributionGroup: 'bar' },
    ] } },
  { id: 'server', employee: { id: 'server', name: 'Server' }, date: '2026-09-29T00:00:00.000Z', hours: 5.97,
    cashTips: 0, creditTips: 274.6, liquorSales: 304, role: { name: 'server', basePayRate: 0, configs: [
      { id: 'server', tipoutType: 'bar', percentageRate: 20, effectiveFrom: '2025-01-01', effectiveTo: null,
        paysTipout: true, receivesTipout: false },
    ] } },
]

function renderPage(employeeId = '') {
  const report = calculateDailyReport(rows)
  const mockModule = { exports: {} as { default: React.ComponentType } }
  const mockedReact = { ...React, useEffect: () => {} }
  const modules: Record<string, unknown> = {
    react: mockedReact,
    'next/navigation': { useSearchParams: () => new URLSearchParams({startDate:'2026-09-29',endDate:'2026-09-30',employeeId}), useRouter: () => ({push: () => {}}), usePathname: () => '/shifts' },
    'next/link': { __esModule: true, default: ({ children, ...props }: React.ComponentProps<'a'>) => React.createElement('a', props, children) },
    '@/components/LoadingSpinner': { __esModule: true, default: () => null },
    '@/components/RoleBasedUI': { AdminOnly: () => null },
    '@/lib/shiftReportRows': { filterShiftReportResults },
    '@/lib/employeeFilter': { resolveEmployeeFilterId },
    'convex/react': { useMutation: () => () => Promise.resolve() },
    '../../../../convex/_generated/api': { api: { reports: { get: 'report' }, employees: { list: 'employees' }, shifts: { remove: 'remove' } } },
    '@/lib/useAuthenticatedQuery': { useAuthenticatedQuery: (ref: string, args: unknown) => {
      if (ref === 'report') {
        expect(args).toEqual({ startDate: '2026-09-29', endDate: '2026-09-30' })
        return report
      }
      return rows.map(row => ({ ...row.employee, legacyId: `legacy-${row.employee.id}` }))
    } },
  }
  const localRequire = (id: string) => id in modules ? modules[id] : jest.requireActual(id)
  new Function('require', 'module', 'exports', code)(localRequire, mockModule, mockModule.exports)
  return renderToStaticMarkup(React.createElement(mockModule.exports.default))
}

describe('Shifts page report-aligned rendering', () => {
  it('renders received green, paid negative red, and payroll without the rejected banner', () => {
    const html = renderPage()
    expect(html).toMatch(/text-green-600[^>]*>\$60\.80<\/td>/)
    expect(html).toMatch(/text-red-600[^>]*>\$-60\.80<\/td>/)
    expect(html).toContain('$214.00')
    expect(html).toContain('$213.80')
    expect(html).toContain('gross credit tips')
    expect(html).toContain('payroll tips')
    expect(html).not.toContain('payroll total')
    expect(html).not.toContain('base pay rate')
    expect(html).not.toContain('total $/hour')
    expect(html).not.toContain('This table shows tipouts paid')
    expect(html).not.toContain('View received tipouts')
    expect(html).not.toContain('bar tipout paid')
  })

  it('renders the same received amount for a non-admin filtering to the bartender', () => {
    const html = renderPage('legacy-bar')
    expect(html).toMatch(/text-green-600[^>]*>\$60\.80<\/td>/)
    expect(html).not.toContain('$-60.80')
    expect(html).not.toContain('>edit<')
    expect(html).toContain('value="2026-09-30"')
  })
})
