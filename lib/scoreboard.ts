import 'server-only'
import { supabase, supabaseConfigured } from './supabase'
import { getRecords, type Rec } from './records'

// The Scoreboard: Leads → Attendees → Appointments → Show-ups → Sales → Cash,
// from the Google Sheets import (records) + the GoHighLevel mirror (ghl_*).
//
// Definitions (agreed with the owner):
//   • Lead        = a registrant row in a lead Sheet tab (dated by registration)
//   • Attendee    = a lead marked ATTENDED (dated by webinar date if known)
//   • Appointment = a row in a booking tab + GHL appointments (not cancelled)
//   • Show-up     = Sheet status filled in and not no-show/cancel, + GHL "showed"
//   • Sale        = one Coaching Clients log row, + an Onboarding client with no
//                   log sale within 60 days (so the same deal isn't counted twice),
//                   + GHL opportunities that moved into a sale stage
//   • Cash        = paid Cash In rows + succeeded GHL payments (minus refunds)
// Campaign = the lead tab the person FIRST registered from (matched by hashed
// email, then hashed phone, then name). Closer = the Sheet's closer / calendar
// owner, or the GHL rep.

export type Ev = {
  kind: 'lead' | 'attendee' | 'appointment' | 'show' | 'sale' | 'cash'
  date: string | null // YYYY-MM-DD
  amount: number
  campaign: string
  closer: string
  webinar: string | null
}
export type Totals = { leads: number; attendees: number; appointments: number; shows: number; sales: number; cash: number }

const UNKNOWN = 'Unattributed'

// The closer column is free text ("Ozan 15%", "Ozan Turay", "closed by Kingsley.
// onboarded by Ozan", "Fay (Alaric follow up)") — reduce it to the first person's
// first name so one closer is one row.
export function closerName(raw: string): string {
  const s = String(raw || '')
    .replace(/^(mr\.?|ms\.?|coach)\s+/i, '')
    .replace(/^closed (by|through)( whatsapp with)?\s+/i, '')
    .replace(/\(.*?\)|\d+\s*%|\d+/g, ' ')
    .trim()
  const first = s.split(/[\s,/+&.]+|\band\b|\bthen\b|\bor\b/i).find(w => /^[a-z]{2,}$/i.test(w))
  if (!first || /^(nil|na|none|recordings|dad)$/i.test(first)) return '—'
  // "auto2dhtc", "5la2dhtc", "Funnel Duo", "webinar" = sold by a funnel, not a person.
  if (/^(auto|automated|funnel|dhtc|a?dhtc|la|p|webinar|seminar)$/i.test(first)) return 'Funnel (no closer)'
  return first[0].toUpperCase() + first.slice(1).toLowerCase()
}
const normName = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
const day = (v?: string | null) => (v ? String(v).slice(0, 10) : null)

