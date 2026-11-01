import 'server-only'
import crypto from 'crypto'

// Verifies the opaque `cfo_session` cookie minted by /api/login (nonce.HMAC(nonce)).
// proxy.ts only checks the cookie EXISTS; routes that do real work call this to
// check it was actually signed with your APP_PASSCODE.
export function validSession(cookieHeader: string | null): boolean {
  const passcode = (process.env.APP_PASSCODE ?? '').trim()
  if (!passcode || !cookieHeader) return false
  const token = cookieHeader
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith('cfo_session='))
    ?.slice('cfo_session='.length)
  if (!token) return false
  const [nonce, sig] = decodeURIComponent(token).split('.')
  if (!nonce || !sig) return false
  const expected = crypto.createHmac('sha256', passcode).update(nonce).digest('hex')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// The daily cron / manual backfill path: `Authorization: Bearer <CRON_SECRET>`.
export function validCronBearer(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  return !!secret && authHeader === `Bearer ${secret}`
}
