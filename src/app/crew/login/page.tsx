import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCrewMember } from '@/lib/crew-server';
import { Logo } from '@/components/marketing/Logo';
import { InstallHint } from '@/components/crew/InstallHint';
import { CrewLoginForm } from './CrewLoginForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default async function CrewLoginPage() {
  if (await getCrewMember()) redirect('/crew');

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-[var(--color-spring-deep)] px-4 pt-[calc(env(safe-area-inset-top)+2rem)] pb-[calc(env(safe-area-inset-bottom)+2rem)]">
      <Logo tone="light" />
      <div className="w-full max-w-sm space-y-4">
        <InstallHint tone="dark" />
        <div className="bg-white rounded-2xl shadow-[var(--shadow-lift)] p-7">
          <h1 className="text-2xl font-bold mb-1">Crew sign-in</h1>
          <p className="text-sm text-[var(--color-ink-soft)] mb-6">
            For Travis’s swim guides and mates. Use the email and password
            Travis sent you.
          </p>
          <CrewLoginForm />
        </div>
      </div>
    </div>
  );
}
