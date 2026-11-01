import 'server-only'
import { supabase, supabaseConfigured } from './supabase'

// The GoHighLevel bridge. Reads (never writes) your GHL sub-account through a
// Private Integration token and mirrors it into the ghl_* tables (supabase/ghl.sql).
//   GHL_API_KEY      — Settings → Private Integrations → your token (a SECRET)
//   GHL_LOCATION_ID  — your sub-account id (not secret)
// Everything is converted to SGD on the way in; the original amount is kept.

const BASE = 'https://services.leadconnectorhq.com'
const VERSION = '2021-07-28'
const HOME_CURRENCY = 'SGD'

export const ghlKey = () => process.env.GHL_API_KEY?.trim() || ''
export const ghlLocation = () => process.env.GHL_LOCATION_ID?.trim() || ''
export const ghlConfigured = () => Boolean(ghlKey() && ghlLocation())

async function ghl(path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  // GHL rate-limits bursts; one gentle retry on 429/5xx keeps a sync from dying.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ghlKey()}`, Version: VERSION, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) return res.json()
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise(r => setTimeout(r, 1500))
      continue
    }
    throw new Error(`GHL ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

// ---------- Stage → funnel bucket ----------
// Your pipelines mark a sale by STAGE NAME ("Bought", "Closed", "Demonstration Won"),
// not GHL's Won status, so we read the name. Order matters: no-show before
// appointment, lost before closed ("Closed Lost"), etc. 👉 Tweak the words here.
export function stageBucket(stage: string, status?: string): string {
  const s = (stage || '').toLowerCase()
  if (status === 'won') return 'sale'
  if (/no.?show/.test(s)) return 'no_show'
  if (/cancel/.test(s)) return 'cancelled'
  if (/closed lost|\blost\b|didn.?t buy|not won|bad fit|abandon/.test(s)) return 'lost'
  if (/nurture|follow.?up|hot list|reset/.test(s)) return 'nurture'
  if (/^bought$|closed|won|convert|enrol/.test(s)) return 'sale'
  if (/buyer|bought|bump|upsell|down.?sell/.test(s)) return 'purchase'
  if (/post call|demonstration completed|attended$/.test(s)) return 'showed'
  if (/appointment|booked|\bcall\b|call \d|demonstration scheduled/.test(s)) return 'appointment'
  if (status === 'lost' || status === 'abandoned') return 'lost'
  return 'lead'
}

// ---------- Currency → SGD ----------
let fxCache: { at: number; rates: Record<string, number> } | null = null
async function fxRates(): Promise<Record<string, number>> {
  if (fxCache && Date.now() - fxCache.at < 6 * 3600_000) return fxCache.rates
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${HOME_CURRENCY}`, { signal: AbortSignal.timeout(8000) })
    const j = await r.json()
    if (j?.rates) fxCache = { at: Date.now(), rates: j.rates }
  } catch (e) {
    console.warn('[CFO] FX rates unavailable, non-SGD payments keep their raw amount:', e)
  }
  return fxCache?.rates ?? { [HOME_CURRENCY]: 1 }
}
const toSgd = (amount: number, currency: string, rates: Record<string, number>) => {
  const cur = (currency || HOME_CURRENCY).toUpperCase()
  const rate = cur === HOME_CURRENCY ? 1 : rates[cur]
  return { rate: rate ?? null, sgd: rate ? Math.round((amount / rate) * 100) / 100 : amount }
}

// ---------- State (cursors) ----------
async function getState(key: string): Promise<any> {
  const { data } = await supabase.from('ghl_sync_state').select('value').eq('key', key).maybeSingle()
  return data?.value ?? {}
}
async function setState(key: string, value: any) {
  await supabase.from('ghl_sync_state').upsert({ key, value, updated_at: new Date().toISOString() })
}

async function upsert(table: string, rows: any[]) {
  if (!rows.length) return
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' })
  if (error) throw new Error(`save ${table}: ${error.message}`)
}

// ---------- Lookups ----------
async function lookups() {
  const loc = ghlLocation()
  const [pipes, users, cals] = await Promise.all([
    ghl('/opportunities/pipelines', { locationId: loc }),
    ghl('/users/', { locationId: loc }).catch(() => ({ users: [] })),
    ghl('/calendars/', { locationId: loc }).catch(() => ({ calendars: [] })),
  ])
  const pipelines = new Map<string, { name: string; stages: Map<string, string> }>()
  for (const p of pipes.pipelines ?? []) {
    pipelines.set(p.id, { name: p.name, stages: new Map((p.stages ?? []).map((s: any) => [s.id, s.name])) })
  }
  const userName = new Map<string, string>()
  for (const u of users.users ?? []) userName.set(u.id, u.name || [u.firstName, u.lastName].filter(Boolean).join(' '))
  const calendars: { id: string; name: string }[] = (cals.calendars ?? []).map((c: any) => ({ id: c.id, name: c.name }))
  return { pipelines, userName, calendars }
}

