/**
 * What the close-a-day endpoints send back. Mirrors ClosurePreview,
 * ClosureResult and ClosureAction in functions/src/lib/close-day.ts and
 * functions/src/lib/types.ts; keep them in step.
 */
import type { TourTimeSlot } from './firebase/types';

/** `offer`: email them to pick a new date or a refund. `cancel`: cancel and refund. `keep`: leave them booked. */
export type ClosureChoice = 'offer' | 'cancel' | 'keep';

export type BookingOutcome =
  | { kind: 'offer'; decideBy: string }
  | { kind: 'cancel'; refundCents: number; manualRefundCents: number; unpaidCheckout: boolean }
  | { kind: 'keep' };

export interface ClosurePreview {
  date: string;
  affectedSlots: Array<TourTimeSlot | 'all'>;
  reason: 'weather' | 'maintenance' | 'personal' | 'other' | null;
  customerReason: string;
  undoMinutes: number;
  decideBy: string;
  farAhead: boolean;
  departures: Array<{ slot: TourTimeSlot; departs: string; bookings: number; guests: number }>;
  bookings: Array<{
    id: string;
    customerName: string;
    timeSlot: TourTimeSlot;
    departs: string;
    tourName: string;
    guestCount: number;
    status: string;
    owedCents: number;
    legacy: boolean;
    hasEmail: boolean;
    alreadyOffered: boolean;
    outcomes: Record<ClosureChoice, BookingOutcome>;
  }>;
  guests: number;
  choices: Partial<Record<ClosureChoice, { confirmToken: string; emails: Array<{ bookingId: string; to: string; subject: string; html: string }> }>>;
  expiresAt: string;
}

export interface ClosureResult {
  cancelled: Array<{
    id: string;
    customerName: string;
    timeSlot: TourTimeSlot;
    guests: number;
    refundCents: number;
    manualRefundCents: number;
    emailed: boolean;
    unpaidCheckout?: boolean;
    /** Found cancelled after a run that died partway: whether they were emailed isn't known. */
    recovered?: boolean;
  }>;
  offered: Array<{ id: string; customerName: string; timeSlot: TourTimeSlot; guests: number; decideBy: string; emailed: boolean }>;
  kept?: Array<{ id: string; customerName: string; timeSlot: TourTimeSlot; guests: number }>;
  /** `refundedAnyway`: refunded as it was moved or cancelled another way; `error` says what to check. */
  failed: Array<{ id: string; customerName: string; error: string; retryable?: boolean; refundedAnyway?: boolean }>;
}

type FsTime = { seconds: number; nanoseconds: number };

/** `closureActions/{blackoutId}`, as admin pages read it. */
export interface ClosureActionDoc {
  id: string;
  blackoutId: string;
  date: string;
  affectedSlots: string[];
  reason: string | null;
  choice: ClosureChoice;
  state: 'pending' | 'finalizing' | 'done' | 'undone';
  createdBy: string;
  createdAt: FsTime;
  undoMinutes: number;
  finalizeAt: FsTime;
  decideBy: string;
  /** `unknown`: bookings with no party size on file, not in `guests` (none on older closures). */
  summary: { bookings: number; guests: number; unknown?: number; departs: string[] };
  retryAt?: FsTime | null;
  finalizedAt?: FsTime | null;
  result?: ClosureResult;
  /** When Travis reopened the day, if this version of the site did it (functions/src/lib/types.ts). */
  reopenedAt?: FsTime | null;
  /** Undone while another closed day still covered all or some of its trips: those stayed closed. */
  stillClosed?: 'all' | 'some';
}
