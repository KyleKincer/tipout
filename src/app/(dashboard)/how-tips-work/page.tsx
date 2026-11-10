import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { buildExampleNight, summarizeRoleRates, type RateRole } from '@/utils/howTipsWork'
import { loadVersions } from '@/lib/roleData'
import { formatDay } from '@/utils/dateLabels'
import { isDateOnly, todayInRestaurant, toEngineRole, versionOn, type DateOnly } from '@/utils/roleVersions'
import type { TipoutType } from '@/types/reports'

// Rates come straight from role settings, so always render with the current values.
export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<TipoutType, string> = { bar: 'bar', host: 'host', sa: 'SA' }
const TYPE_BASE: Record<TipoutType, string> = { bar: 'of liquor sales', host: 'of tips', sa: 'of tips' }
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`
const pct = (n: number) => `${Number(n.toFixed(2))}%`

/** Each role's settings on the given day, from its dated settings history. */
async function loadRoles(day: DateOnly): Promise<RateRole[]> {
  const roles = await prisma.role.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
  const versions = await loadVersions(prisma)
  return roles.map(role => {
    const engine = toEngineRole(role.name, versionOn(versions.get(role.id) ?? [], day), day)
    return { name: role.name, basePayRate: engine.basePayRate, configs: engine.configs, tipPoolGroup: engine.tipPoolGroup }
  })
}

const card = 'bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-5 sm:p-6'
const h2 = 'text-base font-semibold text-[var(--foreground)] mb-3'
const muted = 'text-gray-600 dark:text-gray-400'
const th = 'py-2 px-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400'
const td = 'py-2 px-2 align-top'
const num = 'text-right tabular-nums whitespace-nowrap'
const neg = 'text-red-600 dark:text-red-400'
const label = 'mt-5 mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400'

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="relative pl-9">
      <span className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
        {n}
      </span>
      <p className="font-medium text-[var(--foreground)]">{title}</p>
      <div className={`mt-1 ${muted}`}>{children}</div>
    </li>
  )
}

export default async function HowTipsWorkPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams
  const todayDay = todayInRestaurant()
  const day = isDateOnly(date) ? date : todayDay
  const roles = await loadRoles(day)
  const today = new Date(`${day}T12:00:00.000Z`)
  const rates = summarizeRoleRates(roles, today)
  const example = buildExampleNight(roles, today)

  const pools = new Map<string, string[]>()
  for (const r of rates) if (r.poolGroup) pools.set(r.poolGroup, [...(pools.get(r.poolGroup) ?? []), r.name])
  const poolSentence = [...pools.values()]
    .map(names => (names.length === 1 ? `${names[0]}s pool with each other` : `${names.join(' and ')} pool together`))
    .join('; ')

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto text-sm">
      <h1 className="text-2xl font-semibold text-[var(--foreground)]">how tips work</h1>
      <p className={`mt-2 max-w-2xl leading-relaxed ${muted}`}>
        Every night is worked out on its own, using only the shifts entered for that date. Here&apos;s what happens to
        the tips you bring in, and how we get to the <em>payroll tips</em> number on your check.
      </p>

      <section className={`mt-6 ${card}`}>
        <h2 className={h2}>the short version</h2>
        <ol className="space-y-4 leading-relaxed">
          <Step n={1} title="Tipouts are based on what you brought in.">
            Bar tipout is a percentage of your own liquor sales. Host and server assistant tipouts are a percentage of
            your total tips (cash + credit). A tipout only applies when someone in that role worked that night.
          </Step>
          <Step n={2} title={pools.size > 0 ? 'Some roles pool their tips.' : 'Your tips are your own.'}>
            {pools.size > 0 ? (
              <>
                Right now {poolSentence}. A pool adds up everyone&apos;s credit tips, pays the host and SA tipouts out
                of the total, then splits what&apos;s left by hours worked. Cash is pooled and split by hours the same
                way. Roles that don&apos;t pool keep their own tips and pay their own tipouts.
              </>
            ) : (
              <>No roles pool tips right now, so you keep your own tips and pay your own tipouts.</>
            )}
          </Step>
          <Step n={3} title="Bar tipout goes to the bartenders.">
            Each server pays their own bar tipout from their own liquor sales. The night&apos;s bar tipout is split
            between the bartenders by hours.
          </Step>
          <Step n={4} title="Host and SA tipouts are split by hours too.">
            If two hosts worked, the one who worked more hours gets more of the host tipout.
          </Step>
          <Step n={5} title="Payroll tips are what's left on the credit side.">
            <pre className="mt-1 rounded-md bg-gray-100 dark:bg-gray-900 px-3 py-2 font-mono text-[13px] leading-6 text-[var(--foreground)] whitespace-pre-wrap">
              {'payroll tips = your credit tips (or pool share)\n  + tipouts you received\n  − tipouts you paid'}
            </pre>
            <p className="mt-2">
              In a pool, host and SA tipouts are already taken out before the split, so only bar tipout comes off
              your share. Cash tips aren&apos;t part of payroll tips.
            </p>
          </Step>
        </ol>
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className={card}>
          <h2 className={h2}>{day === todayDay ? 'current rates' : `rates on ${formatDay(day)}`}</h2>
          <table className="w-full">
            <thead className="border-b border-gray-200 dark:border-gray-700">
              <tr><th className={th}>role</th><th className={th}>pays</th><th className={th}>pools with</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {rates.map(r => (
                <tr key={r.name}>
                  <td className={`${td} text-[var(--foreground)]`}>{r.name}</td>
                  <td className={td}>
                    {r.pays.map(p => (
                      <span key={p.type} className="mr-1 mb-1 inline-block whitespace-nowrap rounded-full border border-gray-300 dark:border-gray-600 px-2 text-xs">
                        {TYPE_LABEL[p.type]} {pct(p.rate)} {TYPE_BASE[p.type]}
                      </span>
                    ))}
                    {r.receives.length > 0 && (
                      <span className={`text-xs ${muted}`}>
                        receives {r.receives.map(t => TYPE_LABEL[t]).join(' and ')} tipout
                      </span>
                    )}
                  </td>
                  <td className={`${td} ${muted}`}>{r.poolGroup ? `${r.poolGroup} pool` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`mt-3 text-xs ${muted}`}>
            Read from each role&apos;s settings for {day === todayDay ? 'today' : formatDay(day)}. Rates change on set dates, and every shift uses the rates for its own date.{' '}
            {day === todayDay ? <>Add <code>?date=YYYY-MM-DD</code> to the address to see an earlier date.</> : <Link href="/how-tips-work" className="underline">Show today</Link>}
          </p>
        </section>

        <section className={card}>
          <h2 className={h2}>why is my payroll number lower than my credit tips?</h2>
          <p className="leading-relaxed text-[var(--foreground)]">
            Tipouts come out first: bar tipout from your liquor sales, host and SA from your tips.
            {pools.size > 0 && (
              <> If you&apos;re in a pool, your share also depends on everyone else&apos;s night. When you had a big
              night and someone else had a slow one, part of your tips goes to them, and the other way round on a slow
              night.</>
            )}
          </p>
          <p className="mt-3 leading-relaxed text-[var(--foreground)]">
            On the <Link href="/shifts" className="underline">shifts</Link> page, click any payroll tips amount to see the
            line-by-line math for that shift.
          </p>
        </section>
      </div>

      {example && (
        <section className={`mt-4 ${card}`}>
          <h2 className={h2}>example night</h2>
          <p className={`mb-3 ${muted}`}>
            Two {example.serverRole}s, one bartender and one host, using {day === todayDay ? 'today’s' : `${formatDay(day)}’s`} rates. No server assistant, so no
            SA tipout.
          </p>
          <table className="w-full">
            <thead className="border-b border-gray-200 dark:border-gray-700">
              <tr><th className={th}></th><th className={`${th} ${num}`}>hours</th><th className={`${th} ${num}`}>credit tips</th><th className={`${th} ${num}`}>liquor sales</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {example.servers.map(s => (
                <tr key={s.label}>
                  <td className={td}>{s.label}</td><td className={`${td} ${num}`}>{s.hours}</td>
                  <td className={`${td} ${num}`}>{money(s.creditTips)}</td><td className={`${td} ${num}`}>{money(s.liquorSales)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {example.pool && (
            <>
              <p className={label}>the {example.serverRole} pool</p>
              <table className="w-full">
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  <tr><td className={td}>credit tips in the pool ({example.servers.map(s => money(s.creditTips)).join(' + ')})</td><td className={`${td} ${num}`}>{money(example.pool.creditTips)}</td></tr>
                  <tr><td className={td}>host tipout, {pct(example.rates.host)} of {money(example.pool.creditTips)}, paid by the pool</td><td className={`${td} ${num} ${neg}`}>{money(-example.pool.hostPaid)}</td></tr>
                  <tr><td className={td}>left to split over {example.pool.hours} hours</td><td className={`${td} ${num}`}>{money(example.pool.left)}</td></tr>
                  <tr className="font-semibold"><td className={td}>per hour</td><td className={`${td} ${num}`}>{money(example.pool.perHour)}</td></tr>
                </tbody>
              </table>
            </>
          )}

          <p className={label}>each {example.serverRole}&apos;s payroll tips</p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className={th}></th>
                  <th className={`${th} ${num}`}>{example.pool ? 'pool share' : 'credit tips − host'}</th>
                  <th className={`${th} ${num}`}>bar tipout paid</th>
                  <th className={`${th} ${num}`}>payroll tips</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {example.servers.map(s => (
                  <tr key={s.label}>
                    <td className={td}>{s.label}</td>
                    <td className={`${td} ${num}`}>
                      {example.pool
                        ? `${s.hours}h × ${money(example.pool.perHour)} = ${money(s.poolShare)}`
                        : `${money(s.creditTips)} − ${money(s.paidHost)} = ${money(s.ownNet)}`}
                    </td>
                    <td className={`${td} ${num} ${neg}`}>{pct(example.rates.bar)} × {money(s.liquorSales)} = {money(-s.paidBar)}</td>
                    <td className={`${td} ${num} font-semibold`}>{money(s.payrollTips)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {example.pool && (() => {
            const a = example.servers[0]
            return (
              <p className="mt-4 rounded-r-md border-l-4 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-2 leading-relaxed text-[var(--foreground)]">
                {a.label} brought in {money(a.creditTips)} and gets {money(a.payrollTips)} on payroll:{' '}
                {money(a.paidHost)} was their part of the host tipout, {money(a.ownNet - a.poolShare)} went to{' '}
                {example.servers[1].label} through the pool, and {money(a.paidBar)} went to the bar. On a night when{' '}
                {a.label} is slow and {example.servers[1].label} is busy, it runs the other way.
              </p>
            )
          })()}
          <p className={`mt-3 text-xs ${muted}`}>
            The bartender gets {money(example.bartenderReceived)} in bar tipout on top of their own tips. The host gets{' '}
            {money(example.hostReceived)} in host tipout from the {example.serverRole}s and the bartender.
          </p>
        </section>
      )}

      <section className={`mt-4 ${card}`}>
        <h2 className={h2}>good to know</h2>
        <ul className="list-disc space-y-1 pl-5 leading-relaxed text-[var(--foreground)]">
          <li>Working alone in a pooled role? There&apos;s no one to pool with, so your share is your own tips minus host and SA tipouts.</li>
          <li>Numbers are worked out fresh whenever a page loads, so a corrected shift updates everyone&apos;s totals for that night.</li>
        </ul>
      </section>
    </div>
  )
}
