import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

import { phoneHref, tripLabel } from './bounce-alert';
import type { CheckoutHold } from './checkout-hold';
import { ADMIN_EMAIL, APP_BASE_URL } from './config';
import { SITE_TIMEZONE, marinaNow } from './datetime';
import { actions, button, card, details, emailPage, escape, heading, link, list, notice, para, subheading } from './email-layout';
import { isEmailSendError, sendEmail, type EmailDeps } from './email-log';
import { db as defaultDb } from './firebase';
import { isLegacyBooking, type Booking, type Tour } from './types';

/**
 * Unpaid checkouts one visitor can have open at once. Each holds seats for
 * up to half an hour, so without a limit one visitor (or a script) could
 * tie up a whole day's boat by starting checkouts and never paying.
 */
export const MAX_OPEN_CHECKOUTS = 3;

/**
 * How far back an unpaid checkout counts. Stripe expires a session 31
 * minutes after createCheckoutSession makes it, and the webhook then lets
 * the booking go; a few minutes more covers a slow webhook. Older ones are
 * left out, so a hold whose expiry never arrived can't lock a visitor out
 * for good.
 */
export const OPEN_CHECKOUT_WINDOW_MS = 35 * 60 * 1000;

const PHONE_DISPLAY = '352-586-7792';

/** What the booking page shows the visitor who's turned away. */
export const CHECKOUT_LIMIT_MESSAGE =
  'You already have checkouts open that haven’t been paid. Finish paying in one of them, ' +
  'or try again in half an hour, once they’ve lapsed. To book now, call Travis at ' +
  `${PHONE_DISPLAY}.`;

/**
 * The visitor's IP address, or null when there isn't one we can trust.
 *
 * The booking page calls the functions straight at
 * us-central1-crmf-99aad.cloudfunctions.net (NEXT_PUBLIC_FUNCTIONS_BASE_URL),
 * with no Hosting rewrite or load balancer of ours in between. A 2nd-gen
 * function is a Cloud Run service, and Google's front end, which takes the
 * connection, appends the address it came from to X-Forwarded-For. Anything
 * already in the header was sent by the client and stays to the left, so it
 * arrives as "<whatever the client sent>, <the client's address>". Only the
 * last entry is Google's, so that's the one we use; the rest are the
 * client's say-so.
 *
 * Not `req.ip`, whichever way Express's `trust proxy` is set. The Functions
 * Framework that serves 2nd-gen functions turns it on, and with it `true`,
 * Express (proxy-addr) walks X-Forwarded-For to its leftmost entry: exactly
 * the one a client writes itself, so a script could send a new one with
 * each request and never be counted twice. With it off, `req.ip` is the
 * socket's address, which is Google's proxy and the same for everyone.
 *
 * No header, a last entry that isn't an address, or a private one (the
 * emulator, or a proxy hop we don't know about) gives null, and the caller
 * then doesn't count: falling back to another entry would trust the client,
 * and a proxy's address would put every visitor under one limit. If the
 * functions are ever put behind a load balancer or a Hosting rewrite, it
 * adds its own entry after the visitor's, and this has to skip it.
 */
export function clientIp(headers: IncomingHttpHeaders): string | null {
  return readForwardedFor(headers).ip;
}

/**
 * {@link clientIp}, with how many entries X-Forwarded-For had and which one
 * it took (0 is the leftmost; null when none could be trusted).
 * createCheckoutSession logs those two, never the address, for the launch
 * check that the address read is the visitor's.
 */
export function readForwardedFor(headers: IncomingHttpHeaders): { ip: string | null; entries: number; index: number | null } {
  const raw = headers['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw.join(',') : raw;
  const entries = (header ?? '').split(',').map((e) => e.trim());
  const count = header?.trim() ? entries.length : 0;
  const none = { ip: null, entries: count, index: null };
  // Google's own hops come last and the client can't forge them: a load
  // balancer appends its address after the visitor's. Skip those, then take
  // the next one in. Counting a Google address would put every visitor under
  // one shared limit.
  while (entries.length > 1 && isGoogleProxy(unmapIpv4(entries[entries.length - 1]!))) entries.pop();
  const index = entries.length - 1;
  const last = entries.pop();
  if (!last || !isIP(last)) return none;
  const ip = unmapIpv4(last);
  return isPrivateAddress(ip) || isGoogleProxy(ip) ? none : { ip, entries: count, index };
}

/**
 * Google Front End and load-balancer proxy ranges (35.191.0.0/16,
 * 130.211.0.0/22): the addresses Google's own proxies connect from, never a
 * visitor's.
 */
function isGoogleProxy(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
  return (a === 35 && b === 191) || (a === 130 && b === 211 && c <= 3);
}

/** `::ffff:203.0.113.5` (an IPv4 address written as IPv6) as `203.0.113.5`. */
function unmapIpv4(ip: string): string {
  return /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)?.[1] ?? ip;
}

