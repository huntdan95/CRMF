import 'server-only';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { computeDay, marinaNow, type BlackoutLite, type BookingLite } from '@/lib/availability';
import { fetchAvailabilityRange, MAX_RANGE_DAYS } from '@/lib/availability-server';
import { adminDb } from '@/lib/firebase/admin';
import type { Blackout, Booking, BookingStatus, ContactMessage, RescheduleRequest } from '@/lib/firebase/types';
import { seasonFor, standardUnitPrice, unitPriceOn } from '@/lib/pricing';
import { siteConfig } from '@/lib/site-config';
import { fetchTourCatalog } from '@/lib/tours-server';
import {
  addDays,
  attempt,
  byDeparture,
  fail,
  isoDate,
  isoTime,
  money,
  ok,
  slotLabel,
  slotTimes,
} from './shared';

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

const BOOKING_STATUSES = ['pending-payment', 'confirmed', 'cancelled', 'completed', 'no-show'] as const satisfies readonly BookingStatus[];

/** Most bookings one list_bookings call returns. */
const MAX_BOOKINGS = 200;
/** Longest date range list_bookings and list_blackouts read. */
const MAX_LIST_DAYS = 366;

type BookingDoc = Booking & { legacy?: Record<string, unknown> };

function isLegacy(id: string, b: BookingDoc): boolean {
  return !!b.legacy || id.startsWith('legacy-');
}

/**
 * Who is going out: confirmed (or already marked) bookings, plus old-site
 * bookings held with a deposit (imported as `pending-payment`). A new-site
 * `pending-payment` is someone still in Stripe checkout. Same rule as the
 * admin dashboard and the crew schedule.
 */
function onManifest(id: string, b: BookingDoc): boolean {
  if (b.status === 'pending-payment') return isLegacy(id, b);
  return b.status === 'confirmed' || b.status === 'completed' || b.status === 'no-show';
}

/** One line of a booking list: enough to recognise it and act on it. */
function bookingSummary(id: string, b: BookingDoc) {
  return {
    id,
    date: b.date,
    timeSlot: b.timeSlot,
    time: slotTimes(b.timeSlot),
    tour: b.tourName,
    type: b.type,
    guests: b.guestCount,
    status: b.status,
    payment: b.paymentStatus,
    paid: money(b.amountPaidCents),
    ...(b.amountRefundedCents ? { refunded: money(b.amountRefundedCents) } : {}),
    customerName: b.customerName,
    customerEmail: b.customerEmail,
    customerPhone: b.customerPhone,
    ...(isLegacy(id, b) ? { bookedOnOldSite: true } : {}),
    ...(b.adminNotes ? { hasNotes: true } : {}),
  };
}

function adminUrl(bookingId: string): string {
  return `${siteConfig.url}/admin/bookings/${encodeURIComponent(bookingId)}`;
}

