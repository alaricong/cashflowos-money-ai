import Link from 'next/link'
import { rm, todayISO } from '@/lib/records'
import { getScoreEvents, groupBy, totals, weekOf, type Ev, type Totals } from '@/lib/scoreboard'
import Stat from '@/app/_components/Stat'
import Empty from '@/app/_components/Empty'

export const dynamic = 'force-dynamic'

// 📊 The Scoreboard — Leads → Attendees → Appointments → Show-ups → Sales → Cash,
// from your Google Sheets + GoHighLevel. Definitions live in lib/scoreboard.ts.

const RANGES = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
]

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')
const money = (n: number) => rm(Math.round(n))

function since(range: string): string | null {
  if (range === 'all') return null
  if (range === 'month') return `${todayISO().slice(0, 7)}-01`
  return new Date(Date.now() - Number(range) * 86400_000).toISOString().slice(0, 10)
}

// One table of the 6 numbers + conversion, grouped however the caller likes.
function ScoreTable({ title, label, rows, people = true }: { title: string; label: string; rows: { key: string; t: Totals }[]; people?: boolean }) {
  return (
    <>
      <p className="rowlabel">{title}</p>
      {rows.length === 0 ? (
        <div className="empty">Nothing in this period.</div>
      ) : (
        <table className="tbl" style={{ marginBottom: 24 }}>
          <thead>
            <tr>
              <th>{label}</th>
              {people && <th>Leads</th>}
              {people && <th>Attendees</th>}
              <th>Appts</th>
              <th>Show-ups</th>
              <th>Sales</th>
              <th>Cash</th>
              <th>Show %</th>
              <th>Close %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, t }) => (
              <tr key={key}>
                <td data-label={label}>{key}</td>
                {people && <td data-label="Leads">{t.leads.toLocaleString()}</td>}
                {people && <td data-label="Attendees">{t.attendees.toLocaleString()}</td>}
                <td data-label="Appts">{t.appointments}</td>
                <td data-label="Show-ups">{t.shows}</td>
                <td data-label="Sales">{t.sales}</td>
                <td data-label="Cash">{money(t.cash)}</td>
                <td data-label="Show %">{pct(t.shows, t.appointments)}</td>
                <td data-label="Close %">{pct(t.sales, t.shows || t.appointments)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

export default async function Scoreboard({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams
  const range = RANGES.some(r => r.key === sp.range) ? sp.range! : '30'
  const from = since(range)
  // Future-dated rows (upcoming instalments, typo'd years) never count as done.
  const today = todayISO()
  const inRange = (d: string | null) => (from ? !!d && d >= from && d <= today : !d || d <= today)

  const { events, adSpend } = await getScoreEvents()
  const evs: Ev[] = events.filter(e => inRange(e.date))
  const t = totals(evs)
  const spend = adSpend.filter(a => inRange(a.date)).reduce((s, a) => s + a.amount, 0)

  const byCampaign = groupBy(evs, e => e.campaign).slice(0, 25)
  // Closers with only one or two deals ever are folded into "Others" so the
  // table stays readable.
  const closerEvs = evs.filter(e => e.kind !== 'lead' && e.kind !== 'attendee')
  const dealCount = new Map<string, number>()
  for (const e of closerEvs) if (e.kind === 'sale' || e.kind === 'appointment') dealCount.set(e.closer, (dealCount.get(e.closer) ?? 0) + 1)
  const byCloser = groupBy(closerEvs, e => ((dealCount.get(e.closer) ?? 0) >= 3 ? e.closer || '—' : 'Others'))
  const byWebinar = groupBy(evs, e => (e.webinar && e.webinar <= today ? e.webinar : null), 'key-desc').slice(0, 20)
  const byWeek = groupBy(evs, e => (e.date ? weekOf(e.date) : null), 'key-desc').slice(0, 26)

  const steps: [string, string, string][] = [
    ['Leads', t.leads.toLocaleString(), ''],
    ['Attendees', t.attendees.toLocaleString(), pct(t.attendees, t.leads)],
    ['Appointments', t.appointments.toLocaleString(), pct(t.appointments, t.attendees || t.leads)],
    ['Show-ups', t.shows.toLocaleString(), pct(t.shows, t.appointments)],
    ['Sales', t.sales.toLocaleString(), pct(t.sales, t.shows || t.appointments)],
    ['Cash collected', money(t.cash), ''],
  ]

  return (
    <>
      <h1 className="ph">Scoreboard 📊</h1>
      <p className="cap">Leads → attendees → appointments → show-ups → sales → cash. From your Google Sheets + GoHighLevel.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {RANGES.map(r => (
          <Link key={r.key} href={`/scoreboard?range=${r.key}`} className={`pill${r.key === range ? ' paid' : ''}`}>
            {r.label}
          </Link>
        ))}
      </div>

      {events.length === 0 ? (
        <Empty label="scoreboard data — run the Sheets sync" />
      ) : (
        <>
          <p className="rowlabel">The scoreboard</p>
          <div className="grid">
            {steps.map(([label, value, conv]) => (
              <Stat key={label} label={conv ? `${label} · ${conv}` : label} value={value} />
            ))}
          </div>

          <p className="rowlabel">Ad spend &amp; costs</p>
          <div className="grid">
            <Stat label="Ad spend" value={money(spend)} />
            <Stat label="Cost per lead" value={t.leads ? money(spend / t.leads) : '—'} />
            <Stat label="Cost per appointment" value={t.appointments ? money(spend / t.appointments) : '—'} />
            <Stat label="ROAS (cash ÷ ad spend)" value={spend ? `${(t.cash / spend).toFixed(1)}×` : '—'} />
          </div>

          <ScoreTable title="By campaign (where the buyer first registered)" label="Campaign" rows={byCampaign} />
          <ScoreTable title="By closer" label="Closer" rows={byCloser} people={false} />
          <ScoreTable title="Per webinar" label="Webinar date" rows={byWebinar} />
          <ScoreTable title="Week by week" label="Week of" rows={byWeek} />
        </>
      )}
    </>
  )
}
