import type { Metadata } from 'next';
import { BlackoutsAdmin, CLOSE_DAY_REASONS, type Reason } from '@/components/admin/BlackoutsAdmin';
import { AdminPageHeader } from '@/components/admin/ui';

export const metadata: Metadata = {
  title: 'Close a day — Admin',
  robots: { index: false, follow: false },
};

/**
 * `?date=2026-10-17&reason=weather` opens the form on that day with that
 * reason picked: the dashboard's Weather cancel buttons link here.
 */
export default async function BlackoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const date = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : undefined;
  const reason =
    typeof params.reason === 'string' && CLOSE_DAY_REASONS.includes(params.reason) ? (params.reason as Reason) : undefined;
  return (
    <div className="max-w-4xl mx-auto">
      <AdminPageHeader
        title="Close a day"
        description={
          <>
            Stop online bookings for a day or a departure, for weather, boat
            trouble or time off. You’ll see who’s booked and the exact email
            they’ll get before anything happens, and you can undo it for a few
            minutes after.
          </>
        }
      />
      {/* A new link (another date) starts the form over. */}
      <BlackoutsAdmin key={`${date ?? ''}|${reason ?? ''}`} initialDate={date} initialReason={reason} />
    </div>
  );
}
