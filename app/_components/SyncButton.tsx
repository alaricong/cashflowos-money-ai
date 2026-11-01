'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

// "Sync now" — pulls the latest from GoHighLevel, then refreshes the page.
export default function SyncButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const router = useRouter()

  async function run() {
    setBusy(true)
    setMsg('')
    try {
      const res = await fetch('/api/ghl-sync', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.ok === false) {
        setMsg(`Sync hit a problem: ${j.reason || j.error || (j.errors || []).join('; ') || res.status}`)
      } else {
        setMsg(
          `Synced ${j.opportunities} leads, ${j.appointments} appointments, ${j.payments} payments, ${j.onboarding} onboarding forms.` +
            (j.backfillDone === false ? ' Older history still loading — press again to continue.' : ''),
        )
      }
      router.refresh()
    } catch {
      setMsg('Could not reach the server. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
      <button className="btn" onClick={run} disabled={busy}>
        {busy ? 'Syncing… (up to a minute)' : '🔄 Sync from GHL now'}
      </button>
      {msg ? <span className="cap" style={{ margin: 0 }}>{msg}</span> : null}
    </div>
  )
}
