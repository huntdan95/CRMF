import 'server-only';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WHOLE_DAY_OVERLAPS } from '@/lib/availability';
import { adminDb } from '@/lib/firebase/admin';
import type { Booking } from '@/lib/firebase/types';
import { bigPriceChange, priceChangeWords } from '@/lib/pricing';
import { callAdminFunction } from './admin-functions';
import { TIME_SLOTS, attempt, fail, isoDate, money, ok, partySize, slotTimes, toCents } from './shared';

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

/** A price before and after a save, in cents, as adminUpdateTour and adminUpsertRateSeason answer. */
interface PriceChange {
  fromCents: number | null;
  toCents: number | null;
}

/**
 * "$84" → "$8.40", flagged when it moved by more than half either way, the
 * change admin asks Travis to confirm: Claude raises it with him instead.
 */
function describePriceChange({ fromCents, toCents }: PriceChange) {
  const flag = fromCents != null && toCents != null && bigPriceChange(fromCents, toCents);
  return {
    was: money(fromCents),
    now: money(toCents),
    ...(flag && { checkForTypo: `${priceChangeWords(fromCents, toCents)} than before` }),
  };
}

/** `origin`: the site as the request reached it, for the links into admin (createMcpServer). */
export function registerWriteTools(server: McpServer, origin: string): void {
  const refundsElsewhere = `Refunds and cancellations aren’t available here; they’re done in admin (${origin}/admin).`;

  server.registerTool(
    'add_booking_note',
    {
      title: 'Add a note to a booking',
      description:
        'Adds a line to the booking’s internal notes (customers never see them; the crew get them in the 8 PM email the night before the trip). Keeps what’s already there. ' +
        `A note can be up to ${NOTE_MAX} characters.`,
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
        'Marks a booking a no-show once its departure has left, or completed once it’s back: a confirmed booking, or one reserved on the old site. ' +
        'Not while it’s on a departure Travis closed, whether the customer is still choosing a new date or a refund or he left them booked: ' +
        'that trip didn’t go out, and he moves or refunds it in admin instead. If one he left booked went out after all, he marks it on its admin page (get_booking gives the adminUrl). ' +
        'There is no undo, and it frees the seats.',
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
      description:
        'Emails the customer their booking confirmation again (copied to Travis). Confirmed bookings only. ' +
        'Refused for a departure Travis closed, whether or not he offered a new date: a confirmation would tell them it’s still on ' +
        '(if he offered one, they have the “pick a new date” email instead). Refused too once the trip date has passed.',
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
        'Changes a booking’s party size, guest names, ages and wetsuit sizes, the customer’s name and phone, or the emergency contact. Only the fields you pass change. ' +
        'When you pass guests, give each one’s wetsuitSize as get_booking shows it (an adult size like "XL", a kids’ one like "Kids 8", or "None" for someone not swimming): a guest sent without one gets the size of whoever was at that place in the list before. ' +
        'A size Travis doesn’t stock is refused with the list of the ones he does. ' +
        'The customer’s email address can only be changed in admin (get_booking gives the link), since their booking links go to it. ' +
        'A bigger party is checked against the seats left on that departure. ' +
        'A booking whose online payment hasn’t gone through yet can’t be changed. ' +
        'Changing the party size doesn’t charge or refund anything; ' +
        refundsElsewhere,
      inputSchema: {
        bookingId,
        guestCount: z.number().int().min(1).max(6).optional(),
        guests: z
          .array(
            z.object({
              name: z.string().trim().max(120),
              age: z.number().int().min(0).max(120).nullable(),
              wetsuitSize: z
                .string()
                .trim()
                .max(20)
                .nullable()
                .optional()
                .describe('A size Travis stocks, or "None" for someone not swimming; null if they haven’t said.'),
            }),
          )
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
        'A booking whose online payment hasn’t gone through yet can’t be moved, and one with no party size only onto a private tour. ' +
        'By default emails a confirmed customer their updated booking; old-site reservations aren’t emailed. `emailed` in the answer says whether it went. ' +
        'A price difference isn’t charged or refunded; ' +
        refundsElsewhere,
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
        const r = await callAdminFunction<{ emailed: boolean; reason?: string }>('adminRescheduleBooking', {
          bookingId,
          newDate,
          newTourSlug,
          notifyCustomer,
        });
        return ok({
          ok: true,
          bookingId,
          newDate,
          newTourSlug,
          emailed: r.emailed,
          ...(!r.emailed && {
            notEmailed: r.reason,
            ...(r.reason !== 'not-asked' && { note: 'The customer wasn’t emailed. Travis should tell them the new date and time.' }),
          }),
        });
      }),
  );

  server.registerTool(
    'create_blackout',
    {
      title: 'Close a day or departures',
      description:
        'Stops online booking for a whole day (`all`) or specific departures, e.g. for weather or boat maintenance. ' +
        'It does NOT cancel bookings already on those departures: they’re listed in the answer so Travis can call them, ' +
        `move them with reschedule_booking, or (in admin, ${origin}/admin/blackouts) cancel and refund them or email them to pick a new date. ` +
        'With anyone still going out on them, the crew get the same "Closed" alert (push and email) as when Travis closes a day in admin and leaves the guests booked; ' +
        '`crewTold` says whether it reached every crew member.',
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
        const { blackoutId, crewTold } = await callAdminFunction<{ blackoutId: string; crewTold?: boolean }>('adminCreateBlackout', {
          date,
          affectedSlots: slots,
          reason,
          notes,
          cancelAffected: false,
        });
        // Whether the crew heard it's closed: absent when nobody's going out on those trips.
        const crew =
          crewTold === true
            ? 'The crew have been sent a "Closed" alert for these trips. '
            : crewTold === false
              ? 'The crew alert about these trips didn’t reach all of them: Travis should tell the crew himself. '
              : '';

        // Same reach as the admin's "cancel affected bookings" option.
        const all = slots.includes('all');
        const closesWholeDay = slots.some((s) => (WHOLE_DAY_OVERLAPS as string[]).includes(s));
        const hit = (slot: string) => all || (slots as string[]).includes(slot) || (slot === 'whole-day' && closesWholeDay);
        // The blackout is saved by now. If this read fails, saying "try
        // again" would close the day twice, so the answer says it's done.
        let snap;
        try {
          snap = await adminDb().collection('bookings').where('date', '==', date).get();
        } catch (err) {
          console.error('MCP create_blackout: couldn’t list the day’s bookings', err);
          return ok({
            ok: true,
            blackoutId,
            date,
            slots,
            ...(crewTold !== undefined && { crewTold }),
            note: `The departures are closed, so don’t close them again. ${crew}Couldn’t list who is still booked on them: check with get_day_schedule.`,
          });
        }
        const stillBooked = snap.docs
          .map((d) => ({ id: d.id, b: d.data() as Booking & { legacy?: unknown } }))
          .filter(({ b }) => (b.status === 'confirmed' || b.status === 'pending-payment') && hit(b.timeSlot))
          .map(({ id, b }) => ({
            bookingId: id,
            timeSlot: b.timeSlot,
            time: slotTimes(b.timeSlot, date),
            status: b.status,
            // A new-site booking still in Stripe checkout. An old-site
            // reservation is `pending-payment` too, but it's booked.
            ...(b.status === 'pending-payment' && !b.legacy && !id.startsWith('legacy-') && { stillPaying: true as const }),
            customerName: b.customerName,
            customerPhone: b.customerPhone,
            ...partySize(b),
          }));
        const paying = stillBooked.some((r) => 'stillPaying' in r);

        return ok({
          ok: true,
          blackoutId,
          date,
          slots,
          stillBooked,
          ...(crewTold !== undefined && { crewTold }),
          ...(stillBooked.length && {
            note:
              `These bookings were not cancelled and the customers haven’t been told. ${crew}Reschedule them, or cancel and refund them in admin.` +
              (paying
                ? ' `stillPaying` ones are in Stripe checkout right now and can’t be rescheduled. If they pay, the booking is confirmed on this closed departure (Travis is emailed, and they aren’t sent a confirmation); to stop that, cancel it in admin now.'
                : ''),
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
        'Anyone offered a new date who hasn’t moved or taken the refund goes back on their trip (returned as `restored`); they aren’t emailed, so Travis should tell them. ' +
        'A closing still in its undo window is undone (`undone: true`): nothing was sent for it. ' +
        'Otherwise it’s refused while a trip it closed has already left with someone still booked on it, since reopening would count that trip as having run; the error names them. ' +
        'Travis then marks them in admin if the trip went out after all, or they’re moved (reschedule_booking) or cancelled in admin, and it can be reopened. ' +
        '`alreadyLeft`: still booked on a trip that had already left (an undo after it went, or a reopen tried again), which now counts as having run: Travis should check whether they went. ' +
        'Anyone who paid for those trips while they were closed is sent the booking confirmation held back from them (`confirmationsSent`; `confirmationsFailed` didn’t go, so Travis should resend it from admin or call them). ' +
        '`crewTold`, when the crew had been told those trips were off: whether the "back on" message reached every crew member; if false, Travis should tell them himself. ' +
        '`stillClosed`: another blackout on that date still covers `all` or `some` of its trips, so those stay closed to booking (list_blackouts shows it); don’t say the day is open again.',
      inputSchema: {
        blackoutId: z.string().trim().min(1).max(64),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ blackoutId }) =>
      attempt('delete_blackout', async () => {
        const r = await callAdminFunction<{
          ok: true;
          undone?: boolean;
          restored?: Array<{ guests: number } & Record<string, unknown>>;
          crewTold?: boolean;
          confirmationsSent?: Array<Record<string, unknown>>;
          confirmationsFailed?: Array<Record<string, unknown>>;
          alreadyLeft?: Array<{ guests: number } & Record<string, unknown>>;
          stillClosed?: 'all' | 'some';
        }>('adminDeleteBlackout', {
          blackoutId,
        });
        // crewTold: false means the crew were told the trip was off and the
        // "back on" alert didn't reach them all, so Travis should tell them.
        const notes = [
          ...(r.alreadyLeft?.length
            ? ['The `alreadyLeft` bookings were on a trip that had already left, which now counts as having run. Travis should check whether they went, and move or cancel them in admin if they didn’t.']
            : []),
          ...(r.crewTold === false
            ? ['The crew were told these trips were off, and the message that they’re back on didn’t reach all of them. Travis should tell the crew himself.']
            : []),
          ...(r.stillClosed
            ? [`Another blackout on that date still covers ${r.stillClosed === 'all' ? 'these trips' : 'some of these trips'}, so ${r.stillClosed === 'all' ? 'they stay' : 'those stay'} closed to booking until it’s removed too.`]
            : []),
        ];
        return ok({
          ok: true,
          blackoutId,
          ...(r.undone && { undone: true }),
          // 0 guests is an old-site booking with no party size on file.
          restored: (r.restored ?? []).map((b) => ({ ...b, ...partySize({ guestCount: b.guests }) })),
          ...(r.alreadyLeft?.length && { alreadyLeft: r.alreadyLeft.map((b) => ({ ...b, ...partySize({ guestCount: b.guests }) })) }),
          ...(r.confirmationsSent?.length && { confirmationsSent: r.confirmationsSent }),
          ...(r.confirmationsFailed?.length && { confirmationsFailed: r.confirmationsFailed }),
          ...(r.crewTold !== undefined && { crewTold: r.crewTold }),
          ...(r.stillClosed && { stillClosed: r.stillClosed }),
          ...(notes.length > 0 && { note: notes.join(' ') }),
        });
      }),
  );

  server.registerTool(
    'update_tour',
    {
      title: 'Edit a tour',
      description:
        'Changes a tour’s name, description, what’s included, standard price, or whether it can be booked online. Only the fields you pass change. ' +
        'Prices are in US dollars: per person for shared tours, the whole boat for private ones. Live on the site as soon as it’s saved (within a minute at most); ' +
        'seasonal rates (upsert_rate_season) still override the standard price on their dates. ' +
        'A price change answers with the old and new price (`price`); if it says `checkForTypo`, tell Travis and ask whether he meant it, as the next booking is charged it.',
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
        const r = await callAdminFunction<{ priceChange?: PriceChange }>('adminUpdateTour', { slug, ...patch });
        return ok({ ok: true, slug, ...(r.priceChange && { price: describePriceChange(r.priceChange) }) });
      }),
  );

  server.registerTool(
    'upsert_rate_season',
    {
      title: 'Create or edit a seasonal rate',
      description:
        'Sets special prices for a date range (a season or a single holiday). Omit `id` to create one; pass the id from list_tours to edit it. ' +
        '`pricesDollars` replaces the season’s whole price list: tours left out charge their standard price on those dates. ' +
        'Where seasons overlap, the shorter one wins for each tour. ' +
        'The answer lists each tour whose price changed, old and new (`priceChanges`, from the standard price for a tour the season didn’t price before); ' +
        'tell Travis about any marked `checkForTypo` and ask whether he meant it, as the next booking on those dates is charged it.',
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
        const result = await callAdminFunction<{ id: string; priceChanges?: Array<PriceChange & { tour: string }> }>(
          'adminUpsertRateSeason',
          { ...(id && { id }), name, startDate, endDate, prices },
        );
        return ok({
          ok: true,
          id: result.id,
          created: !id,
          priceChanges: (result.priceChanges ?? []).map(({ tour, ...change }) => ({ tour, ...describePriceChange(change) })),
        });
      }),
  );

  server.registerTool(
    'delete_rate_season',
    {
      title: 'Delete a seasonal rate',
      description: 'Deletes a seasonal rate; its dates go back to standard prices. Fails with "Season not found" for an id no season has (use the id from list_tours, not the name).',
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
