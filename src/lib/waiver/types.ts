import type { Timestamp } from 'firebase-admin/firestore';
import type { TourTimeSlot } from '../firebase/types';

/**
 * `waivers/{id}` — one signed waiver: one adult, plus any minors they
 * signed for. Written once by the Next app's signing route and never
 * changed afterwards, except the email bookkeeping the onWaiverSigned
 * Cloud Function adds (`emailedAt`, `emailClaimedAt`, `emailMessageId`),
 * which `recordSha256` doesn't cover. Admin reads it; nobody else can
 * (firestore.rules).
 *
 * The signed PDF and the signature image live in Cloud Storage at
 * `pdfPath` / `signaturePath`, which no client can read (storage.rules).
 * Keep these records: the deadline to sue a minor's injury can run years
 * past the trip.
 */
export interface SignedWaiver {
  id: string;
  bookingId: string;
  /** `YYYY-MM-DD_<timeSlot>`: the boat departure, as trip photos use. */
  tripId: string;
  tripDate: string;
  timeSlot: TourTimeSlot;
  tourId: string;
  tourName: string;

  /** Agreement version shown (src/lib/waiver/agreement.ts). */
  version: string;
  includesMinorAddendum: boolean;
  /** SHA-256 of `waiverPlainText()` for the exact document signed. */
  documentSha256: string;

  signer: {
    name: string;
    /** `YYYY-MM-DD`. */
    dob: string;
    email: string;
    phone: string;
    address: string;
    /** False when a parent signs only for their children. */
    participating: boolean;
    /** The booking-roster name they picked, if any. */
    rosterName: string | null;
  };
  minors: Array<{
    name: string;
    dob: string;
    ageOnTripDate: number;
    rosterName: string | null;
  }>;
  /** Who'll supervise the minors on the boat when the signer isn't going. */
  accompanyingAdult: string | null;
  /** Signer confirmed they're each minor's parent or legal guardian. */
  guardianAttested: boolean;

  /** One per initialed section, in the order they were initialed. */
  initials: Array<{ section: string; initials: string; at: string }>;
  consentElectronic: true;

  signatureSha256: string;
  /** Drawn with a finger/mouse, or typed and rendered as an image. */
  signatureMethod: 'drawn' | 'typed';
  signaturePath: string;
  pdfPath: string;
  pdfSha256: string;
  /**
   * SHA-256 over the record's signed content (document hash, people,
   * initials, signature hash, times, IP, device). Lets a later reader
   * check nothing in the record changed.
   */
  recordSha256: string;

  signedAt: Timestamp;
  /** The signer's device clock, ISO-8601. */
  clientSignedAt: string;
  clientTimeZone: string | null;
  ip: string | null;
  userAgent: string | null;

  /** SHA-256 of the private token in the signer's "download your copy" link. */
  copyTokenSha256: string;
  emailedAt?: Timestamp | null;
}
