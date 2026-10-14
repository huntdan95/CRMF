import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getCrewMember } from '@/lib/crew-server';

export const runtime = 'nodejs';

/**
 * POST /api/crew/push/test
 *
 * Queues a test notification to the signed-in crew member's phones. The
 * `sendCrewTestPush` Cloud Function picks up the doc and sends it — the
 * VAPID private key only lives there.
 */
export async function POST() {
  const member = await getCrewMember();
  if (!member) {
    return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  }
  await adminDb().collection('crewPushTests').add({
    crewId: member.id,
    createdAt: FieldValue.serverTimestamp(),
  });
  return NextResponse.json({ ok: true });
}
