import 'server-only';
import { adminDb } from './firebase/admin';
import type { Testimonial } from './firebase/types';

/**
 * Reads all PUBLISHED testimonials from Firestore, sorted by `order` asc
 * (tie-broken by `reviewedAt` desc so newer reviews surface first when
 * orders match).
 *
 * Returns an empty array on any failure (Firestore unreachable, admin
 * SDK unavailable, etc.) so the home page never blows up over a missing
 * review.
 */
export async function fetchPublishedTestimonials(): Promise<Testimonial[]> {
  try {
    const snap = await adminDb().collection('testimonials').get();
    const all = snap.docs.map((d) => d.data() as Testimonial);
    return all
      .filter((t) => t.published)
      .sort((a, b) => {
        const diff = (a.order ?? 100) - (b.order ?? 100);
        if (diff !== 0) return diff;
        const ad = a.reviewedAt ?? '';
        const bd = b.reviewedAt ?? '';
        return bd.localeCompare(ad);
      });
  } catch {
    return [];
  }
}

export async function fetchFeaturedTestimonial(): Promise<Testimonial | null> {
  const all = await fetchPublishedTestimonials();
  return all.find((t) => t.featured) ?? all[0] ?? null;
}
