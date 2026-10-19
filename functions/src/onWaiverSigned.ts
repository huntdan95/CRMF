import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { getStorage } from 'firebase-admin/storage';

import { db, FieldValue } from './lib/firebase';
import { ADMIN_EMAIL } from './lib/config';
import { buildWaiverCopyEmail } from './lib/email-templates';
import {
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  getFromAddress,
  getResend,
} from './lib/resend';

const MARINA = {
  name: "Pete's Pier Marina",
  address: '1 SW First Place, Crystal River, FL 34429',
};
const PHONE_DISPLAY = '352-586-7792';

/** The fields of `waivers/{id}` this needs; see src/lib/waiver/types.ts. */
interface SignedWaiverDoc {
  tourName: string;
  tripDate: string;
  pdfPath: string;
  signer: { name: string; email: string; participating: boolean };
  minors: Array<{ name: string }>;
  emailedAt?: unknown;
  emailClaimedAt?: unknown;
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
    retry: false,
    maxInstances: 5,
  },
  async (event) => {
    const waiverId = event.params.waiverId;
    const ref = db.collection('waivers').doc(waiverId);

    // Triggers can fire more than once; claim the send so a guest gets one email.
    const waiver = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() as SignedWaiverDoc | undefined;
      if (!data || data.emailedAt || data.emailClaimedAt) return null;
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

      const { data, error } = await getResend().emails.send({
        from: getFromAddress(),
        to: [waiver.signer.email],
        replyTo: ADMIN_EMAIL.value(),
        subject,
        html,
        text,
        attachments: [{ filename: `signed-waiver-${waiver.tripDate}.pdf`, content: pdf }],
        headers: { 'X-Entity-Ref-ID': waiverId },
      });
      if (error) throw new Error(error.message ?? 'Resend error');

      await ref.update({
        emailedAt: FieldValue.serverTimestamp(),
        emailMessageId: data?.id ?? null,
      });
      logger.info('Waiver copy emailed', { waiverId, messageId: data?.id });
    } catch (err) {
      // Release the claim so an admin re-send (or a retry) can try again.
      await ref.update({ emailClaimedAt: FieldValue.delete() }).catch(() => undefined);
      logger.error('Failed to email waiver copy', { waiverId, err });
    }
  },
);