export async function getScoreEvents(): Promise<{ events: Ev[]; adSpend: { date: string | null; amount: number }[] }> {
  const rows = await getRecords(['lead', 'cash_in', 'customer', 'cash_out'])
  const leads = rows.filter(r => r.category === 'lead' && !r.meta?.appointment)
  const appts = rows.filter(r => r.category === 'lead' && r.meta?.appointment)

  // First registration per person → their campaign + webinar.
  const first = new Map<string, Rec>()
  const remember = (k: string | undefined, r: Rec) => {
    if (!k) return
    const prev = first.get(k)
    if (!prev || (r.due_date || '9999') < (prev.due_date || '9999')) first.set(k, r)
  }
  for (const r of leads) {
    remember(r.meta?.em && `em:${r.meta.em}`, r)
    remember(r.meta?.ph && `ph:${r.meta.ph}`, r)
    const n = normName(r.meta?.customer || r.title)
    if (n.length >= 6) remember(`n:${n}`, r) // short names ("Tan") match too many people
  }
  const origin = (m: Record<string, any> = {}, name = ''): Rec | undefined =>
    (m.em && first.get(`em:${m.em}`)) || (m.ph && first.get(`ph:${m.ph}`)) ||
    (normName(name).length >= 6 ? first.get(`n:${normName(name)}`) : undefined)
  const camp = (o?: Rec) => (o ? String(o.meta?.campaign || o.meta?.tab || UNKNOWN) : UNKNOWN)
  const web = (o?: Rec) => (o ? o.meta?.webinar_date || null : null)

  const events: Ev[] = []
  const push = (e: Omit<Ev, 'amount'> & { amount?: number }) => events.push({ amount: 0, ...e })

  for (const r of leads) {
    const c = String(r.meta?.campaign || r.meta?.tab || UNKNOWN)
    push({ kind: 'lead', date: r.due_date, campaign: c, closer: '', webinar: r.meta?.webinar_date || null })
    if (r.meta?.attended)
      push({ kind: 'attendee', date: r.meta?.webinar_date || r.due_date, campaign: c, closer: '', webinar: r.meta?.webinar_date || null })
  }

  for (const r of appts) {
    const o = origin(r.meta, r.meta?.customer || r.title)
    const base = { date: r.due_date, campaign: camp(o) === UNKNOWN ? String(r.meta?.campaign || UNKNOWN) : camp(o), closer: closerName(r.meta?.closer), webinar: web(o) }
    // A no-show/cancelled booking still counts as an appointment, just not a show-up.
    push({ kind: 'appointment', ...base })
    if (r.meta?.showed) push({ kind: 'show', ...base })
  }

  // Sales from the Coaching log (one per row), remembered for the Onboarding dedupe.
  const saleDates = new Map<string, string[]>()
  const keysOf = (m: Record<string, any> = {}, name = '') =>
    [m.em && `em:${m.em}`, m.ph && `ph:${m.ph}`, normName(name).length >= 4 && `n:${normName(name)}`].filter(Boolean) as string[]
  for (const r of rows.filter(r => r.category === 'cash_in' && r.meta?.sale)) {
    const o = origin(r.meta, r.meta?.customer)
    push({ kind: 'sale', date: r.due_date, amount: Number(r.amount || 0), campaign: camp(o), closer: closerName(r.meta?.closer), webinar: web(o) })
    for (const k of keysOf(r.meta, r.meta?.customer)) saleDates.set(k, [...(saleDates.get(k) ?? []), r.due_date || ''])
  }
  const near = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= 60 * 86400_000
  for (const r of rows.filter(r => r.category === 'customer' && r.meta?.onboarded !== undefined)) {
    const d = r.meta?.onboarded || null
    const dup = keysOf(r.meta, r.title).some(k => (saleDates.get(k) ?? []).some(s => s && d && near(s, d)))
    if (dup) continue
    const o = origin(r.meta, r.title)
    push({ kind: 'sale', date: d, campaign: camp(o), closer: closerName(r.meta?.introduced_by), webinar: web(o) })
  }

  // Cash = money that actually landed.
  for (const r of rows.filter(r => r.category === 'cash_in' && (r.status || '').toLowerCase() === 'paid')) {
    const o = origin(r.meta, r.meta?.customer)
    push({ kind: 'cash', date: r.due_date, amount: Number(r.amount || 0), campaign: camp(o), closer: closerName(r.meta?.closer), webinar: web(o) })
  }

  const adSpend = rows
    .filter(r => r.category === 'cash_out' && /ads?/i.test(String(r.meta?.category || '')))
    .map(r => ({ date: r.due_date, amount: Number(r.amount || 0) }))

  // ---- GoHighLevel (empty until GHL_API_KEY is set) ----
  if (supabaseConfigured) {
    const [ap, op, pay] = await Promise.all([
      supabase.from('ghl_appointments').select('status, rep_name, start_time').limit(5000),
      supabase.from('ghl_opportunities').select('stage_bucket, rep_name, stage_changed_at, monetary_value, email, contact_name').eq('stage_bucket', 'sale').limit(5000),
      supabase.from('ghl_payments').select('amount_sgd, refunded_sgd, status, created_at, contact_name').eq('status', 'succeeded').limit(5000),
    ])
    for (const a of ap.data ?? []) {
      if (/cancel|invalid/i.test(a.status || '')) continue
      const base = { date: day(a.start_time), campaign: 'GoHighLevel', closer: closerName(a.rep_name), webinar: null }
      push({ kind: 'appointment', ...base })
      if ((a.status || '').toLowerCase() === 'showed') push({ kind: 'show', ...base })
    }
    for (const o of op.data ?? []) {
      const lead = origin({}, o.contact_name || '')
      push({ kind: 'sale', date: day(o.stage_changed_at), amount: Number(o.monetary_value || 0), campaign: lead ? camp(lead) : 'GoHighLevel', closer: closerName(o.rep_name), webinar: web(lead) })
    }
    for (const p of pay.data ?? []) {
      const lead = origin({}, p.contact_name || '')
      push({ kind: 'cash', date: day(p.created_at), amount: Number(p.amount_sgd || 0) - Number(p.refunded_sgd || 0), campaign: lead ? camp(lead) : 'GoHighLevel', closer: '—', webinar: web(lead) })
    }
  }

  return { events, adSpend }
}

export function totals(evs: Ev[]): Totals {
  const t: Totals = { leads: 0, attendees: 0, appointments: 0, shows: 0, sales: 0, cash: 0 }
  for (const e of evs) {
    if (e.kind === 'lead') t.leads++
    else if (e.kind === 'attendee') t.attendees++
    else if (e.kind === 'appointment') t.appointments++
    else if (e.kind === 'show') t.shows++
    else if (e.kind === 'sale') t.sales++
    else if (e.kind === 'cash') t.cash += e.amount
  }
  t.cash = Math.round(t.cash)
  return t
}

// Group events into rows (by campaign, closer, webinar or week), biggest first.
export function groupBy(evs: Ev[], key: (e: Ev) => string | null, sort: 'size' | 'key-desc' = 'size') {
  const m = new Map<string, Ev[]>()
  for (const e of evs) {
    const k = key(e)
    if (k === null) continue
    m.set(k, [...(m.get(k) ?? []), e])
  }
  const out = [...m.entries()].map(([k, list]) => ({ key: k, t: totals(list) }))
  return sort === 'size'
    ? out.sort((a, b) => b.t.cash - a.t.cash || b.t.leads - a.t.leads || b.t.appointments - a.t.appointments)
    : out.sort((a, b) => b.key.localeCompare(a.key))
}

// Monday of the event's week, as YYYY-MM-DD.
export function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
