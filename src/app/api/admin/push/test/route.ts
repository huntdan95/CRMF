import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getAdminUser } from '@/lib/firebase/auth-server';

export const runtime = 'nodejs';

/**
 * POST /api/admin/push/test
 *
 * Queues a test notification to the signed-in admin's devices. The
 * `sendAdminTestPush` Cloud Function picks up the doc and sends it — the
 * VAPID private key only lives there.
 */
export async function POST() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  await adminDb().collection('adminPushTests').add({
    email: admin.email.toLowerCase(),
    createdAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ ok: true });
}
