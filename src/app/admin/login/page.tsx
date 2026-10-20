import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';
import { Logo } from '@/components/marketing/Logo';

export const metadata: Metadata = {
  title: 'Admin sign-in',
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<{ next?: string; error?: string; reason?: string }>;
}

/** `?reason=device`: an admin page sent this device here (src/components/admin/AdminSignInCheck.tsx). */
const DEVICE_NOTICE = 'Sign in once more on this device. Admin pages can’t load or save until you do.';

/**
 * Where to go after signing in. Only admin pages on this site: anything
 * else (`https://…`, `//host`, `/\host`) would make the login page a
 * redirect to wherever a phishing link points.
 */
function safeNextPath(next: string | undefined): string {
  if (!next || !/^\/admin(?:[/?#]|$)/.test(next)) return '/admin';
  return next;
}

export default async function AdminLoginPage({ searchParams }: Props) {
  const { next: rawNext, error, reason } = await searchParams;
  const next = safeNextPath(rawNext);
  const notice = error ?? (reason === 'device' ? DEVICE_NOTICE : null);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-[var(--color-spring-deep)] px-4">
      <Logo tone="light" />
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-[var(--shadow-lift)] p-7">
        <h1 className="text-2xl font-bold mb-1">Admin sign-in</h1>
        <p className="text-sm text-[var(--color-ink-soft)] mb-6">
          Restricted to the captain. Sign in with the authorized Google
          account.
        </p>
        <LoginForm nextPath={next} initialError={notice} />
      </div>
    </div>
  );
}
