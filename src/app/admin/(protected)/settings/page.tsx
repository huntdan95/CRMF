import type { Metadata } from 'next';
import { SettingsAdmin } from '@/components/admin/SettingsAdmin';

export const metadata: Metadata = {
  title: 'Settings — Admin',
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-display text-[2rem] sm:text-[2.5rem]">Settings</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Site-wide text customers see. Email template editing lands in Phase 7.
        </p>
      </header>
      <SettingsAdmin />
    </div>
  );
}
