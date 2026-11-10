'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import LoadingSpinner from '@/components/LoadingSpinner'
import { formatDay, formatSpan } from '@/utils/dateLabels'
import { TIPOUT_TYPES, type DateOnly, type RoleSettings, type RoleVersion, type VersionTipout } from '@/utils/roleVersions'
import type { TipoutType } from '@/types/reports'

type VersionView = RoleVersion & { summary: string; changes: string[] }
type RoleView = {
  id: string
  name: string
  active: boolean
  today: DateOnly
  current: RoleVersion | null
  versions: VersionView[]
  earliestChange: DateOnly | null
  lockedBefore: DateOnly | null
  shiftCount: number
  undoAffects: Affected | null
}
type Affected = { shifts: number; firstDate: DateOnly | null; lastDate: DateOnly | null }
type Plan =
  | { ok: true; kind: 'create' | 'replace' | 'merge'; changes: string[]; affects?: Affected }
  | { ok: false; error: string }

const affectedText = (a: Affected) =>
  `${a.shifts} ${a.shifts === 1 ? 'shift' : 'shifts'} already entered${a.firstDate ? ` (${formatDay(a.firstDate)}${a.lastDate && a.lastDate !== a.firstDate ? ` – ${formatDay(a.lastDate)}` : ''})` : ''}`

const TYPE_LABEL: Record<TipoutType, string> = { bar: 'bar', host: 'host', sa: 'server assistant (SA)' }
const BASE: Record<TipoutType, string> = { bar: 'of liquor sales', host: 'of total tips', sa: 'of total tips' }
const DEFAULT_GROUP: Record<TipoutType, string> = { bar: 'bartenders', host: 'hosts', sa: 'support' }

const input = 'block rounded-md border border-gray-300 shadow-sm px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white disabled:opacity-50'
const card = 'bg-white/50 dark:bg-gray-800/50 shadow sm:rounded-lg border border-gray-200 dark:border-gray-700'
const muted = 'text-gray-500 dark:text-gray-400'
const button = 'rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed'
const secondary = 'rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:text-white dark:ring-gray-700 dark:hover:bg-gray-700 disabled:opacity-50'

const emptySettings = (): RoleSettings => ({ basePayRate: 0, tipPoolGroup: null, tipouts: [] })
const maxDay = (...days: (DateOnly | null | undefined)[]) => days.filter((d): d is DateOnly => !!d).sort().pop() ?? ''

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}))
  return (data.error as string) || fallback
}

