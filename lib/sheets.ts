import 'server-only'
import { createHash, createSign } from 'node:crypto'
import { supabase, supabaseConfigured } from './supabase'

// Google Sheets → records. Read-only pull through a Google service account (the
// "robot" email you share each Sheet with — nothing is ever published).
//
// Rules (agreed with the owner):
//   • Every Sheet row gets a stable `source_id`. We INSERT new ones only — a row
//     already in the app is never overwritten ("app wins").
//   • Everything is converted to SGD; the original text is kept in meta.
//   • Amounts we can't read cleanly are imported with meta.needs_review = true,
//     never guessed silently.
//   • No phone numbers or emails are copied in (names only).

// ---------- What to read ----------
type Kind = 'sales' | 'students' | 'deposits' | 'onboarding' | 'leads' | 'appointments' | 'adspend' | 'expenses' | 'tasks' | 'skip'
type Source = { key: string; sheetId: string; label: string; pick: (tab: string) => Kind }

const byName = (rules: [RegExp, Kind][], fallback: Kind) => (tab: string) =>
  rules.find(([re]) => re.test(tab))?.[1] ?? fallback

// Tabs that are copies, scratch pads, or analysis (not one-row-per-person data).
const NOT_DATA = /^copy of|^sheet\d*$|data analysis|data stats|attribution|template|summary|how to|instructions/i
const APPTS = /book(ed)?[ _-]?(appt|appointment|a call)|appointment booked|appt booked/i

export const SOURCES: Source[] = [
  {
    key: 'coaching', label: "Alaric's Coaching Clients",
    sheetId: '1LguX5cCWTmGd3gXsEdZ9ai2233_i5swgRWcllD_72Bc',
    pick: byName([[/^part 2$/i, 'sales'], [/^students$/i, 'students'], [/refundable deposit/i, 'deposits']], 'skip'),
  },
  {
    key: 'onboard', label: 'UCA New Client Onboarding',
    sheetId: '1FoAVxxIRXmq-WYnzGUq3qzqcS8v52bDLWSiJK-luKVs',
    pick: () => 'onboarding',
  },
  {
    key: 'wk', label: "Alaric's Webinarkit Leads",
    sheetId: '1Gndj84hVJTPPTiV6SMiApAUyiGSr8hts9KlKgBtICg8',
    pick: byName([[NOT_DATA, 'skip'], [/stats/i, 'adspend'], [APPTS, 'appointments']], 'leads'),
  },
  {
    key: '5lv', label: '5 Levels 2 Day High Ticket Sales Class',
    sheetId: '1gWeuuYmNuVc9dVlkEc4VcwnXYGqCQvlKCPIJX7X9Ts8',
    pick: byName([[NOT_DATA, 'skip'], [/stats/i, 'adspend'], [APPTS, 'appointments']], 'leads'),
  },
  // Partner/client lists: their leads count in the funnel, but their Stats (ad
  // spend) are the partner's money, not yours — skipped.
  {
    key: 'energia', label: 'Energia Giveaway leads',
    sheetId: '1_nqsN6ym88o3EVN8VDbCOXzf72cAuXMyb4OvVm8fdRU',
    pick: byName([[NOT_DATA, 'skip'], [/stats/i, 'skip'], [APPTS, 'appointments']], 'leads'),
  },
  {
    key: 'maxkoh', label: 'Max Koh time trading webinar leads',
    sheetId: '1sKPGgYvALFE4aSzz3rN-_9vjZKMSXKX_JS6Fg93jQts',
    pick: byName([[NOT_DATA, 'skip'], [/stats/i, 'skip'], [APPTS, 'appointments']], 'leads'),
  },
]

// The owner's own Expenses / Tasks Sheets (created for the team to fill in).
// Set the ids in env so they can be swapped without a code change.
function templateSources(): Source[] {
  const out: Source[] = []
  const exp = process.env.SHEETS_EXPENSES_ID?.trim()
  const tasks = process.env.SHEETS_TASKS_ID?.trim()
  if (exp) out.push({ key: 'exp', label: 'CashFlowOS Expenses', sheetId: exp, pick: () => 'expenses' })
  if (tasks) out.push({ key: 'tasks', label: 'CashFlowOS Tasks', sheetId: tasks, pick: () => 'tasks' })
  return out
}

