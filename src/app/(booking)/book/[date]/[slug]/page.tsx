import { notFound, redirect } from 'next/navigation';
import { getTourBySlug } from '@/lib/tours';

interface PageProps {
  params: Promise<{ date: string; slug: string }>;
  searchParams: Promise<{ cancelled?: string }>;
}

/**
 * The old details step, and still Stripe Checkout's `cancel_url`
 * (functions/src/createCheckoutSession.ts). Sends people back to the
 * details step of /book with their tour and date filled in; the form
 * restores what they typed from sessionStorage.
 */
export default async function LegacyDetailsPage({ params, searchParams }: PageProps) {
  const { date, slug } = await params;
  const { cancelled } = await searchParams;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !getTourBySlug(slug)) notFound();
  const qs = new URLSearchParams({ date, tour: slug, step: 'details' });
  if (cancelled === '1') qs.set('cancelled', '1');
  redirect(`/book?${qs.toString()}`);
}