export default function EditRolePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const isNew = params.id === 'new'
  const [role, setRole] = useState<RoleView | null>(null)
  const [name, setName] = useState('')
  const [settings, setSettings] = useState<RoleSettings>(emptySettings())
  const [effectiveFrom, setEffectiveFrom] = useState<DateOnly>('')
  const [note, setNote] = useState('')
  const [suggestions, setSuggestions] = useState<{ pools: string[]; distributionGroups: string[] }>({ pools: [], distributionGroups: [] })
  const [plan, setPlan] = useState<Plan | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const groups = await fetch('/api/tip-pool-groups').then(r => (r.ok ? r.json() : { pools: [], distributionGroups: [] })).catch(() => ({ pools: [], distributionGroups: [] }))
    setSuggestions(groups)
    if (isNew) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
      setEffectiveFrom(today)
      setLoading(false)
      return
    }
    const response = await fetch(`/api/roles/${params.id}`)
    if (!response.ok) {
      setError(await readError(response, 'Failed to load role'))
      setLoading(false)
      return
    }
    const data: RoleView = await response.json()
    setRole(data)
    setName(data.name)
    const latest = data.versions[data.versions.length - 1]
    setSettings(latest ? { basePayRate: latest.basePayRate, tipPoolGroup: latest.tipPoolGroup, tipouts: latest.tipouts } : emptySettings())
    setEffectiveFrom(maxDay(data.today, data.earliestChange))
    setLoading(false)
  }, [isNew, params.id])

  useEffect(() => { load() }, [load])

  // Preview what saving would do, without saving.
  useEffect(() => {
    if (isNew || !role || !effectiveFrom) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/roles/${role.id}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ effectiveFrom, settings, dryRun: true }),
      }).catch(() => null)
      if (!response) return
      setConfirmed(false)
      if (response.ok) setPlan(await response.json())
      else setPlan({ ok: false, error: await readError(response, 'Could not check these settings') })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [isNew, role, settings, effectiveFrom])

  const tipout = (type: TipoutType, side: 'pays' | 'receives') =>
    settings.tipouts.find(t => t.tipoutType === type && (side === 'pays' ? t.paysTipout : t.receivesTipout))

  const setTipout = (type: TipoutType, next: Partial<VersionTipout> | null) => {
    setSettings(s => {
      const others = s.tipouts.filter(t => t.tipoutType !== type)
      if (!next) return { ...s, tipouts: others }
      const existing = s.tipouts.find(t => t.tipoutType === type)
      const merged: VersionTipout = {
        tipoutType: type, percentageRate: 0, paysTipout: false, receivesTipout: false, distributionGroup: null,
        ...existing, ...next,
      }
      return { ...s, tipouts: [...others, merged] }
    })
  }

  const latest = role?.versions[role.versions.length - 1]
  const correcting = !!latest && effectiveFrom === latest.effectiveFrom

  const saveSettings = async () => {
    setSaving(true); setError(null); setMessage(null)
    try {
      if (isNew) {
        const response = await fetch('/api/roles', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, effectiveFrom, settings, note }),
        })
        if (!response.ok) throw new Error(await readError(response, 'Failed to create role'))
        const created = await response.json()
        router.push(`/roles/${created.id}/edit`)
        return
      }
      const response = await fetch(`/api/roles/${role!.id}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effectiveFrom, settings, note, confirmAffected: confirmed }),
      })
      if (!response.ok) throw new Error(await readError(response, 'Failed to save settings'))
      setNote('')
      setMessage(`Saved. The new settings apply from ${formatDay(effectiveFrom)}; earlier shifts are unchanged.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const undoLatest = async () => {
    if (!role || !latest) return
    const recalculates = role.undoAffects?.shifts
      ? `\n\nThis recalculates ${affectedText(role.undoAffects)}, and everyone who worked those nights.`
      : ''
    if (!confirm(`Undo the change that starts ${formatDay(latest.effectiveFrom)}? The settings before it will apply from then on.${recalculates}`)) return
    setSaving(true); setError(null); setMessage(null)
    const response = await fetch(`/api/roles/${role.id}/versions?confirm=1`, { method: 'DELETE' })
    if (!response.ok) setError(await readError(response, 'Failed to undo'))
    else setMessage('Undone.')
    await load()
    setSaving(false)
  }

  const updateRole = async (body: { name?: string; active?: boolean }) => {
    setSaving(true); setError(null); setMessage(null)
    const response = await fetch(`/api/roles/${role!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) setError(await readError(response, 'Failed to update role'))
    else setMessage(body.active === false ? 'Archived.' : body.active ? 'Restored.' : 'Renamed.')
    await load()
    setSaving(false)
  }

  const deleteRole = async () => {
    if (!role || !confirm(`Delete ${role.name}? It has never been used on a shift.`)) return
    const response = await fetch(`/api/roles/${role.id}`, { method: 'DELETE' })
    if (!response.ok) setError(await readError(response, 'Failed to delete role'))
    else router.push('/roles')
  }

  const versionsNewestFirst = useMemo(() => [...(role?.versions ?? [])].reverse(), [role])

  if (loading) return <LoadingSpinner />

  return (
    <div className="px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{isNew ? 'new role' : role?.name}</h1>
        <Link href="/roles" className="text-indigo-600 hover:underline dark:text-indigo-400">← all roles</Link>
      </div>
      {role && !role.active && (
        <p className="mt-2 inline-block rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">archived: can&apos;t be picked for new shifts</p>
      )}

      {error && <div className="mt-4 rounded-md bg-red-50 p-3 text-red-800 dark:bg-red-900/50 dark:text-red-200">{error}</div>}
      {message && <div className="mt-4 rounded-md bg-green-50 p-3 text-green-800 dark:bg-green-900/40 dark:text-green-200">{message}</div>}

      {!isNew && role && (
        <section className={`mt-6 ${card} p-4 sm:p-6`}>
          <h2 className="text-base font-semibold text-[var(--foreground)]">settings history</h2>
          <p className={`mt-1 ${muted}`}>
            Every shift is paid with the settings in effect on its date. Past settings never change; new settings start on a date you pick.
            {role.lockedBefore && <> Payroll is locked before {formatDay(role.lockedBefore)}.</>}
          </p>
          <ol className="mt-4 space-y-3">
            {versionsNewestFirst.map((v, i) => {
              const isCurrent = role.current?.id === v.id
              const isFuture = v.effectiveFrom > role.today
              return (
                <li key={v.id} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--foreground)]">{formatSpan(v.effectiveFrom, v.effectiveTo)}</span>
                    {isCurrent && <span className="rounded bg-indigo-100 px-1.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">in effect today</span>}
                    {isFuture && <span className="rounded bg-amber-100 px-1.5 text-xs font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">upcoming</span>}
                  </div>
                  {v.changes.length > 0 && <p className="mt-1 text-[var(--foreground)]">{v.changes.join('; ')}</p>}
                  <p className={`mt-1 text-xs ${muted}`}>{v.summary}</p>
                  {(v.note || v.createdBy) && (
                    <p className={`mt-1 text-xs ${muted}`}>{v.note}{v.note && v.createdBy ? ' · ' : ''}{v.createdBy ? `saved by ${v.createdBy}` : ''}</p>
                  )}
                  {i === 0 && role.versions.length > 1 && v.createdBy !== 'backfill' && (
                    <button type="button" onClick={undoLatest} disabled={saving || (!!role.lockedBefore && v.effectiveFrom < role.lockedBefore)} className={`mt-2 ${secondary}`}>
                      undo this change
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <section className={`mt-6 ${card} p-4 sm:p-6`}>
        <h2 className="text-base font-semibold text-[var(--foreground)]">{isNew ? 'settings' : 'change settings'}</h2>
        {isNew && (
          <label className="mt-4 block">
            <span className="font-medium text-[var(--foreground)]">role name</span>
            <input className={`mt-1 w-full sm:w-80 ${input}`} value={name} onChange={e => setName(e.target.value)} required />
          </label>
        )}
        <label className="mt-4 block">
          <span className="font-medium text-[var(--foreground)]">{isNew ? 'first day these settings apply' : 'new settings start on'}</span>
          <input type="date" className={`mt-1 ${input}`} value={effectiveFrom} min={role?.earliestChange ?? undefined} onChange={e => setEffectiveFrom(e.target.value)} />
          {!isNew && latest && (
            <span className={`mt-1 block text-xs ${muted}`}>
              {correcting
                ? `This corrects the change that starts ${formatDay(latest.effectiveFrom)}.`
                : `Shifts before ${effectiveFrom ? formatDay(effectiveFrom) : 'that date'} keep the settings they have now.`}
            </span>
          )}
        </label>

        <label className="mt-4 block">
          <span className="font-medium text-[var(--foreground)]">base pay ($/hour)</span>
          <input type="number" min="0" step="0.01" className={`mt-1 w-32 ${input}`} value={settings.basePayRate}
            onChange={e => setSettings(s => ({ ...s, basePayRate: e.target.value === '' ? 0 : Number(e.target.value) }))} />
        </label>

        <fieldset className="mt-6">
          <legend className="font-medium text-[var(--foreground)]">tipouts this role pays</legend>
          <div className="mt-2 space-y-2">
            {TIPOUT_TYPES.map(type => {
              const t = tipout(type, 'pays')
              const blocked = !!tipout(type, 'receives')
              return (
                <div key={type} className="flex flex-wrap items-center gap-3">
                  <label className="flex w-56 items-center gap-2">
                    <input type="checkbox" checked={!!t} disabled={blocked}
                      onChange={e => setTipout(type, e.target.checked ? { paysTipout: true, receivesTipout: false, distributionGroup: null } : null)} />
                    {TYPE_LABEL[type]} tipout
                  </label>
                  {t && (
                    <span className="flex items-center gap-2">
                      <input type="number" min="0" max="100" step="0.1" className={`w-20 ${input}`} value={t.percentageRate}
                        onChange={e => setTipout(type, { percentageRate: e.target.value === '' ? 0 : Number(e.target.value) })} />
                      <span className={muted}>% {BASE[type]}</span>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="mt-6">
          <legend className="font-medium text-[var(--foreground)]">tipouts this role receives</legend>
          <p className={`text-xs ${muted}`}>Everyone in the same group on a night splits that tipout by hours.</p>
          <div className="mt-2 space-y-2">
            {TIPOUT_TYPES.map(type => {
              const t = tipout(type, 'receives')
              const blocked = !!tipout(type, 'pays')
              return (
                <div key={type} className="flex flex-wrap items-center gap-3">
                  <label className="flex w-56 items-center gap-2">
                    <input type="checkbox" checked={!!t} disabled={blocked}
                      onChange={e => setTipout(type, e.target.checked ? { receivesTipout: true, paysTipout: false, percentageRate: 0, distributionGroup: DEFAULT_GROUP[type] } : null)} />
                    {TYPE_LABEL[type]} tipout
                  </label>
                  {t && (
                    <span className="flex items-center gap-2">
                      <span className={muted}>shared with</span>
                      <input list="distribution-groups" className={`w-36 ${input}`} value={t.distributionGroup ?? ''}
                        onChange={e => setTipout(type, { distributionGroup: e.target.value })} />
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <datalist id="distribution-groups">
            {[...new Set([...suggestions.distributionGroups, 'bartenders', 'hosts', 'support'])].map(g => <option key={g} value={g} />)}
          </datalist>
        </fieldset>

        <fieldset className="mt-6">
          <legend className="font-medium text-[var(--foreground)]">tip pool</legend>
          <p className={`text-xs ${muted}`}>
            Roles in the same pool on the same night put their tips together, pay host and SA tipouts from the total, and split the rest by hours.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" name="pool" checked={!settings.tipPoolGroup} onChange={() => setSettings(s => ({ ...s, tipPoolGroup: null }))} />
              no pool: everyone keeps their own tips
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="pool" checked={!!settings.tipPoolGroup}
                onChange={() => setSettings(s => ({ ...s, tipPoolGroup: s.tipPoolGroup || suggestions.pools[0] || name || role?.name || 'pool' }))} />
              pool with
            </label>
            {settings.tipPoolGroup !== null && (
              <input list="pool-names" className={`w-36 ${input}`} value={settings.tipPoolGroup}
                onChange={e => setSettings(s => ({ ...s, tipPoolGroup: e.target.value }))} />
            )}
            <datalist id="pool-names">{suggestions.pools.map(p => <option key={p} value={p} />)}</datalist>
          </div>
        </fieldset>

        <label className="mt-6 block">
          <span className="font-medium text-[var(--foreground)]">note <span className={`font-normal ${muted}`}>(optional, shown in the history)</span></span>
          <input className={`mt-1 w-full ${input}`} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. restaurant ended server pooling" />
        </label>

        {!isNew && plan && !plan.ok && plan.error === 'Nothing changed.' && (
          <p className={`mt-6 ${muted}`}>Change something above to see what will change.</p>
        )}
        {!isNew && plan && !plan.ok && plan.error !== 'Nothing changed.' && (
          <div className="mt-6 rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{plan.error}</div>
        )}
        {!isNew && plan?.ok && (
          <div className="mt-6 rounded-md bg-indigo-50 p-3 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100">
            <p className="font-medium">From {formatDay(effectiveFrom)}:</p>
            <ul className="mt-1 list-disc pl-5">{plan.changes.map(c => <li key={c}>{c}</li>)}</ul>
          </div>
        )}
        {!isNew && plan?.ok && !!plan.affects?.shifts && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
            <p>
              This recalculates {affectedText(plan.affects)}, and changes what everyone who worked those nights is owed. If payroll has already been paid for those dates, lock that
              pay period first, or pick a later start date.
            </p>
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
              Recalculate those {plan.affects.shifts} shifts
            </label>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className={button} onClick={saveSettings} disabled={saving || (!isNew && (!plan?.ok || (!!plan.affects?.shifts && !confirmed))) || (isNew && !name.trim())}>
            {isNew ? 'create role' : correcting ? 'save correction' : `save new settings from ${effectiveFrom ? formatDay(effectiveFrom) : '…'}`}
          </button>
          <Link href="/roles" className={secondary}>cancel</Link>
        </div>
      </section>

      {!isNew && role && (
        <section className={`mt-6 ${card} p-4 sm:p-6`}>
          <h2 className="text-base font-semibold text-[var(--foreground)]">role</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className={muted}>name (renaming changes it everywhere, including past reports)</span>
              <input className={`mt-1 w-64 ${input}`} value={name} onChange={e => setName(e.target.value)} />
            </label>
            <button type="button" className={secondary} disabled={saving || !name.trim() || name.trim() === role.name} onClick={() => updateRole({ name })}>rename</button>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {role.active
              ? <button type="button" className={secondary} disabled={saving} onClick={() => updateRole({ active: false })}>archive role</button>
              : <button type="button" className={secondary} disabled={saving} onClick={() => updateRole({ active: true })}>restore role</button>}
            {role.shiftCount === 0 && <button type="button" className={secondary} disabled={saving} onClick={deleteRole}>delete role</button>}
          </div>
          <p className={`mt-2 text-xs ${muted}`}>
            {role.shiftCount > 0
              ? `Used on ${role.shiftCount} shifts, so it can be archived but not deleted. Archived roles keep their history.`
              : 'Never used on a shift, so it can be deleted.'}
          </p>
        </section>
      )}
    </div>
  )
}
