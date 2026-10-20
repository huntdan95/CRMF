import type { NextRequest } from 'next/server';
import { hostFromHeaders } from '@/lib/host';

/** Holds the OAuth `state` between leaving for Google and coming back. */
export const STATE_COOKIE = 'crmf_drive_oauth_state';

/**
 * Where Google sends Travis back. It has to be listed exactly in the OAuth
 * client's "Authorized redirect URIs" in Google Cloud, once per host
 * (the live domain, and the staging URL if he connects from there).
 */
export function callbackUrl(req: NextRequest): string {
  const host = hostFromHeaders(req.headers);
  const local = host === 'localhost' || host === '127.0.0.1';
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || (local ? 'http' : 'https');
  const port = local ? `:${req.nextUrl.port || '3000'}` : '';
  return `${proto}://${host}${port}/api/admin/google-drive/callback`;
}
