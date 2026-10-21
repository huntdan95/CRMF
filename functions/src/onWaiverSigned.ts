import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { getStorage } from 'firebase-admin/storage';

import { db, FieldValue, type Timestamp } from './lib/firebase';
import { ADMIN_EMAIL } from './lib/config';
import { sendEmail } from './lib/email-log';
import { buildWaiverCopyEmail } from './lib/email-templates';
import { RESEND_API_KEY, RESEND_FROM_EMAIL } from './lib/resend';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';

/** How long a send in flight holds the waiver; older claims are from a crash. */
const CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * Failed sends are retried for this long after the signing. Resend
 * remembers an idempotency key for 24 hours, so within this a retry after
 * a send that went (but wasn't marked) can't email the copy twice.
 */
const RETRY_FOR_MS = 12 * 60 * 60 * 1000;

/** The fields of `waivers/{id}` this needs; see src/lib/waiver/types.ts. */
interface SignedWaiverDoc {
  bookingId: string;
  tourName: string;
  tripDate: string;
  pdfPath: string;
  signer: { name: string; email: string; participating: boolean };
  minors: Array<{ name: string }>;
  emailedAt?: unknown;
  emailClaimedAt?: Timestamp | null;
}

/**
 * Firestore trigger: emails each signer their signed waiver PDF. The Next
 * app's signing route writes the waiver doc and the PDF; this attaches
 * the stored PDF, so the copy the guest gets is byte-for-byte the record.
 */
export const onWaiverSigned = onDocumentCreated(
  {
    document: 'waivers/{waiverId}',
    region: 'us-central1',
    secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL],
    retry: true,
    maxInstances: 5,
  },
  async (event) => {
    const waiverId = event.params.waiverId;
    if (Date.now() - Date.parse(event.time) > RETRY_FOR_MS) {
      logger.error('Gave up emailing waiver copy', { waiverId });
      return;
    }
    const ref = db.collection('waivers').doc(waiverId);

    // Triggers can fire more than once; claim the send so a guest gets one email.
    const waiver = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() as SignedWaiverDoc | undefined;
      if (!data || data.emailedAt) return null;
      // Another run is sending it: fail, so this is retried and finds it
      // sent. A claim older than the TTL is from a run that died.
      const claimedAt = data.emailClaimedAt?.toMillis();
      if (claimedAt && Date.now() - claimedAt < CLAIM_TTL_MS) {
        throw new Error(`Waiver copy ${waiverId} is already being sent`);
      }
      tx.update(ref, { emailClaimedAt: FieldValue.serverTimestamp() });
      return data;
    });
    if (!waiver) return;

    try {
      const [pdf] = await getStorage().bucket().file(waiver.pdfPath).download();
      const { subject, html, text } = buildWaiverCopyEmail({
        signerName: waiver.signer.name,
        tourName: waiver.tourName,
        tripDate: waiver.tripDate,
        minors: waiver.minors.map((m) => m.name),
        participating: waiver.signer.participating,
        phoneDisplay: PHONE_DISPLAY,
        marina: MARINA,
      });

      const { id } = await sendEmail({
        kind: 'waiverCopy',
        bookingId: waiver.bookingId,
        waiverId,
        to: waiver.signer.email,
        replyTo: ADMIN_EMAIL.value(),
        subject,
        html,
        text,
        attachments: [{ filename: `signed-waiver-${waiver.tripDate}.pdf`, content: pdf }],
        headers: { 'X-Entity-Ref-ID': waiverId },
        // A retry of a send that went gets Resend's first answer back, not a second email.
        idempotencyKey: `waiver-copy/${waiverId}`,
      });

      await ref.update({
        emailedAt: FieldValue.serverTimestamp(),
        emailMessageId: id,
      });
      logger.info('Waiver copy emailed', { waiverId, messageId: id });
    } catch (err) {
      // Release the claim and fail, so the trigger's retry sends it.
      await ref.update({ emailClaimedAt: FieldValue.delete() }).catch(() => undefined);
      logger.error('Failed to email waiver copy', { waiverId, err });
      throw err;
    }
  },
);
