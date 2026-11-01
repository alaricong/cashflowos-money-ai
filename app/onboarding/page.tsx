import { supabase, supabaseConfigured } from '@/lib/supabase'
import { ghlConfigured } from '@/lib/ghl'
import SyncButton from '@/app/_components/SyncButton'

export const dynamic = 'force-dynamic'

// The Onboarding tab — every answer from your GHL onboarding form(s), newest first.
// Which forms count: any GHL form whose name contains "onboard", or the one in
// GHL_ONBOARDING_FORM_ID. The key fields go in the summary row; tap a row for all.

// 👉 The answers shown in the summary row. Matched loosely against GHL's field keys.
const KEY_FIELDS: { label: string; match: RegExp }[] = [
  { label: 'Programme', match: /programme|program|enrol/i },
  { label: 'Paid?', match: /has.?paid|single_dropdown_6xw6/i },
  { label: 'Payment plan', match: /payment.?plan|multi_line_80sm/i },
  { label: 'Introduced by', match: /introduc|single_line_25akn/i },
]

const pretty = (k: string) => k.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const show = (v: any) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v ?? ''))
const hidden = /signature|ip|useragent|timezone|fingerprint|^formId$|^location|^sessionId|^url$|^page|^medium|^source$|^type$|^parentId|^parentName|^contactId$/i

export default async function Onboarding() {
  let rows: any[] = []
  if (supabaseConfigured) {
    const { data } = await supabase.from('ghl_onboarding').select('*').order('submitted_at', { ascending: false }).limit(200)
    rows = data ?? []
  }

  return (
    <>
      <h1 className="ph">Onboarding 📝</h1>
      <p className="cap">Every onboarding form your new clients filled in GoHighLevel.</p>
      {ghlConfigured() ? <SyncButton /> : (
        <div className="banner">Connect GoHighLevel first (<code>GHL_API_KEY</code> + <code>GHL_LOCATION_ID</code>).</div>
      )}

      {rows.length === 0 ? (
        <div className="empty">No onboarding forms synced yet. Press Sync — if it stays empty, tell Claude the exact name of your onboarding form.</div>
      ) : (
        rows.map(r => {
          const a = r.answers ?? {}
          const keys = Object.keys(a)
          const pick = (re: RegExp) => {
            const k = keys.find(k => re.test(k))
            return k ? show(a[k]) : '—'
          }
          return (
            <details key={r.id} className="agent-card">
              <summary style={{ cursor: 'pointer' }}>
                <span className="ac-name" style={{ display: 'inline' }}>{r.name || r.email || 'Unknown'}</span>
                <span className="cap" style={{ marginLeft: 8 }}>
                  {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-SG') : ''} · {r.form_name}
                </span>
                <p className="ac-role" style={{ marginTop: 6 }}>
                  {KEY_FIELDS.map(f => `${f.label}: ${pick(f.match)}`).join(' · ')}
                </p>
              </summary>
              <table className="tbl" style={{ marginTop: 12 }}>
                <tbody>
                  {r.email ? <tr><td data-label="Field">Email</td><td data-label="Answer">{r.email}</td></tr> : null}
                  {keys.filter(k => !hidden.test(k) && show(a[k]).trim()).map(k => (
                    <tr key={k}>
                      <td data-label="Field" style={{ width: '38%' }}>{pretty(k)}</td>
                      <td data-label="Answer" style={{ whiteSpace: 'pre-wrap' }}>{show(a[k])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )
        })
      )}
    </>
  )
}
