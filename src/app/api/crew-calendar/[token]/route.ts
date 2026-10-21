import { cachedCrewFeed, crewIdForToken, requestOrigin } from '@/lib/crew-calendar/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteCtx {
  params: Promise<{ token: string }>;
}

/** Same answer for every link that doesn't work, so it says nothing about why. */
function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * GET /api/crew-calendar/:token
 *
 * A crew member's calendar subscription (emailed from Admin → Crew, or
 * taken from the crew app): every departure with guests on it from the
 * last 14 days to the next 120, as iCalendar. Departures Travis closed
 * show as cancelled. Counts only: no guest names, phones or emails, since
 * Apple and Google keep a copy on their servers. Built in
 * src/lib/crew-calendar/feed.ts, at most every 10 minutes per server
 * instance: the token is checked on every request, but every link gets the
 * same feed.
 *
 * An unknown, replaced or revoked token is a bare 404.
 */
export async function GET(req: Request, ctx: RouteCtx): Promise<Response> {
  const { token } = await ctx.params;

  let crewId: string | null;
  try {
    crewId = await crewIdForToken(token);
  } catch (err) {
    console.error('Crew calendar: token lookup failed', err);
    return new Response('Service unavailable', { status: 503, headers: { 'Retry-After': '300' } });
  }
  if (!crewId) return notFound();

  let ics: string;
  try {
    ics = await cachedCrewFeed(requestOrigin(req));
  } catch (err) {
    console.error('Crew calendar: feed failed', { crewId, err });
    return new Response('Service unavailable', { status: 503, headers: { 'Retry-After': '300' } });
  }

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="manatee-fun-trips.ics"',
      // Only the subscriber's own calendar app may keep a copy, and it must
      // check back before reusing it: never a shared cache.
      'Cache-Control': 'private, no-cache',
      // The URL is the password: keep it out of referrers and search.
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
