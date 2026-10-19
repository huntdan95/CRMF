import 'server-only';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WHOLE_DAY_OVERLAPS } from '@/lib/availability';
import { adminDb } from '@/lib/firebase/admin';
import type { Booking } from '@/lib/firebase/types';
import { siteConfig } from '@/lib/site-config';
import { callAdminFunction } from './admin-functions';
import { TIME_SLOTS, attempt, fail, isoDate, ok, slotTimes, toCents } from './shared';

/*
 * Every change goes through the same admin Cloud Function as the button in
 * admin, so the checks, customer emails and audit log are identical. The
 * audit log marks these "by automation". Refunds and cancellations aren't
 * offered here; the functions that do them refuse the MCP token.
 */

const bookingId = z.string().trim().min(1).max(64).describe('Booking id, from list_bookings or get_booking.');

/** Matches adminAddNote's limit. */
const NOTE_MAX = 2000;

/** Stripe's minimum charge. */
const dollars = z.number().min(0.5).max(100_000);

const REFUNDS_ELSEWHERE = `Refunds and cancellations aren’t available here; they’re done in admin (${siteConfig.url}/admin).`;

export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    'add_booking_note',
    {
      title: 'Add a note to a booking',
      description:
        'Adds a line to the booking’s internal notes (only Travis sees them). Keeps what’s already there. ' +
        `Notes are limited to ${NOTE_MAX} characters in total.`,
      inputSchema: {
        bookingId,
        note: z.string().trim().min(1).max(NOTE_MAX),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ bookingId, note }) =>
      attempt('add_booking_note', async () => {
        // Appended by the function as it saves, so a line added meanwhile
        // (by Travis, or the site itself) isn't written over.
        const { adminNotes } = await callAdminFunction<{ adminNotes: string }>('adminAddNote', { bookingId, append: note });
        return ok({ ok: true, adminNotes });
      }),
  );

  server.registerTool(
    'mark_booking',
    {
      title: 'Mark a booking completed or no-show',
      description:
        'Marks a confirmed booking whose tour day has come as completed or a no-show. There is no undo, and it frees the seats.',
      inputSchema: {
        bookingId,
        status: z.enum(['completed', 'no-show']),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ bookingId, status }) =>
      attempt('mark_booking', async () => {
        await callAdminFunction('adminMarkBooking', { bookingId, status });
        return ok({ ok: true, bookingId, status });
      }),
  );

  server.registerTool(
    'resend_confirmation_email',
    {
      title: 'Resend the confirmation email',
      description: 'Emails the customer their booking confirmation again (copied to Travis). Confirmed bookings only.',
      inputSchema: { bookingId },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ bookingId }) =>
      attempt('resend_confirmation_email', async () => {
        await callAdminFunction('adminResendConfirmation', { bookingId });
        return ok({ ok: true, bookingId, emailed: true });
      }),
  );

  server.registerTool(
    'edit_booking',
    {
      title: 'Edit guests or contact details',
      description:
        'Changes a booking’s party size, guest names and ages, the customer’s name and phone, or the emergency contact. Only the fields you pass change. ' +
        'The customer’s email address can only be changed in admin (get_booking gives the link), since their booking links go to it. ' +
        'A bigger party is checked against the seats left on that departure. ' +
        'Changing the party size doesn’t charge or refund anything; ' +
        REFUNDS_ELSEWHERE,
      inputSchema: {
        bookingId,
        guestCount: z.number().int().min(1).max(6).optional(),
        guests: z
          .array(z.object({ name: z.string().trim().max(120), age: z.number().int().min(0).max(120).nullable() }))
          .max(6)
          .optional()
          .describe('The full guest list; replaces the current one.'),
        customerName: z.string().trim().min(1).max(120).optional(),
        customerPhone: z.string().trim().min(1).max(40).optional(),
        emergencyContactName: z.string().trim().max(120).optional(),
        emergencyContactPhone: z.string().trim().max(40).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ bookingId, ...patch }) =>
      attempt('edit_booking', async () => {
        if (Object.values(patch).every((v) => v === undefined)) return fail('Pass at least one field to change.');
        await callAdminFunction('adminEditBooking', { bookingId, ...patch });
        return ok({ ok: true, bookingId, changed: Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined) });
      }),
  );

  server.registerTool(
    'reschedule_booking',
    {
      title: 'Move a booking to another date or tour',
      description:
        'Moves an active booking to another date and tour (use list_tours for slugs). Checks the new departure has room and isn’t blacked out. ' +
        'By default emails a confirmed customer their updated booking. ' +
        'A price difference isn’t charged or refunded; ' +
        REFUNDS_ELSEWHERE,
      inputSchema: {
        bookingId,
        newDate: isoDate.describe('YYYY-MM-DD, today or later, on a departure that hasn’t left yet.'),
        newTourSlug: z.string().trim().min(1).max(64).describe('Tour slug, e.g. morning-shared.'),
        notifyCustomer: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ bookingId, newDate, newTourSlug, notifyCustomer }) =>
      attempt('reschedule_booking', async () => {
        await callAdminFunction('adminRescheduleBooking', { bookingId, newDate, newTourSlug, notifyCustomer });
        return ok({ ok: true, bookingId, newDate, newTourSlug, notifyCustomer });
      }),
  );

  server.registerTool(
    'create_blackout',
    {
      title: 'Close a day or departures',
      description:
        'Stops online booking for a whole day (`all`) or specific departures, e.g. for weather or boat maintenance. ' +
        'It does NOT cancel bookings already on those departures: they’re listed in the answer so Travis can call them, ' +
        `move them with reschedule_booking, or (in admin, ${siteConfig.url}/admin/blackouts) cancel and refund them or email them to pick a new date.`,
      inputSchema: {
        date: isoDate,
        slots: z
          .array(z.enum([...TIME_SLOTS, 'all']))
          .min(1)
          .describe('`all` for the whole day, or the departures to close.'),
        reason: z.enum(['weather', 'maintenance', 'personal', 'other']).optional(),
        notes: z.string().trim().max(500).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ date, slots, reason, notes }) =>
      attempt('create_blackout', async () => {
        const { blackoutId } = await callAdminFunction<{ blackoutId: string }>('adminCreateBlackout', {
          date,
          affectedSlots: slots,
          reason,
          notes,
          cancelAffected: false,
        });

        // Same reach as the admin's "cancel affected bookings" option.
        const all = slots.includes('all');
        const closesWholeDay = slots.some((s) => (WHOLE_DAY_OVERLAPS as string[]).includes(s));
        const hit = (slot: string) => all || (slots as string[]).includes(slot) || (slot === 'whole-day' && closesWholeDay);
        const snap = await adminDb().collection('bookings').where('date', '==', date).get();
        const stillBooked = snap.docs
          .map((d) => ({ id: d.id, b: d.data() as Booking }))
          .filter(({ b }) => (b.status === 'confirmed' || b.status === 'pending-payment') && hit(b.timeSlot))
          .map(({ id, b }) => ({
            bookingId: id,
            timeSlot: b.timeSlot,
            time: slotTimes(b.timeSlot, date),
            status: b.status,
            customerName: b.customerName,
            customerPhone: b.customerPhone,
            guests: b.guestCount,
          }));

        return ok({
          ok: true,
          blackoutId,
          date,
          slots,
          stillBooked,
          ...(stillBooked.length && {
            note: 'These bookings were not cancelled and the customers haven’t been told. Reschedule them, or cancel and refund them in admin.',
          }),
        });
      }),
  );

  server.registerTool(
    'delete_blackout',
    {
      title: 'Reopen a closed day or departure',
      description:
        'Removes a blackout (ids from list_blackouts) so those departures can be booked again. Doesn’t restore bookings that were cancelled. ' +
        'Anyone offered a new date who hasn’t moved or taken the refund goes back on their trip (returned as `restored`); they aren’t emailed, so Travis should tell them.',
      inputSchema: {
        blackoutId: z.string().trim().min(1).max(64),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ blackoutId }) =>
      attempt('delete_blackout', async () => {
        const r = await callAdminFunction<{ ok: true; restored?: unknown[] }>('adminDeleteBlackout', { blackoutId });
        return ok({ ok: true, blackoutId, restored: r.restored ?? [] });
      }),
  );

  server.registerTool(
    'update_tour',
    {
      title: 'Edit a tour',
      description:
        'Changes a tour’s name, description, what’s included, standard price, or whether it can be booked online. Only the fields you pass change. ' +
        'Prices are in US dollars: per person for shared tours, the whole boat for private ones. Live on the site within about a minute; ' +
        'seasonal rates (upsert_rate_season) still override the standard price on their dates.',
      inputSchema: {
        slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(64).describe('Tour slug from list_tours.'),
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().min(1).max(4000).optional(),
        included: z.array(z.string().trim().min(1).max(200)).max(20).optional().describe('Replaces the whole list.'),
        active: z.boolean().optional().describe('false hides the tour from online booking.'),
        pricePerPersonDollars: dollars.optional().describe('Shared tours only.'),
        flatPriceDollars: dollars.optional().describe('Private tours only.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ slug, pricePerPersonDollars, flatPriceDollars, ...rest }) =>
      attempt('update_tour', async () => {
        const patch = {
          ...rest,
          ...(pricePerPersonDollars !== undefined && { pricePerPerson: toCents(pricePerPersonDollars) }),
          ...(flatPriceDollars !== undefined && { flatPrice: toCents(flatPriceDollars) }),
        };
        if (Object.values(patch).every((v) => v === undefined)) return fail('Pass at least one field to change.');
        await callAdminFunction('adminUpdateTour', { slug, ...patch });
        return ok({ ok: true, slug });
      }),
  );

  server.registerTool(
    'upsert_rate_season',
    {
      title: 'Create or edit a seasonal rate',
      description:
        'Sets special prices for a date range (a season or a single holiday). Omit `id` to create one; pass the id from list_tours to edit it. ' +
        '`pricesDollars` replaces the season’s whole price list: tours left out charge their standard price on those dates. ' +
        'Where seasons overlap, the shorter one wins for each tour.',
      inputSchema: {
        id: z.string().trim().min(1).max(64).optional(),
        name: z.string().trim().min(1).max(80).describe('e.g. "Peak season" or "Christmas week".'),
        startDate: isoDate,
        endDate: isoDate.describe('Last day, inclusive.'),
        pricesDollars: z
          .record(z.string().regex(/^[a-z0-9-]+$/), dollars)
          .describe('Price by tour slug, in dollars: per person for shared tours, the whole boat for private.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ id, name, startDate, endDate, pricesDollars }) =>
      attempt('upsert_rate_season', async () => {
        if (endDate < startDate) return fail('endDate is before startDate.');
        if (Object.keys(pricesDollars).length === 0) return fail('Set a price for at least one tour.');
        const prices = Object.fromEntries(Object.entries(pricesDollars).map(([slug, d]) => [slug, toCents(d)]));
        const result = await callAdminFunction<{ id: string }>('adminUpsertRateSeason', {
          ...(id && { id }),
          name,
          startDate,
          endDate,
          prices,
        });
        return ok({ ok: true, id: result.id, created: !id });
      }),
  );

  server.registerTool(
    'delete_rate_season',
    {
      title: 'Delete a seasonal rate',
      description: 'Deletes a seasonal rate; its dates go back to standard prices.',
      inputSchema: {
        id: z.string().trim().min(1).max(64).describe('Season id from list_tours.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ id }) =>
      attempt('delete_rate_season', async () => {
        await callAdminFunction('adminDeleteRateSeason', { id });
        return ok({ ok: true, id });
      }),
  );

  server.registerTool(
    'update_contact_message',
    {
      title: 'Mark a contact message',
      description: 'Marks a contact-form message new, replied or archived. Doesn’t send anything.',
      inputSchema: {
        id: z.string().trim().min(1).max(64),
        status: z.enum(['new', 'replied', 'archived']),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id, status }) =>
      attempt('update_contact_message', async () => {
        await callAdminFunction('adminUpdateContactMessage', { id, status });
        return ok({ ok: true, id, status });
      }),
  );

  server.registerTool(
    'update_reschedule_request',
    {
      title: 'Update a reschedule request',
      description:
        'Sets a customer’s reschedule request to open, accepted, declined or resolved, with optional internal notes. ' +
        'Doesn’t move the booking (use reschedule_booking) or email the customer.',
      inputSchema: {
        id: z.string().trim().min(1).max(64),
        status: z.enum(['open', 'accepted', 'declined', 'resolved']),
        notes: z.string().trim().max(2000).optional().describe('Replaces the request’s internal notes.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id, status, notes }) =>
      attempt('update_reschedule_request', async () => {
        await callAdminFunction('adminUpdateRescheduleRequest', { id, status, ...(notes !== undefined && { notes }) });
        return ok({ ok: true, id, status });
      }),
  );

  server.registerTool(
    'set_trip_crew',
    {
      title: 'Take the crew off a trip, or put them back on',
      description:
        'For a trip too small to pay crew for: `crewNeeded: false` marks one departure as Travis running it solo, `true` puts the crew back on. ' +
        'The crew app shows a solo trip as "No crew needed", and the crew’s phones get a notification either way. ' +
        'get_day_schedule shows `noCrew: true` on solo trips.',
      inputSchema: {
        date: isoDate,
        timeSlot: z.enum(TIME_SLOTS),
        crewNeeded: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ date, timeSlot, crewNeeded }) =>
      attempt('set_trip_crew', async () => {
        const { changed } = await callAdminFunction<{ changed: boolean }>('adminSetTripCrew', {
          date,
          timeSlot,
          crewNeeded,
        });
        return ok({
          ok: true,
          date,
          timeSlot,
          time: slotTimes(timeSlot, date),
          crewNeeded,
          ...(changed
            ? { crewNotified: true }
            : { note: 'It was already set that way. Nothing changed and nobody was notified.' }),
        });
      }),
  );
}
