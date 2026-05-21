import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { siteConfig } from '@/lib/site-config';
import { getTourBySlug, slotLabels } from '@/lib/tours';
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

  const tour = getTourBySlug(booking.tourId);
  if (!tour) {
    return new NextResponse('Tour not found', { status: 500 });
  }

  // Compute local start/end as YYYYMMDDTHHmmSS strings (no Z) — paired
  // with TZID=America/New_York the calendar app does the right thing.
  const startLocal = formatIcsLocal(booking.date, tour.startTime);
  const endLocal = formatIcsLocal(booking.date, addHours(tour.startTime, tour.durationHours));
  const stamp = formatIcsUtc(new Date());
  const uid = `booking-${booking.id}@crystalrivermanateefun.com`;

  const selfServiceUrl = `${siteConfig.url}/my-booking/${booking.id}?t=${booking.accessToken}`;
  const location = `${siteConfig.marina.name}, ${siteConfig.marina.streetAddress}, ${siteConfig.marina.city}, ${siteConfig.marina.region} ${siteConfig.marina.postalCode}`;

  const description = [
    `${slotLabels[tour.timeSlot]} tour with Capt. Travis Urbin.`,
    ``,
    `Guests: ${booking.guestCount}`,
    `Meeting time: ${tour.startTimeDisplay} (arrive 15 min early)`,
    ``,
    `What we provide: wetsuit, mask, snorkel, fins, water, hot chocolate.`,
    `What to bring: swimsuit and your own towel.`,
    ``,
    `Self-service link: ${selfServiceUrl}`,
    `Questions: ${siteConfig.contact.phone}`,
  ].join('\\n');

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
    `SUMMARY:${icsEscape(tour.name)} — Crystal River Manatee Fun`,
    `LOCATION:${icsEscape(location)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `URL:${selfServiceUrl}`,
    'STATUS:CONFIRMED',
    // 24-hour reminder
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT24H',
    'DESCRIPTION:Manatee tour tomorrow — bring a swimsuit and a towel.',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

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
