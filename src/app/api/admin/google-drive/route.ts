import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/firebase/auth-server';
import { disconnectDrive, driveStatus } from '@/lib/google-drive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/google-drive — whether Travis's Drive is connected, for Settings. */
export async function GET() {
  if (!(await getAdminUser())) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  try {
    return NextResponse.json(await driveStatus());
  } catch (err) {
    console.error('Drive status failed:', err);
    return NextResponse.json({ error: 'Couldn’t check Google Drive.' }, { status: 500 });
  }
}

/** DELETE /api/admin/google-drive — stop copying photos to Drive. */
export async function DELETE() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  try {
    await disconnectDrive(admin.email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Drive disconnect failed:', err);
    return NextResponse.json({ error: 'Couldn’t disconnect. Try again.' }, { status: 500 });
  }
}
