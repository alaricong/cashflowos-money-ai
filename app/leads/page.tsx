import { getRecords, m, rm, type Rec } from '@/lib/records'
import Empty from '@/app/_components/Empty'

export const dynamic = 'force-dynamic'

// The Leads tab = the sales funnel as columns. Each lead is a `records` row with
// category='lead'; its `status` is the funnel stage. We show FOUR columns:
//   New (new + contacted — both "top of funnel") → Appointment → Closed → Nurture
// so the numbers here match the Dashboard funnel exactly (getFunnel groups
// new+contacted together as "Leads"). Per card: potential S$ + next follow-up.
const COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'new', label: 'New', statuses: ['new', 'contacted'] },
  { key: 'appointment', label: 'Appointment', statuses: ['appointment'] },
  { key: 'closed', label: 'Closed', statuses: ['closed'] },
  { key: 'nurture', label: 'Nurture', statuses: ['nurture'] },
]

const SHOW = 40

// Potential S$ for a lead: prefer the explicit meta.potential, else the amount.
function potential(r: Rec): number {
  const p = r.meta?.potential
  return Number(p ?? r.amount ?? 0)
}

// The next follow-up line: the action (meta.next) + the date it's due, if any.
function nextFollowUp(r: Rec): string {
  const action = m(r, 'next')
  const when = r.due_date ? ` · by ${r.due_date}` : ''
  return action === '—' ? (r.due_date ? `Follow up by ${r.due_date}` : 'No next step set') : `${action}${when}`
}

export default async function Leads() {
  const rows = await getRecords(['lead'])
  const leads = rows.filter(r => r.category === 'lead')

  return (
    <>
      <h1 className="ph">Leads 🎯</h1>
      <p className="cap">Your funnel: new → appointment → closed → nurture.</p>

      {leads.length === 0 ? (
        <Empty label="leads" />
      ) : (
        <div className="cols">
          {COLUMNS.map(col => {
            const inCol = leads
              .filter(r => col.statuses.includes((r.status || '').toLowerCase()))
              .sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''))
            return (
              <div className="col" key={col.key}>
                <h3>
                  {col.label} <span style={{ color: 'var(--dim)' }}>({inCol.length})</span>
                </h3>
                {inCol.length === 0 ? (
                  <p className="kc s" style={{ color: 'var(--dim)' }}>No leads here.</p>
                ) : (
                  // Thousands of imported leads: show the newest few per column.
                  inCol.slice(0, SHOW).map(r => (
                    <div className="kc" key={r.id}>
                      <p className="t">{r.title}</p>
                      {r.meta?.source && <p className="s">From: {r.meta.source}</p>}
                      <p className="s">Potential: {rm(potential(r))}</p>
                      <p className="s">Next: {nextFollowUp(r)}</p>
                    </div>
                  ))
                )}
                {inCol.length > SHOW && (
                  <p className="kc s" style={{ color: 'var(--dim)' }}>…and {inCol.length - SHOW} older</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
