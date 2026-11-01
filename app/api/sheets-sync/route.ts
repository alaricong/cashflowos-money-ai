import { syncSheets } from '@/lib/sheets'
import { validCronBearer, validSession } from '@/lib/session'

// Pulls new rows from the owner's Google Sheets into `records` (insert-only).
// Who may call it: a signed-in app user or anything holding CRON_SECRET (the
// daily cron, or the first big import). Everyone else: 401.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  const ok = validSession(req.headers.get('cookie')) || validCronBearer(req.headers.get('authorization'))
  if (!ok) return new Response('forbidden', { status: 401 })
  try {
    return Response.json(await syncSheets())
  } catch (e: any) {
    console.error('[CFO] Sheets sync failed:', e)
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 })
  }
}
