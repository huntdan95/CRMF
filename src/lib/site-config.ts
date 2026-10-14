export const siteConfig = {
  name: 'Crystal River Manatee Fun',
  shortName: 'Crystal River Manatee Fun',
  url: 'https://crystalrivermanateefun.com',
  tagline: 'Guided manatee tours on the Crystal River',
  captain: {
    firstName: 'Travis',
    fullName: 'Capt. Travis Urbin',
    instagram: 'https://www.instagram.com/capt.travisurbin/',
    // The Crystal River Manatee Fun business page (confirmed by the owner,
    // 2026-10-13). Not facebook.com/urbin1, which the old site linked.
    facebook: 'https://www.facebook.com/p/Crystal-River-Manatee-Fun-61554023464570/',
  },
  // TODO(owner): the Google Business Profile's public URL (Maps → Share →
  // copy link). Used in the LocalBusiness structured data's `sameAs`.
  googleBusinessProfile: null as string | null,
  contact: {
    phone: '352-586-7792',
    phoneHref: 'tel:+13525867792',
    // TODO(owner): confirm the public-facing inbox. Until it's set, read it
    // through publicContactEmail() so the placeholder is never shown.
    email: 'TODO_OWNER_EMAIL@crystalrivermanateefun.com',
  },
  marina: {
    name: "Pete's Pier Marina",
    streetAddress: '1 SW First Place',
    city: 'Crystal River',
    region: 'FL',
    postalCode: '34429',
    country: 'US',
    // Approximate marina coordinates — used for the LocalBusiness JSON-LD
    // schema and a future static map.
    // TODO(owner): replace with the exact pin from the Google Business
    // Profile so the structured data and the profile agree.
    latitude: 28.8966,
    longitude: -82.5915,
    // Direct Google Maps link for the "directions" button.
    mapUrl: 'https://maps.google.com/?q=Pete%27s+Pier+Marina+Crystal+River+FL',
  },
  legal: {
    // The LLC's registered name: the party to the terms and the waiver.
    businessName: 'Crystal River Manatee Fun LLC',
    licensee: 'Travis Urbin',
  },
} as const;

export type SiteConfig = typeof siteConfig;

/**
 * The public contact email, or null while `contact.email` is still the
 * placeholder. Use this anywhere the email is displayed or published.
 */
export function publicContactEmail(): string | null {
  const { email } = siteConfig.contact;
  return email.startsWith('TODO') ? null : email;
}
