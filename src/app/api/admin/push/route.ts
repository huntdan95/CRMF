import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getAdminUser } from '@/lib/firebase/auth-server';
import { isPushServiceEndpoint } from '@/lib/push-endpoint';

export const runtime = 'nodejs';

const subscriptionId = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

/**
 * POST /api/admin/push
 *
 * Body: a PushSubscription's toJSON(). Saves (or refreshes) this device's
 * admin notifications for the signed-in admin, in `adminPushSubscriptions`
 * (server-only), where functions/src/adminNotifications.ts sends to it.
 * Keyed by the endpoint's hash, so re-saving the same device is a no-op.
 */
export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Signed out' }, { status: 401 });

  const parsed = z
    .object({
      endpoint: z.string().max(2000),
      keys: z.object({
        p256dh: z.string().min(1).max(200),
        auth: z.string().min(1).max(100),
      }),
    })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isPushServiceEndpoint(parsed.data.endpoint)) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  }

  const { endpoint, keys } = parsed.data;
  await adminDb()
    .collection('adminPushSubscriptions')
    .doc(subscriptionId(endpoint))
    .set({
      email: admin.email.toLowerCase(),
      endpoint,
      keys,
      userAgent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
      savedAt: FieldValue.serverTimestamp(),
    });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/push
 *
 * Body: { endpoint: string }. Turns admin notifications off for this device.
 */
export async function DELETE(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'Signed out' }, { status: 401 });

  const parsed = z.object({ endpoint: z.string().max(2000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });

  await adminDb().collection('adminPushSubscriptions').doc(subscriptionId(parsed.data.endpoint)).delete();
  return NextResponse.json({ ok: true });
}
