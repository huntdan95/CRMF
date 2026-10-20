import 'server-only';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { computeDay, marinaNow, type BookingLite } from '@/lib/availability';
import { fetchAvailabilityRange, MAX_RANGE_DAYS } from '@/lib/availability-server';
import { blackoutCovers, departureOff, fetchClosedDays, type BlackoutRow, type ClosedDays } from '@/lib/closed-departures';
import { adminDb } from '@/lib/firebase/admin';
import type { Blackout, Booking, BookingStatus, ContactMessage, RescheduleRequest, TourTimeSlot } from '@/lib/firebase/types';
import { SALES_TAX_RATE, seasonFor, standardUnitPrice, unitPriceOn } from '@/lib/pricing';
import { SLOT_MINUTES, slotStartMinutes } from '@/lib/schedule';
import { formatClock } from '@/lib/tours';
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
  partySize,
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
 * Who is going out: confirmed (or already marked completed) bookings, plus
 * old-site bookings held with a deposit (imported as `pending-payment`). A
 * new-site `pending-payment` is someone still in Stripe checkout, and a
 * no-show didn't go. Same rule as the admin dashboard and the crew schedule.
 */
function onManifest(id: string, b: BookingDoc): boolean {
  if (b.status === 'pending-payment') return isLegacy(id, b);
  return b.status === 'confirmed' || b.status === 'completed';
}

/** {@link onManifest} before the trip is marked: still to go out, or left booked on one that didn't. */
function goingAhead(id: string, b: BookingDoc): boolean {
  return onManifest(id, b) && b.status !== 'completed';
}

/**
 * Whether the boat has left on this departure, by its start time (marina
 * time). Not the 60-minute online cutoff, which `departed` is.
 */
function hasLeft(date: string, slot: string, now = marinaNow()): boolean {
  if (date !== now.date) return date < now.date;
  return slot in SLOT_MINUTES && now.minutes >= slotStartMinutes(slot as TourTimeSlot, date);
}

/** Guests on these bookings: the known ones added up, and how many bookings that leaves out (no party size on file). */
function guestsGoing(list: ReadonlyArray<{ b: BookingDoc }>): { guestsGoing: number; bookingsWithNoPartySize?: number } {
  const known = list.filter(({ b }) => b.guestCount > 0);
  const unknown = list.length - known.length;
  return {
    guestsGoing: known.reduce((sum, { b }) => sum + b.guestCount, 0),
    ...(unknown > 0 && { bookingsWithNoPartySize: unknown }),
  };
}

/**
 * Old-site money a cancellation left for Travis to refund himself (never in
 * `refunded`), and once he's recorded it in admin ("Refunded by hand"),
 * when he did.
 */
function refundByHand(b: BookingDoc) {
  const cents = b.manualRefundCents ?? 0;
  if (cents <= 0) return {};
  return b.manualRefundedAt
    ? { refundedByHand: money(cents), refundedByHandAt: isoTime(b.manualRefundedAt) }
    : { owedBackByHand: money(cents) };
}

/**
 * A trip Travis reopened after offering them a new date: until the offer's
 * deadline (the end of that day, marina time) a customer cancel is refunded
 * in full, whatever the 72-hour policy says, as the offer promised. The
 * deadline is usually after the trip, and nothing can be cancelled once it
 * has left, so then it's until the trip leaves, as their booking page says
 * (refundGraceExplanation in src/lib/refund-policy.ts). Gone once it has
 * left, and never on an old-site booking: those can't be cancelled online,
 * and Travis refunds them himself.
 */
function fullRefundUntil(id: string, b: BookingDoc) {
  const now = marinaNow();
  const grace = b.refundGraceUntil;
  const active = b.status === 'confirmed' || b.status === 'pending-payment';
  if (!active || !grace || grace < now.date || isLegacy(id, b) || hasLeft(b.date, b.timeSlot, now)) return {};
  // Nothing left to refund: their booking page doesn't offer it either.
  if (b.amountPaidCents <= (b.amountRefundedCents ?? 0)) return {};
  if (grace < b.date) return { fullRefundUntil: `${grace}, end of the day` };
  const departs = b.timeSlot in SLOT_MINUTES ? ` ${formatClock(slotStartMinutes(b.timeSlot, b.date))}` : '';
  return { fullRefundUntil: `${b.date}${departs}, when the trip leaves` };
}

