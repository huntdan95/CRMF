import type { Metadata } from 'next';
import { AdminCalendar } from '@/components/admin/AdminCalendar';

export const metadata: Metadata = {
  title: 'Calendar — Admin',
  robots: { index: false, follow: false },
};

export default function AdminCalendarPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl leading-tight">
            Calendar
          </h1>
          <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
            Click a booking to open it. Blackouts show as grey day backgrounds.
          </p>
        </div>
      </header>
      <AdminCalendar />
    </div>
  );
}
