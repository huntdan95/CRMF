import type { ReactNode } from 'react';
import { AdminSidebar } from './AdminSidebar';
import type { AdminUser } from '@/lib/firebase/auth-server';

interface Props {
  user: AdminUser;
  children: ReactNode;
}

export function AdminShell({ user, children }: Props) {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--color-cream)]">
      <AdminSidebar user={user} />
      <main className="flex-1 min-w-0 px-4 sm:px-8 py-8 lg:py-10">
        {children}
      </main>
    </div>
  );
}