/** Explains the fields above, for the tools that return them. */
const MONEY_FIELDS =
  '`owedBackByHand`: old-site money a cancellation left for Travis to refund himself (`refundedByHand` and `refundedByHandAt` once he has recorded it). ' +
  '`fullRefundUntil`: Travis reopened their trip after offering a new date, so if the customer cancels on their booking page before then (usually when the trip leaves) it’s refunded in full, whatever the 72-hour policy says. ' +
  'Not there once the trip has left (it can’t be cancelled then), or for an old-site booking (Travis cancels and refunds those himself).';

/**
 * A booking on a departure Travis closed, as its admin page tells it:
 * `customer-choosing` (they were emailed to pick a new date or take a full
 * refund), `being-called-off` (a closure that cancels them or offers them a
 * new date is in its undo window, or going out now) or `left-booked` (a
 * blackout over the trip with them still on it: he closed it and left them
 * booked, closed it from MCP, or they paid after it closed). Read from the
 * day's blackouts and closure actions, as the dashboard reads them
 * (src/lib/closed-departures.ts). A booking marked completed went out
 * after all, so it's none of these.
 */
type ClosedState =
  | { state: 'customer-choosing'; reason: string; decideBy: string }
  | { state: 'being-called-off'; reason: string | null; willBe: 'cancelled' | 'offered a new date'; goingOutNow: boolean }
  | { state: 'left-booked'; reason: string | null };

function closedDeparture(id: string, b: BookingDoc, closed: ClosedDays | null): { closedDeparture?: ClosedState } {
  if (b.closure && (b.status === 'confirmed' || b.status === 'pending-payment')) {
    return { closedDeparture: { state: 'customer-choosing', reason: b.closure.reason, decideBy: b.closure.decideBy } };
  }
  if (!closed || !goingAhead(id, b)) return {};
  const covering = closed.blackouts.filter((bo) => bo.date === b.date && blackoutCovers(bo.affectedSlots, b.timeSlot));
  if (covering.length === 0) return {};
  const actions = covering.flatMap((bo) => closed.actions.get(bo.id) ?? []);
  const callingOff = actions.find((a) => (a.state === 'pending' || a.state === 'finalizing') && a.choice !== 'keep');
  if (callingOff) {
    return {
      closedDeparture: {
        state: 'being-called-off',
        reason: callingOff.reason,
        willBe: callingOff.choice === 'cancel' ? 'cancelled' : 'offered a new date',
        goingOutNow: callingOff.state === 'finalizing',
      },
    };
  }
  return { closedDeparture: { state: 'left-booked', reason: covering[0]!.reason ?? actions[0]?.reason ?? null } };
}

/** What Travis can do about a booking on a closed departure: the advice of its admin page (BookingDetail). */
function closedNote(id: string, b: BookingDoc, c: ClosedState): string {
  const legacy = isLegacy(id, b);
  const owed = b.amountPaidCents > (b.amountRefundedCents ?? 0);
  switch (c.state) {
    case 'customer-choosing':
      return legacy
        ? 'Travis closed this departure; the customer was emailed to pick a new date or take a full refund. Unanswered by decideBy, it is cancelled automatically, but it was paid on the old website, so Travis refunds that by hand. Moving it with reschedule_booking settles it.'
        : 'Travis closed this departure; the customer was emailed to pick a new date or take a full refund. Unanswered by decideBy, it is cancelled and refunded automatically. Moving it with reschedule_booking settles it.';
    case 'being-called-off':
      return (
        `Travis is calling off this departure${c.goingOutNow ? ', and it’s going out now' : ', and its undo time is still open'}: ` +
        (c.willBe === 'cancelled'
          ? `the customer is cancelled${legacy || !owed ? '' : ' and refunded in full'}`
          : b.customerEmail
            ? 'the customer is emailed to pick a new date or take a full refund'
            : 'the customer is offered a new date or a full refund') +
        (c.goingOutNow ? ', with everyone else on it.' : ' when it’s up, with everyone else on it, unless he undoes it in admin.') +
        (legacy && owed ? ' It was paid on the old website, so Travis refunds that himself.' : '') +
        (b.customerEmail ? '' : ' There’s no email on file, so the site can’t tell them: Travis should call them.') +
        ' Leave the booking to the closure.'
      );
    case 'left-booked':
      return (
        'Travis closed this departure and left them booked on it, to contact them himself; their booking page says he’ll be in touch. ' +
        'It isn’t going out unless he says so. He moves it to another day (reschedule_booking), or cancels it in admin to refund them in full' +
        (legacy ? ' (paid on the old website, so he refunds that himself)' : '') +
        ', even once the date has passed. If it went out after all, he marks it on its admin page once it has left.'
      );
  }
}

