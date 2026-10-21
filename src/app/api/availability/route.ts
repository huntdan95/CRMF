import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { dateRange } from '@/lib/availability';
import { isValidIsoDate } from '@/lib/date';
import { fetchAvailabilityRange, MAX_RANGE_DAYS } from '@/lib/availability-server';

export const dynamic = 'force-dynamic';

const isoDate = z.string().refine(isValidIsoDate, 'Use a real YYYY-MM-DD date');
const query = z.object({ from: isoDate, to: isoDate });

/**
 * GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   → { days: DayAvailability[] }
 *
 * Aggregate seat counts only. Powers the booking calendar's per-day
 * availability, which the getAvailability Cloud Function can only give one
 * day at a time.
 */
export async function GET(req: NextRequest) {
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD' }, { status: 400 });
  }
  const { from, to } = parsed.data;
  if (to < from || dateRange(from, to).length > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Range must be 1–${MAX_RANGE_DAYS} days` },
      { status: 400 },
    );
  }

  const days = await fetchAvailabilityRange(from, to);
  if (!days) {
    return NextResponse.json({ error: 'Availability is temporarily unavailable' }, { status: 503 });
  }
  return NextResponse.json(
    { days },
    {
      // A minute or so of staleness is fine: checkout re-checks seats inside
      // a transaction before anyone pays, and a guest whose checkout or
      // hold just changed the seats skips this copy (useAvailability's
      // `fresh`).
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=45' },
    },
  );
}