export function registerReadTools(server: McpServer): void {
  server.registerTool(
    'get_availability',
    {
      title: 'Check availability',
      description:
        `Open seats and private-charter availability for each departure, for one day or a range of up to ${MAX_RANGE_DAYS} days. ` +
        'Counts the same way the booking page does: seats held by someone still paying count as taken. ' +
        '`departed` means it has left or is inside the 60-minute online cutoff (still bookable by phone).',
      inputSchema: {
        from: isoDate.describe('First date, YYYY-MM-DD (marina time, America/New_York).'),
        to: isoDate.optional().describe('Last date, inclusive. Defaults to `from`.'),
      },
      annotations: READ_ONLY,
    },
    ({ from, to = from }) =>
      attempt('get_availability', async () => {
        if (to < from) return fail('`to` is before `from`.');
        if (to > addDays(from, MAX_RANGE_DAYS - 1)) return fail(`Ask for ${MAX_RANGE_DAYS} days or fewer at a time.`);
        const days = await fetchAvailabilityRange(from, to);
        if (!days) return fail('Couldn’t reach the booking database. Try again in a minute.');
        return ok(
          days.map((d) => ({
            date: d.date,
            closedAllDay: d.closed,
            departures: d.slots.map((s) => ({
              timeSlot: s.timeSlot,
              label: slotLabel(s.timeSlot),
              time: slotTimes(s.timeSlot),
              sharedSeatsLeft: s.timeSlot === 'whole-day' ? null : s.sharedRemaining,
              privateAvailable: s.privateAvailable,
              bookedPrivately: s.privatelyBooked,
              closed: s.closed,
              departed: s.departed,
            })),
          })),
        );
      }),
  );

  server.registerTool(
    'list_tours',
    {
      title: 'List tours and prices',
      description:
        'Every tour with its schedule, capacity, standard price and whether it is bookable online, plus seasonal and holiday rates that haven’t ended. ' +
        'Shared tours are priced per person; private tours are a flat price for the whole boat. ' +
        'Pass `date` to also get each tour’s price on that day, with the season that sets it.',
      inputSchema: {
        date: isoDate.optional().describe('Show the price that applies on this date, YYYY-MM-DD.'),
      },
      annotations: READ_ONLY,
    },
    ({ date }) =>
      attempt('list_tours', async () => {
        const { tours, seasons } = await fetchTourCatalog();
        return ok({
          tours: tours.map((t) => {
            const unit = t.type === 'shared' ? 'per person' : 'whole boat';
            const season = date ? seasonFor(t, date, seasons) : null;
            return {
              slug: t.slug,
              name: t.name,
              active: t.active,
              type: t.type,
              timeSlot: t.timeSlot,
              time: `${t.startTimeDisplay} – ${t.endTimeDisplay}`,
              durationHours: t.durationHours,
              maxGuests: t.maxGuests,
              standardPrice: `${money(standardUnitPrice(t))} ${unit}`,
              ...(date && {
                priceOnDate: `${money(unitPriceOn(t, date, seasons))} ${unit}`,
                seasonOnDate: season?.name ?? null,
              }),
              included: t.included,
              description: t.description,
            };
          }),
          rateSeasons: seasons
            .slice()
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .map((s) => ({
              id: s.id,
              name: s.name,
              startDate: s.startDate,
              endDate: s.endDate,
              prices: Object.fromEntries(Object.entries(s.prices).map(([slug, cents]) => [slug, money(cents)])),
            })),
        });
      }),
  );

  server.registerTool(
    'list_bookings',
    {
      title: 'List bookings',
      description:
        'Bookings by tour date, soonest first, with customer contact details and payment status. ' +
        'Defaults to today through 30 days out, without cancelled bookings. ' +
        'Pass `customerEmail` to find someone’s bookings on any date, or `search` to filter by name, email, phone or booking id. ' +
        `Returns at most ${MAX_BOOKINGS}; use get_booking for guest names, notes and emergency contacts.`,
      inputSchema: {
        from: isoDate.optional().describe('First tour date, YYYY-MM-DD. Defaults to today (or any date with customerEmail).'),
        to: isoDate.optional().describe('Last tour date, inclusive. Defaults to 30 days after `from`.'),
        status: z
          .array(z.enum(BOOKING_STATUSES))
          .min(1)
          .optional()
          .describe('Only these statuses. Defaults to every status except cancelled.'),
        customerEmail: z.string().trim().email().optional().describe('Exact customer email.'),
        search: z.string().trim().min(2).max(100).optional().describe('Text to look for in name, email, phone or booking id.'),
      },
      annotations: READ_ONLY,
    },
    (input) =>
      attempt('list_bookings', async () => {
        const db = adminDb().collection('bookings');
        let from = input.from;
        let to = input.to;
        let snap;
        if (input.customerEmail) {
          snap = await db.where('customerEmail', '==', input.customerEmail.toLowerCase()).get();
        } else {
          from ??= marinaNow().date;
          to ??= addDays(from, 30);
          if (to < from) return fail('`to` is before `from`.');
          if (to > addDays(from, MAX_LIST_DAYS - 1)) return fail(`Ask for ${MAX_LIST_DAYS} days or fewer at a time.`);
          snap = await db.where('date', '>=', from).where('date', '<=', to).get();
        }

        const statuses = new Set<string>(input.status ?? BOOKING_STATUSES.filter((s) => s !== 'cancelled'));
        const needle = input.search?.toLowerCase();
        const rows = snap.docs
          .map((d) => ({ id: d.id, b: d.data() as BookingDoc }))
          .filter(({ b }) => statuses.has(b.status))
          .filter(({ b }) => (!from || b.date >= from) && (!to || b.date <= to))
          .filter(
            ({ id, b }) =>
              !needle ||
              [id, b.customerName, b.customerEmail, b.customerPhone].some((v) => v?.toLowerCase().includes(needle)),
          )
          .map(({ id, b }) => bookingSummary(id, b))
          .sort(byDeparture);

        return ok({
          count: rows.length,
          ...(rows.length > MAX_BOOKINGS && { showing: MAX_BOOKINGS, note: 'Narrow the dates to see the rest.' }),
          bookings: rows.slice(0, MAX_BOOKINGS),
        });
      }),
  );

  server.registerTool(
    'get_booking',
    {
      title: 'Get one booking',
      description:
        'Everything about one booking: guests and ages, emergency contact, payment and refunds, internal notes, cancellation details, ' +
        'any reschedule requests, and the link to it in admin (where refunds and cancellations are done).',
      inputSchema: {
        bookingId: z.string().trim().min(1).max(64),
      },
      annotations: READ_ONLY,
    },
    ({ bookingId }) =>
      attempt('get_booking', async () => {
        const db = adminDb();
        const [snap, requests] = await Promise.all([
          db.collection('bookings').doc(bookingId).get(),
          db.collection('rescheduleRequests').where('bookingId', '==', bookingId).get(),
        ]);
        if (!snap.exists) return fail(`No booking with id ${bookingId}.`);
        const b = snap.data() as BookingDoc;
        return ok({
          ...bookingSummary(snap.id, b),
          guestList: b.guests ?? [],
          emergencyContact: { name: b.emergencyContactName ?? '', phone: b.emergencyContactPhone ?? '' },
          adminNotes: b.adminNotes ?? '',
          ...(b.status === 'cancelled' && {
            cancellation: {
              reason: b.cancellationReason ?? null,
              by: b.cancelledBy ?? null,
              at: isoTime(b.cancelledAt),
            },
          }),
          ...(b.closure &&
            (b.status === 'confirmed' || b.status === 'pending-payment') && {
              closedDeparture: {
                reason: b.closure.reason,
                decideBy: b.closure.decideBy,
                note: 'Travis closed this departure; the customer was emailed to pick a new date or take a full refund. Unanswered by decideBy, it is cancelled and refunded automatically. Moving it with reschedule_booking settles it.',
              },
            }),
          stripePaymentIntentId: b.stripePaymentIntentId ?? null,
          ...(b.legacy && { oldSiteRecord: b.legacy }),
          bookedAt: isoTime(b.createdAt),
          updatedAt: isoTime(b.updatedAt),
          confirmationEmailSentAt: isoTime((b as { confirmationEmailSentAt?: unknown }).confirmationEmailSentAt),
          followUpEmailSentAt: isoTime((b as { postTourFollowupSentAt?: unknown }).postTourFollowupSentAt),
          rescheduleRequests: requests.docs.map((d) => {
            const r = d.data() as RescheduleRequest & { adminNotes?: string };
            return {
              id: d.id,
              requestedDate: r.requestedDate,
              requestedSlot: r.requestedSlot,
              notes: r.notes,
              status: r.status,
              adminNotes: r.adminNotes ?? null,
              requestedAt: isoTime(r.createdAt),
            };
          }),
          adminUrl: adminUrl(snap.id),
        });
      }),
  );

  server.registerTool(
    'get_day_schedule',
    {
      title: 'Day schedule and manifest',
      description:
        'The boat’s day: each departure with its seats left and the manifest of who is going (names, phones, guest names and ages, ' +
        'emergency contacts, notes), plus blackouts. Seats held by someone still in checkout are counted separately. ' +
        '`noCrew: true` marks a trip Travis is running without crew (set_trip_crew).',
      inputSchema: {
        date: isoDate.optional().describe('YYYY-MM-DD. Defaults to today at the marina.'),
      },
      annotations: READ_ONLY,
    },
    ({ date = marinaNow().date }) =>
      attempt('get_day_schedule', async () => {
        const db = adminDb();
        const [bookingSnap, blackoutSnap, soloSnap] = await Promise.all([
          db.collection('bookings').where('date', '==', date).get(),
          db.collection('blackouts').where('date', '==', date).get(),
          db.collection('soloTrips').where('date', '==', date).select().get(),
        ]);
        const soloTrips = new Set(soloSnap.docs.map((d) => d.id));
        const bookings = bookingSnap.docs.map((d) => ({ id: d.id, b: d.data() as BookingDoc }));
        const blackouts = blackoutSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Blackout, 'id'>) }));
        const day = computeDay(
          date,
          bookings.map(({ b }) => b as BookingLite),
          blackouts as BlackoutLite[],
        );

        const departures = day.slots
          .map((slot) => {
            const inSlot = bookings.filter(({ b }) => b.timeSlot === slot.timeSlot);
            const going = inSlot.filter(({ id, b }) => onManifest(id, b));
            const paying = inSlot.filter(({ id, b }) => b.status === 'pending-payment' && !isLegacy(id, b));
            return { slot, going, paying };
          })
          // Empty departures that can't be sold (the charter on a busy day) are noise.
          .filter(({ slot, going, paying }) => going.length || paying.length || slot.sharedRemaining > 0 || slot.privateAvailable)
          .map(({ slot, going, paying }) => ({
            timeSlot: slot.timeSlot,
            label: slotLabel(slot.timeSlot),
            time: slotTimes(slot.timeSlot),
            closed: slot.closed,
            departed: slot.departed,
            sharedSeatsLeft: slot.timeSlot === 'whole-day' ? null : slot.sharedRemaining,
            privateAvailable: slot.privateAvailable,
            guestsGoing: going.reduce((sum, { b }) => sum + b.guestCount, 0),
            ...(soloTrips.has(`${date}_${slot.timeSlot}`) && { noCrew: true }),
            ...(paying.length && {
              stillInCheckout: { bookings: paying.length, guests: paying.reduce((sum, { b }) => sum + b.guestCount, 0) },
            }),
            manifest: going.map(({ id, b }) => ({
              bookingId: id,
              tour: b.tourName,
              type: b.type,
              status: b.status,
              payment: b.paymentStatus,
              customerName: b.customerName,
              customerPhone: b.customerPhone,
              customerEmail: b.customerEmail,
              guests: b.guestCount,
              guestList: b.guests ?? [],
              emergencyContact: { name: b.emergencyContactName ?? '', phone: b.emergencyContactPhone ?? '' },
              ...(b.adminNotes && { adminNotes: b.adminNotes }),
              ...(isLegacy(id, b) && { bookedOnOldSite: true }),
            })),
          }));

        return ok({
          date,
          closedAllDay: day.closed,
          blackouts: blackouts.map((x) => ({
            id: x.id,
            slots: x.affectedSlots,
            reason: x.reason ?? null,
            notes: x.notes ?? null,
          })),
          departures,
        });
      }),
  );

  server.registerTool(
    'list_blackouts',
    {
      title: 'List blackouts',
      description: 'Days and departures Travis has closed (weather, maintenance, personal), soonest first. Defaults to today through 90 days out.',
      inputSchema: {
        from: isoDate.optional().describe('First date, YYYY-MM-DD. Defaults to today.'),
        to: isoDate.optional().describe('Last date, inclusive. Defaults to 90 days after `from`.'),
      },
      annotations: READ_ONLY,
    },
    ({ from = marinaNow().date, to }) =>
      attempt('list_blackouts', async () => {
        const last = to ?? addDays(from, 90);
        if (last < from) return fail('`to` is before `from`.');
        if (last > addDays(from, MAX_LIST_DAYS - 1)) return fail(`Ask for ${MAX_LIST_DAYS} days or fewer at a time.`);
        const snap = await adminDb()
          .collection('blackouts')
          .where('date', '>=', from)
          .where('date', '<=', last)
          .get();
        return ok(
          snap.docs
            .map((d) => {
              const x = d.data() as Blackout;
              return { id: d.id, date: x.date, slots: x.affectedSlots, reason: x.reason ?? null, notes: x.notes ?? null };
            })
            .sort((a, b) => a.date.localeCompare(b.date)),
        );
      }),
  );

  server.registerTool(
    'list_contact_messages',
    {
      title: 'List contact-form messages',
      description: 'Messages from the website’s contact form, newest first. Defaults to the ones still marked new.',
      inputSchema: {
        status: z.enum(['new', 'replied', 'archived', 'all']).default('new'),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: READ_ONLY,
    },
    ({ status, limit }) =>
      attempt('list_contact_messages', async () => {
        // Newest 200, filtered here: there's no (status, createdAt) index.
        const snap = await adminDb().collection('contactMessages').orderBy('createdAt', 'desc').limit(200).get();
        return ok(
          snap.docs
            .map((d) => ({ id: d.id, m: d.data() as ContactMessage }))
            .filter(({ m }) => status === 'all' || m.status === status)
            .slice(0, limit)
            .map(({ id, m }) => ({
              id,
              status: m.status,
              receivedAt: isoTime(m.createdAt),
              name: m.name,
              email: m.email,
              phone: m.phone,
              subject: m.subject,
              message: m.message,
            })),
        );
      }),
  );

  server.registerTool(
    'list_reschedule_requests',
    {
      title: 'List reschedule requests',
      description:
        'Requests customers sent from their booking page to move to another date, newest first. Defaults to open ones. ' +
        'To act on one, use reschedule_booking, then update_reschedule_request.',
      inputSchema: {
        status: z.enum(['open', 'accepted', 'declined', 'resolved', 'all']).default('open'),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: READ_ONLY,
    },
    ({ status, limit }) =>
      attempt('list_reschedule_requests', async () => {
        const snap = await adminDb().collection('rescheduleRequests').orderBy('createdAt', 'desc').limit(200).get();
        return ok(
          snap.docs
            .map((d) => ({ id: d.id, r: d.data() as RescheduleRequest & { adminNotes?: string } }))
            .filter(({ r }) => status === 'all' || r.status === status)
            .slice(0, limit)
            .map(({ id, r }) => ({
              id,
              status: r.status,
              requestedAt: isoTime(r.createdAt),
              bookingId: r.bookingId,
              customerEmail: r.bookingCustomerEmail,
              currentDate: r.bookingDate,
              currentSlot: r.bookingTimeSlot,
              requestedDate: r.requestedDate,
              requestedSlot: r.requestedSlot,
              customerNotes: r.notes,
              adminNotes: r.adminNotes ?? null,
            })),
        );
      }),
  );
}