// ---------- Google auth (service account JWT → access token) ----------
type ServiceAccount = { client_email: string; private_key: string }

export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  if (!raw) return null
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    const j = JSON.parse(text)
    return j.client_email && j.private_key ? j : null
  } catch {
    return null
  }
}
export const sheetsConfigured = () => !!serviceAccount()

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

let tokenCache: { token: string; exp: number } | null = null
async function googleToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token
  const sa = serviceAccount()
  if (!sa) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  const iat = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat, exp: iat + 3600,
  }))
  const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${claims}.${b64url(sig)}`,
    }),
  })
  if (!res.ok) throw new Error(`Google auth ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const j = await res.json()
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 }
  return j.access_token
}

async function gapi(path: string): Promise<any> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    headers: { Authorization: `Bearer ${await googleToken()}` },
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200)
    if (res.status === 403 || res.status === 404)
      throw new Error(`no access — share this Sheet with ${serviceAccount()?.client_email} (Viewer)`)
    throw new Error(`Sheets ${res.status}: ${body}`)
  }
  return res.json()
}

async function readSheet(sheetId: string): Promise<{ tab: string; rows: string[][] }[]> {
  const meta = await gapi(`${sheetId}?fields=sheets.properties.title`)
  const tabs: string[] = (meta.sheets ?? []).map((s: any) => s.properties.title)
  if (!tabs.length) return []
  const q = tabs.map(t => `ranges=${encodeURIComponent(`'${t.replace(/'/g, "''")}'`)}`).join('&')
  const j = await gapi(`${sheetId}/values:batchGet?${q}&valueRenderOption=FORMATTED_VALUE`)
  return (j.valueRanges ?? []).map((v: any, i: number) => ({ tab: tabs[i], rows: (v.values ?? []) as string[][] }))
}

// ---------- Parsing helpers ----------
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const yes = (v: string) => /^(y|yes|true|paid|done|✅|1)\b/i.test(clean(v))

// Find a header row in the first 10 rows: the one matching the most of `want`.
function findHeader(rows: string[][], want: RegExp[]): number {
  let best = -1, bestScore = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const score = want.filter(re => (rows[i] ?? []).some(h => re.test(clean(h)))).length
    if (score > bestScore) { best = i; bestScore = score }
  }
  return bestScore > 0 ? best : -1
}
const colOf = (head: string[], ...res: RegExp[]) => {
  for (const re of res) {
    const i = head.findIndex(h => re.test(clean(h)))
    if (i >= 0) return i
  }
  return -1
}
const cell = (row: string[], i: number) => (i >= 0 ? clean(row[i]) : '')

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const iso = (y: number, m: number, d: number) =>
  y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null

// Dates in these Sheets come as ISO, d/m/yyyy, "24 Nov 2022", "Nov 24, 2022" or
// "24 Nov" (no year). A missing year borrows the last year seen in the same tab.
function makeDateParser() {
  let lastYear = 0
  return (raw: string): { date: string | null; guessed: boolean } => {
    const s = clean(raw)
    if (!s) return { date: null, guessed: false }
    let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) return done(iso(+m[1], +m[2], +m[3]))
    m = s.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/)
    if (m) {
      let [a, b, y] = [+m[1], +m[2], +m[3]]
      if (y < 100) y += 2000
      // Day-first (SG/MY), unless that's impossible.
      return done(a > 12 ? iso(y, b, a) : b > 12 ? iso(y, a, b) : iso(y, b, a))
    }
    m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s*(\d{4})?/i)
    if (m && MONTHS[m[2].toLowerCase()]) return withYear(+m[3] || 0, MONTHS[m[2].toLowerCase()], +m[1])
    m = s.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i)
    if (m && MONTHS[m[1].toLowerCase()]) return withYear(+m[3] || 0, MONTHS[m[1].toLowerCase()], +m[2])
    return { date: null, guessed: false }

    function done(d: string | null) {
      if (d) lastYear = +d.slice(0, 4)
      return { date: d, guessed: false }
    }
    function withYear(y: number, mo: number, d: number) {
      // "Wed Nov 05 14:24:46 +00:00 2025" — the year sits at the end.
      if (!y) y = +(s.match(/\b(19|20)\d{2}\b(?!:)/)?.[0] ?? 0)
      if (y) return done(iso(y, mo, d))
      // Borrowing the year from the row above is a safe inference; only a tab
      // with no year anywhere yet counts as a real guess.
      if (lastYear) return { date: iso(lastYear, mo, d), guessed: false }
      return { date: iso(new Date().getFullYear(), mo, d), guessed: true }
    }
  }
}