/** Loopback, private and link-local ranges: never a visitor on the internet. */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/**
 * Who counts as one visitor: an IPv4 address, or an IPv6 address's /64.
 * An IPv6 connection (a phone, a home network) is given a whole /64 and can
 * pick a new address in it at will, so counting single IPv6 addresses
 * would count nothing.
 */
export function visitorKey(ip: string): string {
  const addr = unmapIpv4(ip);
  if (isIP(addr) !== 6) return addr;
  const [head = '', tail] = addr.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // A trailing IPv4 part (64:ff9b::203.0.113.5) fills two groups.
  const width = (parts: string[]) => parts.reduce((n, p) => n + (p.includes('.') ? 2 : 1), 0);
  const groups = [...left, ...Array<string>(8 - width(left) - width(right)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/**
 * What's saved on the booking as `checkoutIpHash`, so raw addresses aren't
 * kept: SHA-256 of the visitor's key with a fixed prefix. It's a label, not
 * a secret (an IPv4 address can be found from it by trying them all), so
 * bookings stay admin-only as they are, and it's only kept while the
 * checkout is unpaid, the one time it's counted: it comes off when the
 * booking is paid (recordCompletedCheckout) or the checkout is let go
 * (Stripe expiring it, releaseHold, a cancel).
 */
export function checkoutIpHash(ip: string): string {
  return createHash('sha256').update(`crmf-checkout-visitor:${visitorKey(ip)}`).digest('hex');
}

type HoldFields = Pick<Booking, 'id' | 'status' | 'accessToken' | 'legacy'> & { createdAt?: unknown };

/**
 * The visitor's unpaid checkouts that count against them: waiting for
 * payment, started in the last {@link OPEN_CHECKOUT_WINDOW_MS}, and not an
 * old-site import. Not the checkout this request replaces either (the
 * customer backed out of Stripe and is trying again): createCheckoutSession
 * has just let it go, or Stripe will. It has to come with its access token,
 * so nobody can name someone else's to get one more.
 *
 * One whose start time can't be read isn't counted: better to let a
 * checkout through than lock someone out over it.
 */
export function openCheckouts<T extends HoldFields>(
  bookings: T[],
  opts: { nowMs: number; replacing?: CheckoutHold },
): T[] {
  const since = opts.nowMs - OPEN_CHECKOUT_WINDOW_MS;
  const { replacing } = opts;
  return bookings.filter((b) => {
    if (b.status !== 'pending-payment' || isLegacyBooking(b)) return false;
    if (replacing && b.id === replacing.bookingId && b.accessToken === replacing.accessToken) return false;
    const started = millis(b.createdAt);
    return started !== null && started >= since;
  });
}

function millis(ts: unknown): number | null {
  const toMillis = (ts as { toMillis?: unknown } | null | undefined)?.toMillis;
  return typeof toMillis === 'function' ? (toMillis.call(ts) as number) : null;
}

/** The visitor already has {@link MAX_OPEN_CHECKOUTS} unpaid checkouts open. */
export class CheckoutLimitError extends Error {
  constructor(public readonly open: Booking[]) {
    super(CHECKOUT_LIMIT_MESSAGE);
    this.name = 'CheckoutLimitError';
  }
}

/**
 * Throws {@link CheckoutLimitError} when this visitor already has
 * {@link MAX_OPEN_CHECKOUTS} unpaid checkouts open ({@link openCheckouts}).
 * A visitor we couldn't identify (`ipHash` null) is never refused.
 *
 * Pass the booking transaction as `tx` for the check that decides: the
 * query is read in the same transaction that saves the new booking, so two
 * checkouts from one visitor at once can't both see two open and both go
 * through. Without `tx` it's a plain read, to turn someone away before a
 * Stripe session is made for nothing.
 */
export async function assertCheckoutAllowed(opts: {
  ipHash: string | null;
  replacing?: CheckoutHold;
  tx?: Transaction;
  db?: Firestore;
  nowMs?: number;
}): Promise<void> {
  const { ipHash, replacing, tx, db = defaultDb, nowMs = Date.now() } = opts;
  if (!ipHash) return;
  // Equality filters only: Firestore merges its automatic single-field
  // indexes for these, so no composite index is needed.
  const query = db
    .collection('bookings')
    .where('checkoutIpHash', '==', ipHash)
    .where('status', '==', 'pending-payment');
  const snap = tx ? await tx.get(query) : await query.get();
  const open = openCheckouts(
    snap.docs.map((d) => d.data() as Booking),
    { nowMs, replacing },
  );
  if (open.length >= MAX_OPEN_CHECKOUTS) throw new CheckoutLimitError(open);
}

/** A checkout that was turned away, for Travis. */
export interface CheckoutLimitAlert {
  ipHash: string;
  /** What they tried to book. */
  attempt: {
    customer: { name: string; email: string; phone: string };
    tour: Pick<Tour, 'name' | 'timeSlot' | 'type'>;
    date: string;
    guestCount: number;
  };
  /** Their unpaid checkouts that were open. */
  open: Booking[];
}

const clock = new Intl.DateTimeFormat('en-US', { timeZone: SITE_TIMEZONE, hour: 'numeric', minute: '2-digit' });

const guestsLabel = (n: number) => `${n} guest${n === 1 ? '' : 's'}`;

/**
 * The email to Travis when a visitor is turned away: who it was and what
 * they tried to book (with a tap-to-call link), and the unpaid checkouts
 * they had open, each with its admin link.
 */
export function buildCheckoutLimitAlertEmail(alert: CheckoutLimitAlert, baseUrl: string) {
  const { customer, tour, date, guestCount } = alert.attempt;
  const name = customer.name || 'Someone';
  const trip = tripLabel({ date, timeSlot: tour.timeSlot, type: tour.type });
  const tel = customer.phone ? phoneHref(customer.phone) : null;
  const base = baseUrl.replace(/\/$/, '');
  const adminUrl = (id: string) => `${base}/admin/bookings/${encodeURIComponent(id)}`;

  const subject = `[CRMF] Checkout turned away: ${name} (${trip})`;
  const lead =
    `${name} tried to start a checkout while ${alert.open.length} others from the same internet ` +
    'connection were still unpaid, so the site turned it away. It told them to finish paying in one ' +
    'of those, wait for them to lapse, or call you.';
  const next =
    'Most likely they’re having trouble paying: give them a call. Unpaid checkouts let their ' +
    'seats go on their own within half an hour.';
  const once = 'You get this at most once a day for the same connection.';

  const holdLine = (b: Booking) => {
    const started = millis(b.createdAt);
    return [
      b.customerName || 'No name',
      `${tripLabel(b)}, ${guestsLabel(b.guestCount)}`,
      started !== null ? `started ${clock.format(new Date(started))}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const text = [
    lead,
    '',
    next,
    '',
    `Name:      ${customer.name}`,
    `Email:     ${customer.email}`,
    `Phone:     ${customer.phone || 'not given'}${tel ? ` (${tel})` : ''}`,
    `Trip:      ${trip} · ${tour.name}, ${guestsLabel(guestCount)}`,
    '',
    'Unpaid checkouts open:',
    ...alert.open.map((b) => `- ${holdLine(b)}: ${adminUrl(b.id)}`),
    '',
    once,
  ].join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${name}: ${trip}`,
    body: [
      heading('Checkout turned away'),
      para(escape(lead), { large: true }),
      notice(
        `${para(escape(next), { margin: '0' })}${
          tel
            ? actions(button(tel, `Call ${name}: ${customer.phone}`))
            : para('No phone number given.', { soft: true, margin: '12px 0 0' })
        }`,
      ),
      card(
        details([
          ['Name', escape(customer.name)],
          ['Email', link(`mailto:${customer.email}`, customer.email)],
          ['Phone', tel ? link(tel, customer.phone) : escape(customer.phone || 'Not given')],
          ['Trip', `${escape(trip)}<br/>${escape(tour.name)}, ${escape(guestsLabel(guestCount))}`],
        ]),
        { table: true },
      ),
      subheading('Unpaid checkouts open', { margin: '0 0 10px' }),
      list(alert.open.map((b) => `${escape(holdLine(b))}<br/>${link(adminUrl(b.id), 'Open in admin')}`)),
      para(escape(once), { soft: true, small: true, margin: '0' }),
    ].join('\n'),
  });

  return { subject, html, text };
}

/**
 * Emails Travis about a visitor who was turned away, at most once a day per
 * visitor: the idempotency key is the visitor's hash and the marina date.
 * Resend keeps a key for 24 hours, and answers a second send with the same
 * key but a different email (another attempt later that day) with
 * `invalid_idempotent_request`, or `concurrent_idempotent_requests` while
 * the first is still going: either way the alert has gone, or is going.
 */
export async function sendCheckoutLimitAlert(
  alert: CheckoutLimitAlert,
  deps: EmailDeps & { baseUrl?: string; adminEmail?: string; now?: Date } = {},
): Promise<void> {
  const { subject, html, text } = buildCheckoutLimitAlertEmail(alert, deps.baseUrl ?? APP_BASE_URL.value());
  try {
    await sendEmail(
      {
        kind: 'admin',
        to: deps.adminEmail ?? ADMIN_EMAIL.value(),
        subject,
        html,
        text,
        idempotencyKey: `checkout-limit/${alert.ipHash}/${marinaNow(deps.now).date}`,
      },
      deps,
    );
  } catch (err) {
    if (
      isEmailSendError(err, 'invalid_idempotent_request') ||
      isEmailSendError(err, 'concurrent_idempotent_requests')
    ) {
      return;
    }
    throw err;
  }
}
