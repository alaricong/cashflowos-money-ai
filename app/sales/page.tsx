import Link from 'next/link'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { ghlConfigured, lastSync } from '@/lib/ghl'
import { rm } from '@/lib/records'
import Stat from '@/app/_components/Stat'
import SyncButton from '@/app/_components/SyncButton'

export const dynamic = 'force-dynamic'

// The Sales tab — your GoHighLevel funnel: Leads → Booked → Showed → Sales → Cash.
// Numbers come from the ghl_* mirror tables (one RPC call, see supabase/ghl.sql).
//   • Leads     = opportunities CREATED in the period
//   • Booked    = appointments whose time has passed in the period (not cancelled)
//   • Showed    = appointments marked "Showed" in GHL (No-shows likewise)
//   • Sales     = opportunities that MOVED INTO a sale stage in the period
//   • Cash      = succeeded GHL payments in the period, in SGD, minus refunds

const RANGES = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
]

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')

export default async function Sales({ searchParams }: { searchParams: Promise<{ range?: string; pipeline?: string }> }) {
  const sp = await searchParams
  const range = RANGES.some(r => r.key === sp.range) ? sp.range! : '30'
  const pipeline = sp.pipeline || ''
  const from = new Date(Date.now() - Number(range) * 86400_000).toISOString()

  if (!ghlConfigured()) {
    return (
      <>
        <h1 className="ph">Sales 📈</h1>
        <div className="banner">
          Connect GoHighLevel first: add <code>GHL_API_KEY</code> and <code>GHL_LOCATION_ID</code> to your Vercel
          settings, then redeploy.
        </div>
      </>
    )
  }

  let s: any = null
  let pipelines: { id: string; name: string }[] = []
  let recentPay: any[] = []
  let recentSales: any[] = []
  if (supabaseConfigured) {
    const [sum, pl, pay, sales] = await Promise.all([
      supabase.rpc('ghl_summary', { p_from: from, p_pipeline: pipeline || null }),
      supabase.from('ghl_sync_state').select('value').eq('key', 'pipelines').maybeSingle(),
      supabase.from('ghl_payments').select('*').eq('status', 'succeeded').order('created_at', { ascending: false }).limit(10),
      (() => {
        let q = supabase.from('ghl_opportunities').select('*').eq('stage_bucket', 'sale').order('stage_changed_at', { ascending: false }).limit(10)
        if (pipeline) q = q.eq('pipeline_id', pipeline)
        return q
      })(),
    ])
    s = sum.data
    pipelines = (pl.data?.value as any[]) ?? []
    recentPay = pay.data ?? []
    recentSales = sales.data ?? []
  }
  const sync = await lastSync()
  const z = s ?? { leads: 0, booked: 0, upcoming: 0, showed: 0, no_shows: 0, unmarked: 0, sales: 0, sales_value: 0, lost: 0, cash_sgd: 0, payments: 0, by_rep: [] }
  const link = (r: string, p: string) => `/sales?range=${r}${p ? `&pipeline=${p}` : ''}`

  return (
    <>
      <h1 className="ph">Sales 📈</h1>
      <p className="cap">
        Live from GoHighLevel · last sync{' '}
        {sync?.at ? new Date(sync.at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }) : 'never'}
      </p>
      <SyncButton />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {RANGES.map(r => (
          <Link key={r.key} href={link(r.key, pipeline)} className={`pill${r.key === range ? ' paid' : ''}`}>
            {r.label}
          </Link>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <Link href={link(range, '')} className={`pill${!pipeline ? ' paid' : ''}`}>All pipelines</Link>
        {pipelines.map(p => (
          <Link key={p.id} href={link(range, p.id)} className={`pill${p.id === pipeline ? ' paid' : ''}`}>
            {p.name}
          </Link>
        ))}
      </div>

      <p className="rowlabel">The funnel · last {range} days</p>
      <div className="grid">
        <Stat label="Leads" value={z.leads} />
        <Stat label="Appointments held" value={z.booked} />
        <Stat label={`Showed · ${pct(z.showed, z.booked)}`} value={z.showed} />
        <Stat label="No-shows" value={z.no_shows} />
        <Stat label={`Sales · ${pct(z.sales, z.showed || z.booked)} close`} value={z.sales} />
        <Stat label="Cash collected" value={rm(Math.round(z.cash_sgd))} />
      </div>
      {z.unmarked > 0 ? (
        <p className="cap">
          {z.unmarked} past appointment{z.unmarked === 1 ? ' is' : 's are'} not marked Showed / No-show in GHL yet, so
          show rates may be understated. {z.upcoming} more booked ahead.
        </p>
      ) : null}

      <p className="rowlabel">By sales rep</p>
      {z.by_rep.length === 0 ? (
        <div className="empty">No rep activity in this period yet — press Sync.</div>
      ) : (
        <table className="tbl" style={{ marginBottom: 24 }}>
          <thead>
            <tr><th>Rep</th><th>Leads</th><th>Held</th><th>Showed</th><th>No-show</th><th>Sales</th><th>Didn't buy</th></tr>
          </thead>
          <tbody>
            {z.by_rep.map((r: any) => (
              <tr key={r.rep}>
                <td data-label="Rep">{r.rep}</td>
                <td data-label="Leads">{r.leads}</td>
                <td data-label="Held">{r.booked}</td>
                <td data-label="Showed">{r.showed}</td>
                <td data-label="No-show">{r.no_shows}</td>
                <td data-label="Sales">{r.sales}</td>
                <td data-label="Didn't buy">{r.lost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="rowlabel">Latest cash collected</p>
      {recentPay.length === 0 ? (
        <div className="empty">No payments synced yet.</div>
      ) : (
        <table className="tbl" style={{ marginBottom: 24 }}>
          <thead><tr><th>When</th><th>Who</th><th>Amount</th><th>Source</th></tr></thead>
          <tbody>
            {recentPay.map(p => (
              <tr key={p.id}>
                <td data-label="When">{p.created_at ? new Date(p.created_at).toLocaleDateString('en-SG') : '—'}</td>
                <td data-label="Who">{p.contact_name || p.email || '—'}</td>
                <td data-label="Amount">
                  {rm(p.amount_sgd)}
                  {p.currency !== 'SGD' ? <span className="cap"> ({p.currency} {Number(p.amount).toLocaleString()})</span> : null}
                </td>
                <td data-label="Source">{p.source_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="rowlabel">Latest sales</p>
      {recentSales.length === 0 ? (
        <div className="empty">No sales-stage moves synced yet.</div>
      ) : (
        <table className="tbl">
          <thead><tr><th>When</th><th>Who</th><th>Pipeline · stage</th><th>Rep</th><th>Value</th></tr></thead>
          <tbody>
            {recentSales.map(o => (
              <tr key={o.id}>
                <td data-label="When">{o.stage_changed_at ? new Date(o.stage_changed_at).toLocaleDateString('en-SG') : '—'}</td>
                <td data-label="Who">{o.contact_name || o.name}</td>
                <td data-label="Pipeline · stage">{o.pipeline_name} · {o.stage_name}</td>
                <td data-label="Rep">{o.rep_name || '—'}</td>
                <td data-label="Value">{o.monetary_value ? rm(o.monetary_value) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