// Money as typed by humans: "350", "RM 2800", "500 sgd", "150;150;150", "$5,000",
// "2.8k". Several numbers are summed (instalments logged in one cell) and flagged.
type Money = { amount: number; currency: string; review: boolean } | null
function parseMoney(raw: string, defaultCur = 'SGD'): Money {
  const s = clean(raw)
  if (!s) return null
  const cur = /\b(rm|myr)\b|^rm/i.test(s) ? 'MYR'
    : /\b(sgd|s\$)|sgd/i.test(s) || /s\$/i.test(s) ? 'SGD'
    : /\b(usd|us\$)/i.test(s) ? 'USD'
    : defaultCur
  // "5,000" is five thousand, but "150,150,150" is three payments of 150 — a
  // comma number that would be implausibly large is read as a list instead.
  const nums = [...s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/gi)]
    .flatMap(m => {
      const mult = m[2] ? 1000 : 1
      const joined = parseFloat(m[1].replace(/,/g, '')) * mult
      return /,/.test(m[1]) && joined > 100_000 ? m[1].split(',').map(g => parseFloat(g) * mult) : [joined]
    })
    .filter(n => Number.isFinite(n) && n > 0)
  if (!nums.length) return null
  const amount = nums.reduce((a, b) => a + b, 0)
  // A single coaching sale above 200k is a typo (often a phone number in the
  // amount cell) — keep the row but at 0 and flagged, never inflate the totals.
  if (amount > 200_000) return { amount: 0, currency: cur, review: true }
  // Several numbers ("150;150;150") are summed — fine; flag only when there are
  // words left we didn't understand.
  const leftover = s
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*k?/gi, '')
    .replace(/\b(rm|myr|sgd|usd|pending|till|until|balance|bal|left)\b|s\$|us\$|[$;+,)(\/&\s-]/gi, '')
  return { amount, currency: cur, review: leftover.length > 0 }
}

let fxCache: { at: number; rates: Record<string, number> } | null = null
async function fxRates(): Promise<Record<string, number>> {
  if (fxCache && Date.now() - fxCache.at < 6 * 3600_000) return fxCache.rates
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/SGD', { signal: AbortSignal.timeout(8000) })
    const j = await r.json()
    if (j?.rates) fxCache = { at: Date.now(), rates: j.rates }
  } catch (e) {
    console.warn('[CFO] FX rates unavailable, using fallback rates:', e)
  }
  // Fallback rates (units per 1 SGD) so a flaky FX API never blocks the import.
  return fxCache?.rates ?? { SGD: 1, MYR: 3.3, USD: 0.77 }
}

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)

// Match keys so a sale can be traced back to the lead tab the buyer first came
// from. Stored as one-way hashes (em = email, ph = last 8 phone digits) — the
// app never keeps the actual email or phone number.
const emKey = (v: string) => (/@/.test(v) ? sha(`em:${v.trim().toLowerCase()}`) : undefined)
const phKey = (v: string) => {
  const d = v.replace(/\D/g, '')
  return d.length >= 7 ? sha(`ph:${d.slice(-8)}`) : undefined
}
const PHONE_COL = [/whatsapp number/i, /^phone( number)?$/i, /mobile/i, /phone number/i]

