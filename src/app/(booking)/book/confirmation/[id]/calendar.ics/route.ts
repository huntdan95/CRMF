import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { siteConfig } from '@/lib/site-config';
import { hostFromHeaders } from '@/lib/host';
import { departureTimes, getTourBySlug, slotLabels } from '@/lib/tours';
import { slotStartTime } from '@/lib/schedule';
import type { Booking } from '@/lib/firebase/types';

export const runtime = 'nodejs';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * GET /book/confirmation/:id/calendar.ics?t=accessToken
 *
 * Token-validated iCalendar download. Embeds the marina address as the
 * event location, the tour name as the title, and a description including
 * a self-service link back to the booking. Times are written with
 * TZID=America/New_York so any calendar app handles the offset.
 */
export async function GET(req: Request, ctx: RouteCtx): Promise<Response> {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get('t');

  if (!token) {
    return new NextResponse('Missing access token', { status: 400 });
  }

  let booking: Booking | null = null;
  try {
    const snap = await adminDb().collection('bookings').doc(id).get();
    if (!snap.exists) {
      return new NextResponse('Booking not found', { status: 404 });
    }
    booking = snap.data() as Booking;
  } catch {
    return new NextResponse('Service unavailable', { status: 503 });
  }

  if (!booking || booking.accessToken !== token) {
    return new NextResponse('Invalid access token', { status: 403 });
  }

  // A saved confirmation link outlives the booking. Don't hand out a
  // "confirmed" event for a trip that isn't happening.
  if (booking.status === 'cancelled' || booking.status === 'no-show') {
    return new NextResponse(
      `This booking is ${booking.status === 'cancelled' ? 'cancelled' : 'closed'}. Questions? Call ${siteConfig.contact.phone}.`,
      { status: 410 },
    );
  }

  const tour = getTourBySlug(booking.tourId);
  if (!tour) {
    return new NextResponse('Tour not found', { status: 500 });
  }

  // Compute local start/end as YYYYMMDDTHHmmSS strings (no Z) — paired
  // with TZID=America/New_York the calendar app does the right thing.
  // From the schedule: the sunset cruise leaves at a different time each day.
  const departs = slotStartTime(tour.timeSlot, booking.date);
  const cruise = tour.timeSlot === 'sunset';
  const startLocal = formatIcsLocal(booking.date, departs);
  const endLocal = formatIcsLocal(booking.date, addHours(departs, tour.durationHours));
  const stamp = formatIcsUtc(new Date());
  const uid = `booking-${booking.id}@crystalrivermanateefun.com`;

  // Link back to the host the guest is on, so it works before launch too.
  const host = hostFromHeaders(req.headers);
  const origin = host
    ? `${/^(localhost|127\.0\.0\.1)$/.test(host) ? 'http' : 'https'}://${host}`
    : siteConfig.url;
  const selfServiceUrl = `${origin}/my-booking/${booking.id}?t=${booking.accessToken}`;
  const location = `${siteConfig.marina.name}, ${siteConfig.marina.streetAddress}, ${siteConfig.marina.city}, ${siteConfig.marina.region} ${siteConfig.marina.postalCode}`;

  const description = [
    cruise ? `Private sunset cruise with Capt. Travis Urbin.` : `${slotLabels[tour.timeSlot]} tour with Capt. Travis Urbin.`,
    ``,
    `Guests: ${booking.guestCount}`,
    `Meeting time: ${departureTimes(tour, booking.date).start} (arrive 15 min early)`,
    ``,
    ...(cruise
      ? [`It's BYOB: bring your own drinks and food.`]
      : [`What we provide: wetsuit, mask, snorkel, water, hot chocolate.`, `What to bring: swimsuit and your own towel.`]),
    ``,
    `Self-service link: ${selfServiceUrl}`,
    `Questions: ${siteConfig.contact.phone}`,
  ].join('\n'); // icsEscape turns these into the \n that iCalendar expects

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Crystal River Manatee Fun//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // VTIMEZONE for America/New_York
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
    // Event
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=America/New_York:${startLocal}`,
    `DTEND;TZID=America/New_York:${endLocal}`,
    `SUMMARY:${icsEscape(booking.tourName || tour.name)} — Crystal River Manatee Fun`,
    `LOCATION:${icsEscape(location)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `URL:${selfServiceUrl}`,
    booking.status === 'pending-payment' ? 'STATUS:TENTATIVE' : 'STATUS:CONFIRMED',
    // 24-hour reminder
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT24H',
    cruise
      ? 'DESCRIPTION:Sunset cruise tomorrow. It’s BYOB: bring your own drinks and food.'
      : 'DESCRIPTION:Manatee tour tomorrow — bring a swimsuit and a towel.',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(foldLine)
    .join('\r\n');

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="manatee-tour-${booking.date}.ics"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * iCalendar lines stop at 75 bytes; longer ones continue on the next line
 * after a leading space (RFC 5545 §3.1). Strict parsers (some Outlook
 * versions) reject the long DESCRIPTION otherwise. Splits between
 * characters, never inside one.
 */
function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    // Continuation lines spend one byte on the leading space.
    if (bytes + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function formatIcsLocal(dateIso: string, timeHHmm: string): string {
  // YYYYMMDDTHHMMSS
  const compactDate = dateIso.replace(/-/g, '');
  const compactTime = timeHHmm.replace(/:/g, '') + '00';
  return `${compactDate}T${compactTime}`;
}

function formatIcsUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = (h ?? 0) * 60 + (m ?? 0) + hours * 60;
  const newH = Math.floor(totalMinutes / 60) % 24;
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}
