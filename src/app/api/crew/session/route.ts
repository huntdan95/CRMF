import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  CREW_SESSION_COOKIE,
  CREW_SESSION_MAX_AGE_S,
  endCrewSession,
  signInCrew,
} from '@/lib/crew-server';

export const runtime = 'nodejs';

/**
 * POST /api/crew/session
 *
 * Body: { email: string, password: string }
 *
 * Checks a crew member's password (see signInCrew) and sets the httpOnly
 * crew session cookie.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = z
    .object({
      email: z.string().trim().max(160),
      password: z.string().max(128),
    })
    .safeParse(body);
  if (!parsed.success || !parsed.data.email || !parsed.data.password) {
    return NextResponse.json(
      { error: 'Enter your email and password.' },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await signInCrew(
      parsed.data.email,
      parsed.data.password,
      req.headers.get('user-agent'),
    );
  } catch (err) {
    console.error('Crew sign-in failed:', err);
    return NextResponse.json(
      { error: 'Sign-in isn’t working right now. Try again in a minute.' },
      { status: 500 },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(CREW_SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: CREW_SESSION_MAX_AGE_S,
    path: '/',
  });
  return res;
}

/**
 * DELETE /api/crew/session
 *
 * Signs this device out: deletes the session server-side and clears the
 * cookie.
 */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(CREW_SESSION_COOKIE)?.value;
  if (token) {
    await endCrewSession(token).catch((err) =>
      console.error('Failed to delete crew session:', err),
    );
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CREW_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return res;
}
