import { buildCrewFeed, crewIdForToken } from '@/lib/crew-calendar/server';
import { hostFromHeaders } from '@/lib/host';

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

/** The site's own origin for links in the feed: the host the calendar app asked. */
function originOf(req: Request): string {
  const host = hostFromHeaders(req.headers);
  if (!host) return new URL(req.url).origin;
  const local = host === 'localhost' || host === '127.0.0.1';
  const port = local ? new URL(req.url).port : '';
  return `${local ? 'http' : 'https'}://${host}${port ? `:${port}` : ''}`;
}

/**
 * GET /api/crew-calendar/:token
 *
 * A crew member's calendar subscription (emailed from Admin → Crew, or
 * taken from the crew app): every departure with guests on it from the
 * last 14 days to the next 120, as iCalendar. Departures Travis closed
 * show as cancelled. Counts only: no guest names, phones or emails, since
 * Apple and Google keep a copy on their servers. Built in
 * src/lib/crew-calendar/feed.ts.
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
    ics = await buildCrewFeed(originOf(req));
  } catch (err) {
    console.error('Crew calendar: feed failed', { crewId, err });
    return new Response('Service unavailable', { status: 503, headers: { 'Retry-After': '300' } });
  }

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="manatee-fun-trips.ics"',
      'Cache-Control': 'no-cache',
      // The URL is the password: keep it out of referrers and search.
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