// ---------- Row → records ----------
type NewRec = {
  source_id: string
  title: string
  status: string
  amount: number
  category: string
  due_date: string | null
  notes: string | null
  meta: Record<string, any>
}

type Ctx = { source: Source; tab: string; toSgd: (m: NonNullable<Money>) => number }

function mapTab(kind: Kind, rows: string[][], ctx: Ctx): NewRec[] {
  const out: NewRec[] = []
  const parseDate = makeDateParser()
  const sixMonthsAgo = new Date(Date.now() - 182 * 86400_000).toISOString().slice(0, 10)
  const sid = (...parts: string[]) => `${ctx.source.key}:${sha(`${ctx.tab}|${parts.join('|').toLowerCase()}`)}`
  const src = { origin: 'sheets', sheet: ctx.source.label, tab: ctx.tab }
  const money = (raw: string, cur?: string) => {
    const m = parseMoney(raw, cur)
    return m ? { sgd: Math.round(ctx.toSgd(m) * 100) / 100, ...m } : null
  }

  if (kind === 'sales' || kind === 'students') {
    const h = findHeader(rows, [/name/i, /cash collected|amount/i, /product|course/i, /date/i])
    if (h < 0) return out
    const head = rows[h]
    const c = {
      date: colOf(head, /date of preview/i, /^date/i, /date/i),
      product: colOf(head, /product/i, /course/i),
      affiliate: colOf(head, /affiliate/i),
      closer: colOf(head, /closer/i),
      name: colOf(head, /student name/i, /^name/i, /name/i),
      cash: colOf(head, /cash collected/i, /amount/i),
      pending: colOf(head, /pending/i),
      paid: colOf(head, /payment made/i),
      email: colOf(head, /e-?mail/i),
      phone: colOf(head, ...PHONE_COL),
    }
    for (const row of rows.slice(h + 1)) {
      const name = cell(row, c.name)
      if (!name) continue
      const d = parseDate(cell(row, c.date))
      const product = cell(row, c.product) || 'Sale'
      const base = {
        customer: name, product, affiliate: cell(row, c.affiliate) || undefined,
        closer: cell(row, c.closer) || undefined,
        em: emKey(cell(row, c.email)), ph: phKey(cell(row, c.phone)), ...src,
      }
      const cash = money(cell(row, c.cash))
      const isPaid = kind === 'sales' || c.paid < 0 || !/^(n|no|not|pending|unpaid)/i.test(cell(row, c.paid))
      // Unpaid items from more than 6 months ago are shown but not counted as owed.
      const unpaidStatus = d.date && d.date < sixMonthsAgo ? 'unconfirmed' : 'pending'
      if (cash) {
        out.push({
          source_id: sid('cash', name, cell(row, c.date), product, cell(row, c.cash)),
          title: `${product} — ${name}`, category: 'cash_in',
          status: isPaid ? 'paid' : unpaidStatus, amount: cash.sgd, due_date: d.date,
          notes: cash.currency !== 'SGD' || cash.review ? `Sheet: ${cell(row, c.cash)}` : null,
          // `sale: true` marks the row the Scoreboard counts as one sale.
          meta: { ...base, sale: true, original: cell(row, c.cash), currency: cash.currency, needs_review: cash.review || d.guessed || undefined },
        })
      }
      // "Pending Sales" holds notes like "pending till 500" (owed) but also "paid
      // 600 to aspire" / "yes" / "converted" (not owed) — only the first kind counts.
      const pendingText = cell(row, c.pending)
      const owedNote = /pend|owe|bal(ance)?\b|outstanding|left|remain|^\s*\$?\d[\d,.]*\s*(sgd|rm|usd)?\s*$/i.test(pendingText)
        && !/\b(paid|settled|refund|convert|cancel)/i.test(pendingText)
      if (pendingText && owedNote) {
        const p = money(pendingText)
        out.push({
          source_id: sid('pending', name, cell(row, c.date), product, pendingText),
          title: `Balance — ${product} — ${name}`, category: 'cash_in', status: unpaidStatus,
          amount: p?.sgd ?? 0, due_date: d.date, notes: `Pending sales: ${pendingText}`,
          meta: { ...base, original: pendingText, currency: p?.currency, needs_review: !p || p.review || undefined },
        })
      }
    }
  }

  if (kind === 'deposits') {
    const h = findHeader(rows, [/name/i, /amount/i, /status/i, /date/i])
    if (h < 0) return out
    const head = rows[h]
    const c = { date: colOf(head, /date/i), name: colOf(head, /name/i), amount: colOf(head, /amount/i), status: colOf(head, /status/i) }
    for (const row of rows.slice(h + 1)) {
      const name = cell(row, c.name)
      const amt = money(cell(row, c.amount))
      if (!name || !amt) continue
      const st = cell(row, c.status)
      if (/refund/i.test(st)) continue // money went back — not cash in
      const d = parseDate(cell(row, c.date))
      out.push({
        source_id: sid('deposit', name, cell(row, c.date), cell(row, c.amount)),
        title: `Deposit — ${name}`, category: 'cash_in', status: 'paid', amount: amt.sgd, due_date: d.date,
        notes: st ? `Deposit status: ${st}` : null,
        meta: { customer: name, original: cell(row, c.amount), currency: amt.currency, deposit_status: st || 'open', ...src, needs_review: amt.review || undefined },
      })
      if (!/bought|convert|paid/i.test(st)) {
        out.push({
          source_id: sid('deposit-open', name, cell(row, c.date)),
          title: name, category: 'customer', status: 'active', amount: 0, due_date: d.date,
          notes: `Holding a ${amt.currency} ${amt.amount} refundable deposit`,
          meta: { company: 'Refundable deposit', owes: 0, last_touch: d.date, next: 'Convert deposit to a sale or refund it', ...src },
        })
      }
    }
  }

  if (kind === 'onboarding') {
    const h = findHeader(rows, [/client name|name/i, /have you paid/i, /instal/i, /submission date/i])
    if (h < 0) return out
    const head = rows[h]
    const c = {
      date: colOf(head, /submission date/i, /date/i),
      name: colOf(head, /client name/i, /^name/i, /name/i),
      product: colOf(head, /access|product/i),
      intro: colOf(head, /introduced/i),
      paid: colOf(head, /have you paid/i, /paid/i),
      plan: colOf(head, /instal/i),
      notes: colOf(head, /^notes?/i),
      email: colOf(head, /e-?mail/i),
      phone: colOf(head, ...PHONE_COL),
    }
    const stale = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
    for (const row of rows.slice(h + 1)) {
      const name = cell(row, c.name)
      if (!name) continue
      const d = parseDate(cell(row, c.date))
      const paid = cell(row, c.paid)
      const plan = cell(row, c.plan)
      const product = cell(row, c.product)
      const owing = /instal|not paid|partial|deposit/i.test(paid)
      let owes = 0
      if (owing) {
        // Each line/segment of the plan that has BOTH a date and an amount is one
        // instalment. Older than 90 days → "unconfirmed" (not counted as owed).
        const segDate = makeDateParser()
        const segs = String(row[c.plan] ?? '').split(/\n|;|\|/).map(clean).filter(Boolean)
        let n = 0
        for (const seg of segs) {
          const sd = segDate(seg)
          const amt = money(seg.replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(st|nd|rd|th)?\s+[a-z]{3,9}\.?,?\s*\d{0,4}|\b[a-z]{3,9}\s+\d{1,2}(st|nd|rd|th)?,?\s*\d{0,4}/gi, ' '))
          if (!sd.date || !amt) continue
          n++
          const status = sd.date < stale ? 'unconfirmed' : 'pending'
          if (status === 'pending') owes += amt.sgd
          out.push({
            source_id: sid('instalment', name, cell(row, c.date), seg),
            title: `Instalment ${n} — ${product || 'Programme'} — ${name}`, category: 'cash_in', status,
            amount: amt.sgd, due_date: sd.date, notes: `Plan: ${seg}`,
            meta: { customer: name, product, original: seg, currency: amt.currency, ...src, needs_review: amt.review || sd.guessed || undefined },
          })
        }
        if (!n) {
          // No dated instalments to read. Plan text usually lists price OPTIONS
          // ("$5000 full / $6000 instalment"), so adding its numbers up would
          // invent a debt — record S$0 flagged "check" for a human to fill in.
          out.push({
            source_id: sid('owing', name, cell(row, c.date)),
            title: `Unpaid — ${product || 'Programme'} — ${name}`, category: 'cash_in',
            status: d.date && d.date < stale ? 'unconfirmed' : 'pending',
            amount: 0, due_date: d.date, notes: plan ? `Plan: ${plan.slice(0, 300)}` : `Payment: ${paid}`,
            meta: { customer: name, product, original: plan || paid, ...src, needs_review: true },
          })
        }
      }
      out.push({
        source_id: sid('client', name, cell(row, c.date)),
        title: name, category: 'customer', status: 'active', amount: owes, due_date: null,
        notes: cell(row, c.notes) || null,
        meta: {
          company: product || undefined, owes, payment: paid || undefined, introduced_by: cell(row, c.intro) || undefined,
          last_touch: d.date, next: owing ? 'Collect payment' : 'Deliver programme',
          em: emKey(cell(row, c.email)), ph: phKey(cell(row, c.phone)), onboarded: d.date, ...src,
        },
      })
    }
  }

  if (kind === 'leads') {
    const h = findHeader(rows, [/name/i, /regist|timestamp|created|date/i, /attend/i, /email/i])
    if (h < 0) return out
    const head = rows[h]
    const c = {
      name: colOf(head, /^(full )?name$/i, /full name/i, /^name\b/i, /your name/i),
      first: colOf(head, /first name/i),
      last: colOf(head, /last name/i),
      email: colOf(head, /e-?mail/i),
      date: colOf(head, /registration date|registered/i, /timestamp/i, /created/i, /date/i, /time/i),
      attended: colOf(head, /^attended/i, /attended/i),
      clicked: colOf(head, /clicked offer/i),
      appt: colOf(head, /appt set|appointment set|booked/i),
      paid: colOf(head, /^paid/i, /bought|purchased/i),
      phone: colOf(head, ...PHONE_COL),
      webinar: colOf(head, /webinar date/i, /session date/i, /webinar time/i),
    }
    const webinarDate = makeDateParser()
    for (const row of rows.slice(h + 1)) {
      const name = cell(row, c.name) || [cell(row, c.first), cell(row, c.last)].filter(Boolean).join(' ')
      if (!name) continue
      const d = parseDate(cell(row, c.date))
      const status = c.paid >= 0 && yes(cell(row, c.paid)) ? 'closed'
        : c.appt >= 0 && yes(cell(row, c.appt)) ? 'appointment'
        : c.attended >= 0 && yes(cell(row, c.attended)) ? 'contacted'
        : 'new'
      out.push({
        source_id: sid('lead', cell(row, c.email) || name, cell(row, c.date)),
        title: name, category: 'lead', status, amount: 0, due_date: d.date, notes: null,
        meta: {
          customer: name, source: ctx.tab, campaign: ctx.tab.trim(),
          webinar_date: c.webinar >= 0 ? webinarDate(cell(row, c.webinar)).date ?? undefined : undefined,
          attended: c.attended >= 0 ? yes(cell(row, c.attended)) : undefined,
          clicked_offer: c.clicked >= 0 ? yes(cell(row, c.clicked)) : undefined,
          em: emKey(cell(row, c.email)), ph: phKey(cell(row, c.phone)), ...src,
        },
      })
    }
  }

  if (kind === 'appointments') {
    const h = findHeader(rows, [/name/i, /start|appointment|time/i, /status|summary/i])
    if (h < 0) return out
    const head = rows[h]
    const c = {
      name: colOf(head, /^name$/i, /full name/i, /name/i),
      email: colOf(head, /e-?mail/i),
      date: colOf(head, /^start/i, /appointment time/i, /^time/i, /created/i, /date/i),
      status: colOf(head, /^status/i),
      source: colOf(head, /^source/i),
      phone: colOf(head, ...PHONE_COL),
      closer: colOf(head, /closer/i, /calendar owner|assigned|rep\b|host/i),
    }
    // "Booked Appointments on Ozan's Calendar" → every call there is Ozan's.
    const tabCloser = ctx.tab.match(/on (\w+)'s calendar/i)?.[1]
    for (const row of rows.slice(h + 1)) {
      const name = cell(row, c.name)
      if (!name) continue
      const d = parseDate(cell(row, c.date))
      const st = cell(row, c.status)
      const noShow = /no.?show|cancel|resched|invalid/i.test(st)
      const status = /won|closed|paid|bought|sold|enrol|signed/i.test(st) ? 'closed'
        : /no.?show|cancel|not interested|lost|unqualified/i.test(st) ? 'nurture'
        : 'appointment'
      out.push({
        source_id: sid('appt', cell(row, c.email) || name, cell(row, c.date)),
        title: name, category: 'lead', status, amount: 0, due_date: d.date, notes: st || null,
        meta: {
          customer: name, source: cell(row, c.source) || ctx.tab, next: st || 'Run the call',
          appointment: true, campaign: ctx.tab.trim(),
          // Show-up = the call has an outcome written down that isn't a no-show/cancel.
          showed: c.status >= 0 ? (!!st && !noShow) : undefined,
          closer: cell(row, c.closer) || tabCloser || undefined,
          em: emKey(cell(row, c.email)), ph: phKey(cell(row, c.phone)), ...src,
        },
      })
    }
  }

  if (kind === 'adspend') {
    const h = findHeader(rows, [/ad ?spend/i])
    if (h < 0) return out
    const head = rows[h]
    const c = {
      spend: colOf(head, /total ad ?spend/i, /ad ?spend/i),
      period: colOf(head, /period/i, /^date/i, /week|month/i, /change/i),
      currency: colOf(head, /currency/i),
    }
    for (const row of rows.slice(h + 1)) {
      const period = cell(row, c.period)
      if (!period || /total|average|avg/i.test(period)) continue
      const curText = cell(row, c.currency).toUpperCase()
      const cur = /MYR|RM/.test(curText) ? 'MYR' : /USD/.test(curText) ? 'USD' : /SGD|S\$/.test(curText) ? 'SGD' : 'SGD'
      const amt = money(cell(row, c.spend), cur)
      if (!amt) continue
      const d = parseDate(period)
      out.push({
        source_id: sid('ads', period, cell(row, c.spend)),
        title: `Ad spend — ${period}`, category: 'cash_out', status: 'paid', amount: amt.sgd, due_date: d.date,
        notes: `${ctx.source.label} · Stats`,
        meta: { category: 'Ads', merchant: 'Meta Ads', campaign: ctx.source.label, original: cell(row, c.spend), currency: amt.currency, ...src, needs_review: (!curText && !/rm|sgd|usd|\$/i.test(cell(row, c.spend))) || amt.review || undefined },
      })
    }
  }

  if (kind === 'expenses') {
    const h = findHeader(rows, [/item|what/i, /amount/i, /date/i])
    if (h < 0) return out
    const head = rows[h]
    const c = {
      date: colOf(head, /date/i), item: colOf(head, /item|what/i), amount: colOf(head, /amount/i),
      currency: colOf(head, /currency/i), category: colOf(head, /category/i), merchant: colOf(head, /merchant|supplier|paid to/i),
      paid: colOf(head, /paid/i), notes: colOf(head, /notes?/i),
    }
    for (const row of rows.slice(h + 1)) {
      const item = cell(row, c.item)
      const amt = money(cell(row, c.amount), cell(row, c.currency).toUpperCase().replace('RM', 'MYR') || 'SGD')
      if (!item || !amt) continue
      const d = parseDate(cell(row, c.date))
      out.push({
        source_id: sid('exp', item, cell(row, c.date), cell(row, c.amount)),
        title: item, category: 'cash_out', status: c.paid >= 0 && /^n/i.test(cell(row, c.paid)) ? 'pending' : 'paid',
        amount: amt.sgd, due_date: d.date, notes: cell(row, c.notes) || null,
        meta: { category: cell(row, c.category) || undefined, merchant: cell(row, c.merchant) || undefined, original: cell(row, c.amount), currency: amt.currency, ...src },
      })
    }
  }

  if (kind === 'tasks') {
    const h = findHeader(rows, [/task/i, /owner/i, /due/i])
    if (h < 0) return out
    const head = rows[h]
    const c = { task: colOf(head, /task/i), owner: colOf(head, /owner|who/i), due: colOf(head, /due/i), status: colOf(head, /status/i), notes: colOf(head, /notes?/i) }
    for (const row of rows.slice(h + 1)) {
      const task = cell(row, c.task)
      if (!task) continue
      const d = parseDate(cell(row, c.due))
      out.push({
        source_id: sid('task', task, cell(row, c.owner), cell(row, c.due)),
        title: task, category: 'task', status: /done|complete|✅/i.test(cell(row, c.status)) ? 'done' : 'open',
        amount: 0, due_date: d.date, notes: cell(row, c.notes) || null,
        meta: { owner: cell(row, c.owner) || undefined, ...src },
      })
    }
  }

  return out
}

