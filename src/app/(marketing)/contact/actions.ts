'use server';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  email: z.string().trim().email('Please enter a valid email').max(254),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  subject: z.string().trim().max(120).optional().or(z.literal('')),
  message: z
    .string()
    .trim()
    .min(10, 'Tell us a little more — at least 10 characters')
    .max(4000),
});

const HOUR_MS = 60 * 60_000;

/**
 * Counted in fixed one-hour windows in Firestore (`rateLimits`,
 * server-only). Each message is emailed to Travis, so a bot that gets past
 * the honeypot could otherwise flood his inbox and use up the email quota.
 *  - One address sending more than this an hour is turned away (shown the
 *    phone number). Real people never get near it.
 *  - Past the site-wide number, messages are still saved to the admin
 *    inbox but not emailed. Refusing them instead would let anyone with a
 *    script lock real customers out of the form every hour.
 *  - Past a much higher number they're refused after all, so a flood can't
 *    push real messages out of the admin inbox (it lists the newest 200).
 */
const PER_SENDER_PER_HOUR = 3;
const EMAILED_PER_HOUR = 30;
const SAVED_PER_HOUR = 150;

type ContactLimit = 'ok' | 'sender' | 'site' | 'flood';

/** Counts this message against both limits and says which, if any, it's over. */
async function checkContactLimits(email: string): Promise<ContactLimit> {
  const db = adminDb();
  const window = Math.floor(Date.now() / HOUR_MS);
  const expiresAt = Timestamp.fromMillis((window + 2) * HOUR_MS); // for a TTL policy, if set up
  // Hashed, so the doc id isn't an email address.
  const senderHash = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32);
  const senderRef = db.collection('rateLimits').doc(`contact-email-${senderHash}-${window}`);
  const siteRef = db.collection('rateLimits').doc(`contact-site-${window}`);
  return db.runTransaction(async (tx) => {
    const [sender, site] = await Promise.all([tx.get(senderRef), tx.get(siteRef)]);
    const senderCount = (sender.data()?.count as number | undefined) ?? 0;
    const siteCount = (site.data()?.count as number | undefined) ?? 0;
    if (senderCount >= PER_SENDER_PER_HOUR) return 'sender';
    if (siteCount >= SAVED_PER_HOUR) return 'flood';
    tx.set(senderRef, { count: senderCount + 1, expiresAt });
    tx.set(siteRef, { count: siteCount + 1, expiresAt });
    return siteCount >= EMAILED_PER_HOUR ? 'site' : 'ok';
  });
}

export interface ContactFormState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Partial<Record<keyof z.infer<typeof contactSchema>, string>>;
  /** What was submitted, so the form can refill itself after an error
   *  (React resets uncontrolled forms after every action). */
  values?: Partial<Record<'name' | 'email' | 'phone' | 'subject' | 'message', string>>;
}

export async function submitContactForm(
  _prev: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  // Honeypot: bots fill hidden fields, humans don't. Checked before
  // validation and answered like a real send, so bots can't tell.
  if (String(formData.get('_hp') ?? '') !== '') {
    return { status: 'success', message: "Thanks — we'll be in touch." };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = contactSchema.safeParse(raw);
  const values = {
    name: String(raw.name ?? ''),
    email: String(raw.email ?? ''),
    phone: String(raw.phone ?? ''),
    subject: String(raw.subject ?? ''),
    message: String(raw.message ?? ''),
  };

  if (!parsed.success) {
    const fieldErrors: ContactFormState['fieldErrors'] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof z.infer<typeof contactSchema>;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      status: 'error',
      message: 'Please fix the highlighted fields and try again.',
      fieldErrors,
      values,
    };
  }

  try {
    const limit = await checkContactLimits(parsed.data.email);
    if (limit === 'sender' || limit === 'flood') {
      return {
        status: 'error',
        message:
          limit === 'sender'
            ? "We've had a few messages from you in the last hour. Please call or text us at 352-586-7792 instead."
            : "We've had a lot of messages in the last hour. Please call or text us at 352-586-7792 instead.",
        values,
      };
    }
    await adminDb()
      .collection('contactMessages')
      .add({
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone || null,
        subject: parsed.data.subject || null,
        message: parsed.data.message,
        status: 'new',
        // Over the hourly email limit: saved for the admin inbox, not emailed
        // (functions/src/onContactMessage.ts checks this).
        ...(limit === 'site' && { notify: false }),
        createdAt: FieldValue.serverTimestamp(),
      });
    return {
      status: 'success',
      message:
        "Thanks — we got it. Travis will get back to you within a day (often within an hour).",
    };
  } catch (err) {
    // TODO (Phase 4/7): Cloud Function trigger on `contactMessages` writes
    // sends Travis an email via Resend. Until that's deployed, this path
    // surfaces the failure if Firebase env vars aren't configured locally.
    console.error('Contact form Firestore write failed:', err);
    return {
      status: 'error',
      message:
        "We couldn't send your message right now. Please call us at 352-586-7792 — we'd rather hear from you than miss you.",
      values,
    };
  }
}