/** One line of a booking list: enough to recognise it and act on it. */
function bookingSummary(id: string, b: BookingDoc, closed: ClosedDays | null) {
  return {
    id,
    date: b.date,
    timeSlot: b.timeSlot,
    time: slotTimes(b.timeSlot, b.date),
    tour: b.tourName,
    type: b.type,
    ...partySize(b),
    status: b.status,
    payment: b.paymentStatus,
    paid: money(b.amountPaidCents),
    ...(b.amountRefundedCents ? { refunded: money(b.amountRefundedCents) } : {}),
    ...refundByHand(b),
    ...fullRefundUntil(id, b),
    ...closedDeparture(id, b, closed),
    customerName: b.customerName,
    customerEmail: b.customerEmail,
    customerPhone: b.customerPhone,
    ...(isLegacy(id, b) ? { bookedOnOldSite: true } : {}),
    ...(b.adminNotes ? { hasNotes: true } : {}),
  };
}

/** Explains `closedDeparture`, for the tools that return it. */
const CLOSED_FIELD =
  '`closedDeparture`: the booking is on a departure Travis closed, so don’t tell the customer it’s going out. ' +
  '`state` is `customer-choosing` (emailed to pick a new date or take a full refund by `decideBy`), ' +
  '`being-called-off` (his closure is in its undo window, or `goingOutNow`; then they’re cancelled and refunded, or offered a new date, as `willBe` says) ' +
  'or `left-booked` (he left them booked and is contacting them himself; it isn’t going out unless he says so).';

/** `origin`: the site as the request reached it, so the link opens on the address admin is on. */
function adminUrl(origin: string, bookingId: string): string {
  return `${origin}/admin/bookings/${encodeURIComponent(bookingId)}`;
}

