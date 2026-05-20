import type { Metadata } from 'next';
import { MessagesAdmin } from '@/components/admin/MessagesAdmin';

export const metadata: Metadata = {
  title: 'Messages — Admin',
  robots: { index: false, follow: false },
};

export default function MessagesPage() {
  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="font-display text-3xl sm:text-4xl leading-tight">Messages</h1>
        <p className="text-[var(--color-ink-soft)] mt-1 text-sm">
          Submissions from the contact form. Every new one also emails you
          directly — this page lets you mark them as replied or archived
          so the inbox stays manageable.
        </p>
      </header>
      <MessagesAdmin />
    </div>
  );
}
