import { siteConfig } from '@/lib/site-config';

export const runtime = 'nodejs';

/**
 * Downloadable vCard for Capt. Travis. Linked from the booking
 * confirmation page so customers can save his number in one tap.
 */
export async function GET(): Promise<Response> {
  const phoneDigits = siteConfig.contact.phone.replace(/[^0-9]/g, '');
  const vcf = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${siteConfig.captain.fullName}`,
    `N:Urbin;Travis;;;`,
    `ORG:${siteConfig.name}`,
    'TITLE:USCG-licensed Captain',
    `TEL;TYPE=CELL,VOICE:+1${phoneDigits}`,
    `URL:${siteConfig.url}`,
    `ADR;TYPE=WORK:;;${siteConfig.marina.streetAddress};${siteConfig.marina.city};${siteConfig.marina.region};${siteConfig.marina.postalCode};${siteConfig.marina.country}`,
    `NOTE:Tour captain — Crystal River Manatee Fun`,
    'END:VCARD',
  ].join('\r\n');

  return new Response(vcf, {
    status: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': 'attachment; filename="capt-travis.vcf"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
