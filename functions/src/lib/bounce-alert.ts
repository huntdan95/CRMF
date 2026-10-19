import { ADMIN_EMAIL, APP_BASE_URL } from './config';
import { COLORS, actions, button, card, details, emailPage, escape, heading, link, notice, para } from './email-layout';
import { emailKindLabel, isEmailSendError, sendEmail, type EmailDeps } from './email-log';
import type { BounceAlert } from './email-events';
import { departureClock, tripDayLabel } from './datetime';
import { SLOT_START_TIMES } from './schedule';
import type { Booking } from './types';

/**
 * "Sat Oct 17, 10:30 shared": the trip, as a subject line names it. Marina
 * time: the booking's date and departure are already the marina's.
 */
export function tripLabel(b: Pick<Booking, 'date' | 'timeSlot' | 'type'>): string {
  const start = SLOT_START_TIMES[b.timeSlot];
  const when = [start ? departureClock(start) : b.timeSlot, b.type].filter(Boolean).join(' ');
  return `${tripDayLabel(b.date)}, ${when}`;
}

/** `tel:` link for a phone number as the customer typed it. */
export function phoneHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return `tel:${digits}`;
  const bare = digits.replace(/\D/g, '');
  if (bare.length === 10) return `tel:+1${bare}`;
  if (bare.length === 11 && bare.startsWith('1')) return `tel:+${bare}`;
  return `tel:${bare}`;
}

/**
 * The email to Travis about a customer who may not have gotten an email:
 * which one, the address that failed, a tap-to-call link and the booking in
 * admin.
 */
export function buildBounceAlertEmail(alert: BounceAlert, baseUrl: string) {
  const b = alert.booking;
  const name = b.customerName || 'the customer';
  const trip = tripLabel(b);
  const which = emailKindLabel(alert.kind);
  const adminUrl = `${baseUrl.replace(/\/$/, '')}/admin/bookings/${encodeURIComponent(b.id)}`;
  const tel = b.customerPhone ? phoneHref(b.customerPhone) : null;

  const subject =
    alert.reason === 'delayed'
      ? `[CRMF] Email delayed: call ${name} (${trip})`
      : `[CRMF] Email bounced: call ${name} (${trip})`;

  const lead =
    alert.reason === 'permanent'
      ? `${name}’s ${which} bounced. The address doesn’t work, so they won’t get any more emails from the site until it’s fixed.`
      : alert.reason === 'temporary'
        ? `${name}’s ${which} bounced. Their mail server turned it away for now (a full inbox, say), and their trip is within two days.`
        : `${name}’s ${which} hasn’t been delivered yet, and their trip is within a day. Resend is still trying.`;
  const next =
    alert.reason === 'delayed'
      ? 'Give them a call to make sure they have the details.'
      : 'Give them a call. If they give you a better address, open the booking and tap “Fix email and resend”.';
  const reasonLine = [alert.bounceType, alert.bounceMessage].filter(Boolean).join(': ');

  const text = [
    lead,
    '',
    next,
    '',
    `Email:     ${which} (“${alert.subject}”)`,
    `Address:   ${alert.address}`,
    reasonLine ? `Reason:    ${reasonLine}` : '',
    `Phone:     ${b.customerPhone || 'not given'}${tel ? ` (${tel})` : ''}`,
    `Trip:      ${trip} · ${b.tourName}`,
    '',
    `Open the booking: ${adminUrl}`,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const html = emailPage({
    title: subject,
    preheader: `${name}: ${alert.address}`,
    body: [
      heading(alert.reason === 'delayed' ? 'Email delayed' : 'Email bounced'),
      para(escape(lead), { large: true }),
      notice(
        `${para(escape(next), { margin: '0' })}${
          tel
            ? actions(button(tel, `Call ${name}: ${b.customerPhone}`))
            : para('No phone number on the booking.', { soft: true, margin: '12px 0 0' })
        }`,
      ),
      card(
        details([
          ['Email', `${escape(which)}<br/><span style="color:${COLORS.inkSoft};">“${escape(alert.subject)}”</span>`],
          ['Address', escape(alert.address)],
          reasonLine ? ['Reason', escape(reasonLine)] : null,
          ['Phone', tel ? link(tel, b.customerPhone) : escape(b.customerPhone || 'Not given')],
          ['Trip', `${escape(trip)}<br/>${escape(b.tourName)}`],
        ]),
        { table: true },
      ),
      para(link(adminUrl, 'Open the booking in admin'), { margin: '0' }),
    ].join('\n'),
  });

  return { subject, html, text };
}

/**
 * Emails the alert to Travis. Logged as `admin`, so if it bounces too, the
 * webhook records it and stops there. The idempotency key is the failed
 * email's, so a webhook retry after a crash mid-send gets Resend's first
 * answer instead of sending again; a later bounce of a new email (after
 * Travis fixed the address) is a new key.
 */
export async function sendBounceAlert(alert: BounceAlert, deps: EmailDeps & { baseUrl?: string; adminEmail?: string } = {}) {
  const { subject, html, text } = buildBounceAlertEmail(alert, deps.baseUrl ?? APP_BASE_URL.value());
  try {
    await sendEmail(
      {
        kind: 'admin',
        bookingId: alert.booking.id,
        to: deps.adminEmail ?? ADMIN_EMAIL.value(),
        subject,
        html,
        text,
        headers: { 'X-Entity-Ref-ID': alert.booking.id },
        idempotencyKey: `bounce-alert/${alert.booking.id}/${alert.kind}/${alert.emailId}`,
      },
      deps,
    );
  } catch (err) {
    // Same key, different email (the booking was edited between tries):
    // the alert for this bounce already went out.
    if (isEmailSendError(err, 'invalid_idempotent_request')) return;
    throw err;
  }
}
