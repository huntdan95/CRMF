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
 * How many messages the form takes, counted in fixed one-hour windows in
 * Firestore (`rateLimits`, server-only). Each message is emailed to Travis,
 * so a bot that gets past the honeypot could otherwise flood his inbox and
 * use up the email quota. Real people never get near these; anyone who does
 * is shown the phone number.
 */
const CONTACT_LIMITS = [
  // Per sender address (hashed, so the doc id isn't an email address).
  { id: (email: string) => `contact-email-${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32)}`, max: 3 },
  // The whole site.
  { id: () => 'contact-site', max: 30 },
];

/** Counts this message; true if a limit was already reached. */
async function overContactLimit(email: string): Promise<boolean> {
  const db = adminDb();
  const window = Math.floor(Date.now() / HOUR_MS);
  const refs = CONTACT_LIMITS.map((l) =>
    db.collection('rateLimits').doc(`${l.id(email)}-${window}`),
  );
  return db.runTransaction(async (tx) => {
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const counts = snaps.map((s) => (s.data()?.count as number | undefined) ?? 0);
    if (counts.some((c, i) => c >= CONTACT_LIMITS[i]!.max)) return true;
    refs.forEach((r, i) =>
      tx.set(r, {
        count: counts[i]! + 1,
        // For a Firestore TTL policy on rateLimits.expiresAt, if one is set up.
        expiresAt: Timestamp.fromMillis((window + 2) * HOUR_MS),
      }),
    );
    return false;
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
    if (await overContactLimit(parsed.data.email)) {
      return {
        status: 'error',
        message:
          "We've had a lot of messages in the last hour. Please call or text us at 352-586-7792 instead.",
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
