import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Admin, sign-in page included. Its own manifest, so adding any admin page
 * to the home screen installs an app that opens on the dashboard and can
 * get push notifications (src/components/admin/AdminNotifications.tsx).
 */
export const metadata: Metadata = {
  manifest: '/admin.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Manatee Admin',
    statusBarStyle: 'default',
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