type Lookups = Awaited<ReturnType<typeof lookups>>

function mapOpp(o: any, L: Lookups) {
  const pipe = L.pipelines.get(o.pipelineId)
  const stage = pipe?.stages.get(o.pipelineStageId) ?? ''
  return {
    id: o.id,
    name: o.name,
    contact_id: o.contactId ?? o.contact?.id ?? null,
    contact_name: o.contact?.name ?? null,
    email: o.contact?.email ?? null,
    phone: o.contact?.phone ?? null,
    pipeline_id: o.pipelineId,
    pipeline_name: pipe?.name ?? null,
    stage_id: o.pipelineStageId,
    stage_name: stage,
    stage_bucket: stageBucket(stage, o.status),
    status: o.status,
    monetary_value: Number(o.monetaryValue || 0),
    assigned_to: o.assignedTo ?? null,
    rep_name: o.assignedTo ? L.userName.get(o.assignedTo) ?? null : null,
    source: o.source ?? null,
    tags: o.contact?.tags ?? [],
    created_at: o.createdAt ?? null,
    updated_at: o.updatedAt ?? null,
    stage_changed_at: o.lastStageChangeAt ?? o.updatedAt ?? o.createdAt ?? null,
    synced_at: new Date().toISOString(),
  }
}

// ---------- The sync ----------
// Runs inside a 60s serverless function, so it works to a time budget:
//   • newest opportunities first (always refreshes the latest ~500),
//   • then continues the one-time BACKFILL of older pages from a saved cursor,
//   • appointments: last 120 days → next 30 days, per calendar,
//   • payments: last 120 days (newest first),
//   • onboarding: submissions of every form whose name contains "onboard"
//     (or GHL_ONBOARDING_FORM_ID if you set it).
// Call it again ("Sync now") to keep backfilling until `backfillDone` is true.
export async function syncGhl(budgetMs = 45_000): Promise<Record<string, any>> {
  if (!ghlConfigured()) return { ok: false, reason: 'GHL_API_KEY / GHL_LOCATION_ID not set' }
  if (!supabaseConfigured) return { ok: false, reason: 'Supabase not configured' }
  const t0 = Date.now()
  const timeLeft = () => budgetMs - (Date.now() - t0)
  const loc = ghlLocation()
  const out: Record<string, any> = { ok: true, opportunities: 0, appointments: 0, payments: 0, onboarding: 0 }
  const errors: string[] = []

  const L = await lookups()
  await setState('pipelines', [...L.pipelines].map(([id, p]) => ({ id, name: p.name })))

  // 1) Opportunities — newest 5 pages every run.
  try {
    let after: { startAfter?: string; startAfterId?: string } = {}
    for (let page = 0; page < 5 && timeLeft() > budgetMs * 0.6; page++) {
      const j = await ghl('/opportunities/search', { location_id: loc, status: 'all', limit: 100, ...after })
      const opps = j.opportunities ?? []
      await upsert('ghl_opportunities', opps.map((o: any) => mapOpp(o, L)))
      out.opportunities += opps.length
      if (!j.meta?.startAfterId || opps.length < 100) break
      after = { startAfter: String(j.meta.startAfter), startAfterId: j.meta.startAfterId }
    }
  } catch (e: any) { errors.push(e.message) }

  // 2) Appointments, per calendar.
  try {
    const start = Date.now() - 120 * 86400_000
    const end = Date.now() + 30 * 86400_000
    for (const cal of L.calendars) {
      if (timeLeft() < budgetMs * 0.45) break
      const j = await ghl('/calendars/events', { locationId: loc, calendarId: cal.id, startTime: start, endTime: end })
      const rows = (j.events ?? []).map((ev: any) => ({
        id: ev.id,
        calendar_id: cal.id,
        calendar_name: cal.name,
        contact_id: ev.contactId ?? null,
        title: ev.title ?? null,
        status: (ev.appointmentStatus || ev.status || '').toLowerCase() || null,
        assigned_user_id: ev.assignedUserId ?? null,
        rep_name: ev.assignedUserId ? L.userName.get(ev.assignedUserId) ?? null : null,
        start_time: ev.startTime ? new Date(ev.startTime).toISOString() : null,
        created_at: ev.dateAdded ?? null,
        synced_at: new Date().toISOString(),
      }))
      await upsert('ghl_appointments', rows)
      out.appointments += rows.length
    }
  } catch (e: any) { errors.push(e.message) }

  // 3) Payments (cash collected), converted to SGD.
  try {
    const rates = await fxRates()
    const startAt = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10)
    for (let offset = 0; timeLeft() > budgetMs * 0.3; offset += 100) {
      const j = await ghl('/payments/transactions', { altId: loc, altType: 'location', startAt, limit: 100, offset })
      const tx = j.data ?? []
      const rows = tx.map((t: any) => {
        const amount = Number(t.amount || 0)
        const { rate, sgd } = toSgd(amount, t.currency, rates)
        const refunded = Number(t.amountRefunded || 0)
        return {
          id: t._id,
          contact_id: t.contactId ?? null,
          contact_name: t.contactName ?? null,
          email: t.contactEmail ?? null,
          amount,
          currency: (t.currency || HOME_CURRENCY).toUpperCase(),
          fx_rate: rate,
          amount_sgd: sgd,
          refunded_sgd: refunded ? toSgd(refunded, t.currency, rates).sgd : 0,
          status: t.status ?? null,
          source_name: t.entitySourceName ?? null,
          created_at: t.createdAt ?? null,
          synced_at: new Date().toISOString(),
        }
      })
      await upsert('ghl_payments', rows)
      out.payments += rows.length
      if (tx.length < 100) break
    }
  } catch (e: any) { errors.push(e.message) }

  // 4) Onboarding form submissions — every answer, as-is.
  try {
    const forms = await ghl('/forms/', { locationId: loc, limit: 100 })
    const wanted = process.env.GHL_ONBOARDING_FORM_ID?.trim()
    const targets = (forms.forms ?? []).filter((f: any) =>
      wanted ? f.id === wanted : /onboard/i.test(f.name || ''),
    )
    out.onboardingForms = targets.map((f: any) => f.name)
    for (const f of targets) {
      for (let page = 1; page <= 5 && timeLeft() > budgetMs * 0.15; page++) {
        const j = await ghl('/forms/submissions', { locationId: loc, formId: f.id, limit: 100, page })
        const subs = j.submissions ?? []
        const rows = subs.map((s: any) => {
          const { eventData, ...answers } = s.others ?? {}
          return {
            id: s.id,
            contact_id: s.contactId ?? null,
            name: s.name ?? null,
            email: s.email ?? null,
            phone: answers.phone ?? null,
            form_id: f.id,
            form_name: f.name,
            answers,
            submitted_at: s.createdAt ?? null,
            synced_at: new Date().toISOString(),
          }
        })
        await upsert('ghl_onboarding', rows)
        out.onboarding += rows.length
        if (subs.length < 100) break
      }
    }
  } catch (e: any) { errors.push(e.message) }

  // 5) One-time backfill of older opportunities, from the saved cursor.
  try {
    const bf = await getState('opp_backfill')
    if (!bf.done) {
      let after: any = bf.cursor ?? {}
      let pages = 0
      while (timeLeft() > 5_000) {
        const j = await ghl('/opportunities/search', { location_id: loc, status: 'all', limit: 100, ...after })
        const opps = j.opportunities ?? []
        await upsert('ghl_opportunities', opps.map((o: any) => mapOpp(o, L)))
        out.opportunities += opps.length
        pages++
        if (!j.meta?.startAfterId || opps.length < 100) {
          await setState('opp_backfill', { done: true, pages: (bf.pages ?? 0) + pages })
          after = null
          break
        }
        after = { startAfter: String(j.meta.startAfter), startAfterId: j.meta.startAfterId }
      }
      if (after) await setState('opp_backfill', { done: false, cursor: after, pages: (bf.pages ?? 0) + pages })
    }
    out.backfillDone = (await getState('opp_backfill')).done === true
  } catch (e: any) { errors.push(e.message) }

  out.ms = Date.now() - t0
  if (errors.length) { out.ok = false; out.errors = errors }
  await setState('last_sync', { at: new Date().toISOString(), ...out })
  return out
}

export async function lastSync(): Promise<any> {
  if (!supabaseConfigured) return null
  const { data } = await supabase.from('ghl_sync_state').select('value').eq('key', 'last_sync').maybeSingle()
  return data?.value ?? null
}
