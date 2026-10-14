import { notFound, redirect } from 'next/navigation';
import { getTourBySlug } from '@/lib/tours';

interface PageProps {
  params: Promise<{ date: string }>;
}

/**
 * Older URLs, all folded into the single /book page:
 *  - /book/2026-12-20     (the old date step)
 *  - /book/morning-shared (tour links that used to 404)
 */
export default async function LegacyDatePage({ params }: PageProps) {
  const { date } = await params;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect(`/book?date=${date}`);
  const tour = getTourBySlug(date);
  if (tour) redirect(`/book?tour=${tour.slug}`);
  notFound();
}