// ---------- The sync ----------
export type TabReport = { sheet: string; tab: string; kind: Kind; found: number; added: number; review: number; error?: string }

export async function syncSheets(budgetMs = 240_000): Promise<{ ok: boolean; tabs: TabReport[]; added: number; error?: string }> {
  if (!supabaseConfigured) return { ok: false, tabs: [], added: 0, error: 'Supabase not configured' }
  if (!sheetsConfigured()) return { ok: false, tabs: [], added: 0, error: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' }
  const started = Date.now()
  const rates = await fxRates()
  const toSgd = (m: NonNullable<Money>) => (m.currency === 'SGD' ? m.amount : m.amount / (rates[m.currency] || 1))
  const tabs: TabReport[] = []
  let added = 0

  for (const source of [...SOURCES, ...templateSources()]) {
    if (Date.now() - started > budgetMs) {
      tabs.push({ sheet: source.label, tab: '*', kind: 'skip', found: 0, added: 0, review: 0, error: 'time budget used up — runs next time' })
      continue
    }
    let sheet: { tab: string; rows: string[][] }[]
    try {
      sheet = await readSheet(source.sheetId)
    } catch (e: any) {
      tabs.push({ sheet: source.label, tab: '*', kind: 'skip', found: 0, added: 0, review: 0, error: String(e?.message ?? e) })
      continue
    }
    for (const { tab, rows } of sheet) {
      const kind = source.pick(tab)
      if (kind === 'skip') continue
      const recs = mapTab(kind, rows, { source, tab, toSgd })
      // Same source_id twice in one tab = the same row typed twice; keep the first.
      const unique = [...new Map(recs.map(r => [r.source_id, r])).values()]
      for (const r of unique) r.meta = JSON.parse(JSON.stringify(r.meta)) // drop undefined keys
      const rep: TabReport = { sheet: source.label, tab, kind, found: unique.length, added: 0, review: unique.filter(r => r.meta.needs_review).length }
      try {
        for (let i = 0; i < unique.length; i += 200) {
          // ignoreDuplicates = "app wins": an existing source_id is never touched.
          const { data, error } = await supabase
            .from('records')
            .upsert(unique.slice(i, i + 200), { onConflict: 'source_id', ignoreDuplicates: true })
            .select('id')
          if (error) throw new Error(error.message)
          rep.added += data?.length ?? 0
        }
      } catch (e: any) {
        rep.error = String(e?.message ?? e)
      }
      added += rep.added
      tabs.push(rep)
    }
  }

  await supabase.from('ghl_sync_state').upsert({ key: 'sheets_last_sync', value: { at: new Date().toISOString(), added, tabs } })
  return { ok: tabs.every(t => !t.error), tabs, added }
}
