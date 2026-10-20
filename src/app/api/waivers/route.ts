import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { signWaiver } from '@/lib/waiver/server';

export const runtime = 'nodejs';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a full date');
const name = z.string().trim().min(2, 'Enter a full name').max(120);
/** Sent for a name the signed PDF can't print; checked in signWaiver. */
const latinName = z.string().max(120).nullish();

const bodySchema = z.object({
  bookingId: z.string().min(1).max(64),
  key: z.string().min(16).max(64),
  version: z.string().max(40),
  documentSha256: z.string().regex(/^[0-9a-f]{64}$/, 'Reload the page and try again'),
  signer: z.object({
    name,
    latinName,
    dob: isoDate,
    email: z.string().trim().email('Enter a valid email').max(200),
    phone: z.string().trim().min(7, 'Enter a phone number').max(40),
    address: z.string().trim().min(5, 'Enter your home address').max(300),
    participating: z.boolean(),
    rosterName: z.string().max(120).nullable(),
  }),
  minors: z
    .array(
      z.object({
        name,
        latinName,
        dob: isoDate,
        rosterName: z.string().max(120).nullable(),
        relationship: z.enum(['parent', 'legal-guardian'], {
          error: 'Say whether you’re the child’s parent or legal guardian',
        }),
      }),
    )
    .max(12),
  accompanyingAdult: z.string().max(120).nullable(),
  guardianAttested: z.boolean(),
  initials: z
    .array(
      z.object({
        section: z.string().max(40),
        initials: z.string().trim().regex(/^\p{L}{1,4}$/u, 'Initials are 1 to 4 letters'),
        at: z.string().max(40),
      }),
    )
    .max(20),
  consentElectronic: z.literal(true, {
    error: 'Agree to sign electronically to continue',
  }),
  signaturePng: z.string().max(450_000),
  signatureMethod: z.enum(['drawn', 'typed']),
  clientSignedAt: z.string().max(40),
  clientTimeZone: z.string().max(64).nullable(),
});

/**
 * The address chain the request came through, as recorded on the waiver.
 * The whole X-Forwarded-For chain, not its first entry: a client can send
 * that header itself, and its value then comes first, while Google's front
 * end appends the address it actually saw. Keeping the chain means the
 * record always includes the real one. Admin's "signed on the same phone"
 * check picks the visitor's out of it (visitorIp in src/lib/forwarded-for.ts).
 */
function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    // The last few hops: Google's entries are at the end, and an
    // oversized forged prefix mustn't push them out.
    const chain = forwarded
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(-5)
      .join(', ');
    return chain.slice(-200) || null;
  }
  return req.headers.get('x-real-ip');
}

/**
 * POST /api/waivers — a guest signs the liability waiver for a booking.
 * Gated by the signing link's key; see src/lib/waiver/server.ts.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? 'Invalid request', field: issue?.path.join('.') },
      { status: 400 },
    );
  }

  try {
    const result = await signWaiver(parsed.data, {
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          field: result.field,
          code: result.code,
          latinNamesNeeded: result.latinNamesNeeded,
        },
        { status: result.status },
      );
    }
    return NextResponse.json({
      waiverId: result.waiverId,
      copyUrl: `/waiver/${parsed.data.bookingId}/copy/${result.waiverId}?c=${result.copyToken}`,
    });
  } catch (err) {
    console.error('Waiver signing failed:', err);
    return NextResponse.json(
      { error: 'Something went wrong saving your waiver. Nothing was signed; please try again.' },
      { status: 500 },
    );
  }
}
