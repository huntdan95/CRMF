import type { ReactNode } from 'react';
import { AdminSidebar } from './AdminSidebar';
import { AdminSignInCheck } from './AdminSignInCheck';
import type { AdminUser } from '@/lib/firebase/auth-server';

interface Props {
  user: AdminUser;
  children: ReactNode;
}

export function AdminShell({ user, children }: Props) {
  return (
    // accent-color is inherited: every checkbox and radio in admin is spring green, not browser blue.
    <div className="min-h-screen flex flex-col lg:flex-row bg-[var(--color-canvas)] accent-[var(--color-spring)]">
      <AdminSignInCheck />
      <AdminSidebar user={user} />
      <main className="flex-1 min-w-0 px-4 sm:px-8 py-8 lg:py-10">
        {children}
      </main>
    </div>
  );
}
