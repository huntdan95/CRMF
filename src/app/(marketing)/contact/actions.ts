'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  email: z.string().trim().email('Please enter a valid email'),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  subject: z.string().trim().max(120).optional().or(z.literal('')),
  message: z
    .string()
    .trim()
    .min(10, 'Tell us a little more — at least 10 characters')
    .max(4000),
  // Honeypot: bots fill hidden fields, humans don't.
  _hp: z.string().max(0).optional(),
});

export interface ContactFormState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Partial<Record<keyof z.infer<typeof contactSchema>, string>>;
}

export async function submitContactForm(
  _prev: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = contactSchema.safeParse(raw);

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
    };
  }

  if (parsed.data._hp) {
    // Silently accept honeypot submissions so bots can't probe responses.
    return { status: 'success', message: "Thanks — we'll be in touch." };
  }

  try {
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
    };
  }
}
