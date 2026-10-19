import { NextResponse } from 'next/server';
import { getCrewMember } from '@/lib/crew-server';
import { feedUrls, issueCalendarToken, requestOrigin } from '@/lib/crew-calendar/server';
import { hostFromHeaders } from '@/lib/host';

export const runtime = 'nodejs';

/**
 * POST /api/crew/calendar
 *
 * Makes the signed-in crew member a new calendar link and returns it. The
 * old one stops working. The link is only ever in this response (and in
 * the email if Travis sends one from admin); the server keeps its hash.
 */
export async function POST(req: Request) {
  const member = await getCrewMember();
  if (!member) {
    return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  }
  // Only from the crew app itself, so another site can't make a phone
  // replace its link. (The SameSite=Lax session cookie mostly stops that
  // already.)
  if (!sameSite(req.headers.get('origin'), hostFromHeaders(req.headers))) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  try {
    const token = await issueCalendarToken(member);
    return NextResponse.json(
      { ok: true, ...feedUrls(requestOrigin(req), token) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('Crew calendar link failed:', err);
    return NextResponse.json(
      { error: 'Couldn’t make a calendar link just now. Try again in a minute.' },
      { status: 500 },
    );
  }
}

/** No Origin header (some same-origin requests) is fine; another site's isn't. */
function sameSite(origin: string | null, host: string): boolean {
  if (origin === null) return true;
  try {
    return new URL(origin).hostname.toLowerCase() === host;
  } catch {
    return false;
  }
}
