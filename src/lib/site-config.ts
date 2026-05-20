export const siteConfig = {
  name: 'Crystal River Manatee Fun',
  shortName: 'Crystal River Manatee Fun',
  url: 'https://crystalrivermanateefun.com',
  tagline: 'Guided manatee tours on the Crystal River',
  captain: {
    firstName: 'Travis',
    fullName: 'Capt. Travis Urbin',
    instagram: 'https://www.instagram.com/capt.travisurbin/',
    facebook: 'https://www.facebook.com/profile.php?id=61554023464570',
  },
  contact: {
    phone: '352-586-7792',
    phoneHref: 'tel:+13525867792',
    // TODO: confirm the public-facing inbox with the owner.
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
    latitude: 28.8966,
    longitude: -82.5915,
    // Direct Google Maps link for the "directions" button.
    mapUrl: 'https://maps.google.com/?q=Pete%27s+Pier+Marina+Crystal+River+FL',
  },
  legal: {
    businessName: 'Crystal River Manatee Fun',
    licensee: 'Travis Urbin',
  },
} as const;

export type SiteConfig = typeof siteConfig;