/** `origin`: the site as the request reached it, for the links into admin (createMcpServer). */
export function registerReadTools(server: McpServer, origin: string): void {
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
              time: slotTimes(s.timeSlot, d.date),
              sharedSeatsLeft: s.timeSlot === 'whole-day' || s.timeSlot === 'sunset' ? null : s.sharedRemaining,
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
        `Every price is before the ${SALES_TAX_RATE * 100}% Florida sales tax, which checkout adds on top (\`salesTax\`). ` +
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
          salesTax: `${SALES_TAX_RATE * 100}% Florida sales tax is added at checkout on top of every price here.`,
          tours: tours.map((t) => {
            const unit = t.type === 'shared' ? 'per person' : 'whole boat';
            const season = date ? seasonFor(t, date, seasons) : null;
            return {
              slug: t.slug,
              name: t.name,
              active: t.active,
              type: t.type,
              timeSlot: t.timeSlot,
              time: slotTimes(t.timeSlot, date ?? undefined) ?? `${t.startTimeDisplay} – ${t.endTimeDisplay}`,
              ...(t.timeSlot === 'sunset' && {
                schedule: 'Runs April 1 – November 14, leaving 90 minutes before sunset (rounded down to the quarter hour). Pass a date for that day’s time.',
              }),
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
          // The catalog keeps last week's ended seasons for pricing moves.
          rateSeasons: seasons
            .filter((s) => s.endDate >= marinaNow().date)
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
        `Returns at most ${MAX_BOOKINGS}; use get_booking for guest names, notes and emergency contacts. ` +
        `${CLOSED_FIELD} ${MONEY_FIELDS}`,
      inputSchema: {
        from: isoDate.optional().describe('First tour date, YYYY-MM-DD. Defaults to today (or any date with customerEmail).'),
        to: isoDate.optional().describe('Last tour date, inclusive. Defaults to 30 days after `from`.'),
        status: z
          .array(z.enum(BOOKING_STATUSES))
          .min(1)
          .optional()
          .describe('Only these statuses. Defaults to every status except cancelled.'),
        customerEmail: z.string().trim().email().optional().describe('The customer’s email address.'),
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
          // Saved lowercased. As typed too, for a booking whose address was
          // changed in admin before that was so.
          const asTyped = input.customerEmail;
          snap = await db.where('customerEmail', 'in', [...new Set([asTyped.toLowerCase(), asTyped])]).get();
        } else {
          from ??= marinaNow().date;
          to ??= addDays(from, 30);
          if (to < from) return fail('`to` is before `from`.');
          if (to > addDays(from, MAX_LIST_DAYS - 1)) return fail(`Ask for ${MAX_LIST_DAYS} days or fewer at a time.`);
          snap = await db.where('date', '>=', from).where('date', '<=', to).get();
        }

        const statuses = new Set<string>(input.status ?? BOOKING_STATUSES.filter((s) => s !== 'cancelled'));
        const needle = input.search?.toLowerCase();
        const found = snap.docs
          .map((d) => ({ id: d.id, b: d.data() as BookingDoc }))
          .filter(({ b }) => statuses.has(b.status))
          .filter(({ b }) => (!from || b.date >= from) && (!to || b.date <= to))
          .filter(
            ({ id, b }) =>
              !needle ||
              [id, b.customerName, b.customerEmail, b.customerPhone].some((v) => v?.toLowerCase().includes(needle)),
          );
        // The closed days over the ones that could be on a closed departure
        // with no closure of their own, to tell those apart (closedDeparture).
        const dates = found
          .filter(({ id, b }) => goingAhead(id, b) && !b.closure)
          .map(({ b }) => b.date)
          .sort();
        const closed = dates.length ? await fetchClosedDays(dates[0]!, dates[dates.length - 1]!) : null;
        const rows = found.map(({ id, b }) => bookingSummary(id, b, closed)).sort(byDeparture);

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
        'any reschedule requests, and the link to it in admin (where refunds and cancellations are done). ' +
        `${CLOSED_FIELD} Its \`note\` says what Travis can do about it. ${MONEY_FIELDS} ` +
        '`priceBeforeTax` and `salesTax`: the tour price and the Florida sales tax checkout charged on it, which make up `paid` once it’s paid. ' +
        'Not there on old-site bookings or ones made before the tax: their `paid` has any tax in it, not split out. ' +
        '`cancellation.reasonIsPrivate`: Travis cancelled without emailing them and the reason is his own: don’t pass it on to the customer.',
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
        const closed = goingAhead(snap.id, b) && !b.closure ? await fetchClosedDays(b.date, b.date) : null;
        const summary = bookingSummary(snap.id, b, closed);
        return ok({
          ...summary,
          guestList: b.guests ?? [],
          emergencyContact: { name: b.emergencyContactName ?? '', phone: b.emergencyContactPhone ?? '' },
          adminNotes: b.adminNotes ?? '',
          ...(b.status === 'cancelled' && {
            cancellation: {
              reason: b.cancellationReason ?? null,
              ...(b.cancellationReasonPrivate && { reasonIsPrivate: true }),
              by: b.cancelledBy ?? null,
              at: isoTime(b.cancelledAt),
            },
          }),
          ...(summary.closedDeparture && {
            closedDeparture: { ...summary.closedDeparture, note: closedNote(snap.id, b, summary.closedDeparture) },
          }),
          // What checkout charged, split: older bookings don't record it.
          ...(typeof b.subtotalCents === 'number' &&
            typeof b.salesTaxCents === 'number' && {
              priceBeforeTax: money(b.subtotalCents),
              salesTax: money(b.salesTaxCents),
            }),
          stripePaymentIntentId: b.stripePaymentIntentId ?? null,
          ...(b.legacy && { oldSiteRecord: b.legacy }),
          bookedAt: isoTime(b.createdAt),
          updatedAt: isoTime(b.updatedAt),
          confirmationEmailSentAt: isoTime((b as { confirmationEmailSentAt?: unknown }).confirmationEmailSentAt),
          // The old-site importer stamps it only so the email never goes.
          followUpEmailSentAt:
            (b as { postTourFollowupMessageId?: string }).postTourFollowupMessageId === 'legacy-import'
              ? null
              : isoTime((b as { postTourFollowupSentAt?: unknown }).postTourFollowupSentAt),
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
          adminUrl: adminUrl(origin, snap.id),
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
        '`noCrew: true` marks a trip Travis is running without crew (set_trip_crew). ' +
        'Some old-site bookings have no party size on file (`guests: null`): `guestsGoing` counts the known ones, and `bookingsWithNoPartySize` how many it leaves out. ' +
        '`closed` only means it isn’t on sale (a blackout, the whole-day charter that day, or out of season), not that it isn’t going out. ' +
        '`off` says when a departure people are booked on isn’t going out, as admin shows it: `closing` (Travis is closing it: the undo time is still open, or it’s going out now), ' +
        '`cancelled` (everyone on it was asked to pick a new date: `notGoingOut`) or `closed-booked` (he closed it and left them booked, to contact them himself: not going out unless he says so). ' +
        'A booking marked completed on a closed departure went out after all. ' +
        '`departed` means it’s inside the 60-minute online cutoff, so it can only be booked by phone; `left` means the boat has actually left (until then Travis can still close it, or move bookings onto it, here).',
      inputSchema: {
        date: isoDate.optional().describe('YYYY-MM-DD. Defaults to today at the marina.'),
      },
      annotations: READ_ONLY,
    },
    ({ date = marinaNow().date }) =>
      attempt('get_day_schedule', async () => {
        const db = adminDb();
        const [bookingSnap, closedDays, soloSnap] = await Promise.all([
          db.collection('bookings').where('date', '==', date).get(),
          fetchClosedDays(date, date),
          db.collection('soloTrips').where('date', '==', date).select().get(),
        ]);
        const soloTrips = new Set(soloSnap.docs.map((d) => d.id));
        const bookings = bookingSnap.docs.map((d) => ({ id: d.id, b: d.data() as BookingDoc }));
        const blackouts = closedDays.blackouts as Array<BlackoutRow & Pick<Blackout, 'notes'>>;
        const day = computeDay(
          date,
          bookings.map(({ b }) => b as BookingLite),
          blackouts,
        );
        const now = marinaNow();

        const departures = day.slots
          .map((slot) => {
            const inSlot = bookings.filter(({ b }) => b.timeSlot === slot.timeSlot);
            // Travis closed it and they're picking another date: not going out.
            const moving = inSlot.filter(({ id, b }) => onManifest(id, b) && !!b.closure && b.status !== 'completed');
            const going = inSlot.filter(({ id, b }) => onManifest(id, b) && !moving.some((m) => m.id === id));
            const paying = inSlot.filter(({ id, b }) => b.status === 'pending-payment' && !isLegacy(id, b));
            // A departure Travis closed, read as the dashboard and the crew
            // app read it. Marked completed, a booking went out after all,
            // so it doesn't count as left booked.
            const off = departureOff(
              date,
              slot.timeSlot,
              { live: going.filter(({ b }) => b.status !== 'completed').length, moving: moving.length },
              closedDays,
            );
            return { slot, going, paying, moving, off };
          })
          // Empty departures that can't be sold (the charter on a busy day) are noise.
          .filter(({ slot, going, paying, moving }) => going.length || paying.length || moving.length || slot.sharedRemaining > 0 || slot.privateAvailable)
          .map(({ slot, going, paying, moving, off }) => ({
            timeSlot: slot.timeSlot,
            label: slotLabel(slot.timeSlot),
            time: slotTimes(slot.timeSlot, date),
            closed: slot.closed,
            ...(off && { off }),
            departed: slot.departed,
            left: hasLeft(date, slot.timeSlot, now),
            sharedSeatsLeft: slot.timeSlot === 'whole-day' || slot.timeSlot === 'sunset' ? null : slot.sharedRemaining,
            privateAvailable: slot.privateAvailable,
            ...guestsGoing(going),
            ...(soloTrips.has(`${date}_${slot.timeSlot}`) && { noCrew: true }),
            ...(paying.length && {
              stillInCheckout: { bookings: paying.length, guests: paying.reduce((sum, { b }) => sum + b.guestCount, 0) },
            }),
            ...(moving.length && {
              notGoingOut: {
                note: 'Travis closed this departure. These customers were asked to pick a new date or take a refund and haven’t yet.',
                bookings: moving.map(({ id, b }) => ({
                  bookingId: id,
                  customerName: b.customerName,
                  ...partySize(b),
                  decideBy: b.closure!.decideBy,
                })),
              },
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
              ...partySize(b),
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
