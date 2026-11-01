import { syncGhl } from '@/lib/ghl'
import { validCronBearer, validSession } from '@/lib/session'

// Pulls the latest from GoHighLevel into the ghl_* tables.
// Who may call it: a signed-in app user (the "Sync now" button) or anything
// holding CRON_SECRET (the daily cron, or a manual backfill). Everyone else: 401.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const ok = validSession(req.headers.get('cookie')) || validCronBearer(req.headers.get('authorization'))
  if (!ok) return new Response('forbidden', { status: 401 })
  try {
    return Response.json(await syncGhl())
  } catch (e: any) {
    console.error('[CFO] GHL sync failed:', e)
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 })
  }
}
