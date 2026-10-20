/**
 * The email that sends Travis grokbot's draft to approve
 * (onBlogReviewRequested.ts). Against in-memory stand-ins for Firestore and
 * Resend. Run with `npm test` in functions/.
 */
import { createHash } from 'node:crypto';
import { describe, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { DocumentReference } from 'firebase-admin/firestore';

// Secrets and params are read from the environment when a send runs.
process.env.RESEND_FROM_EMAIL = 'Manatee Fun <hello@example.com>';
process.env.ADMIN_EMAIL = 'travis@example.com';
process.env.APP_BASE_URL = 'https://example.com';

import { runBlogReviewRetry, sendBlogReview, type BlogReviewRequest } from '../src/onBlogReviewRequested';
import { fakeFirestore, fakeResend } from './fakes';

const request: BlogReviewRequest = {
  slug: 'manatee-season-crystal-river',
  title: 'Manatee season in Crystal River',
  description: 'When the manatees come to Kings Bay.',
  bodyHtml: '<p>See <a href="/tours">the tours</a>.</p>',
  token: 'tok-123',
};

function setup(fail?: { name: string; message: string }) {
  // The request's id isn't the slug: each submission gets a new one.
  const fs = fakeFirestore({ blogReviewRequests: { req1: { ...request } } });
  const ref = fs.db.collection('blogReviewRequests').doc('req1') as unknown as DocumentReference;
  const { resend, sent } = fakeResend({ fail });
  return { ...fs, ref, sent, run: () => sendBlogReview(ref, request, { db: fs.db, resend }) };
}

describe('blog review email', () => {
  test('emails Travis the review link for the slug, logs it, and deletes the request', async () => {
    const s = setup();
    await s.run();
    assert.equal(s.sent.length, 1);
    assert.deepEqual(s.sent[0]!.payload.to, ['travis@example.com']);
    assert.match(s.sent[0]!.payload.text!, /https:\/\/example\.com\/blog-review\/manatee-season-crystal-river\?t=tok-123/);
    assert.match(s.sent[0]!.payload.html!, /href="https:\/\/example\.com\/tours"/);
    assert.equal(s.col('emailLog').get('em_1')?.kind, 'admin');
    assert.equal(s.col('blogReviewRequests').has('req1'), false);
  });

  test('a refused email keeps the request, with the only copy of the token, and the error', async () => {
    const s = setup({ name: 'validation_error', message: 'Invalid `to` field' });
    await s.run();
    const kept = s.col('blogReviewRequests').get('req1');
    assert.equal(kept?.token, 'tok-123');
    assert.match(String(kept?.error), /Resend failed: Invalid `to` field/);
    assert.equal(s.col('emailLog').size, 0);
  });
});

describe('sending a refused review email again', () => {
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');
  const draft = (extra: Record<string, unknown> = {}) => ({ status: 'pending-review', reviewTokenHash: hash('tok-123'), ...extra });

  function quiet(t: TestContext) {
    for (const level of ['log', 'info', 'warn', 'error'] as const) t.mock.method(console, level, () => {});
  }

  test('sends it while the draft still waits for Travis, then deletes it', async (t) => {
    quiet(t);
    const fs = fakeFirestore({
      blogReviewRequests: { req1: { ...request, error: 'EmailSendError: Resend failed: Service unavailable' } },
      newsPosts: { [request.slug!]: draft() },
    });
    const { resend, sent } = fakeResend();
    assert.equal(await runBlogReviewRetry({ db: fs.db, resend }), 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.payload.text!, /\/blog-review\/manatee-season-crystal-river\?t=tok-123/);
    assert.equal(fs.col('blogReviewRequests').has('req1'), false);
  });

  test('still refused: kept, with the new error, for the next hour', async (t) => {
    quiet(t);
    const fs = fakeFirestore({
      blogReviewRequests: { req1: { ...request, error: 'old' } },
      newsPosts: { [request.slug!]: draft() },
    });
    const { resend } = fakeResend({ fail: { name: 'application_error', message: 'Down again' } });
    assert.equal(await runBlogReviewRetry({ db: fs.db, resend }), 0);
    assert.match(String(fs.col('blogReviewRequests').get('req1')?.error), /Down again/);
  });

  test('not for a draft already reviewed or replaced: its link is dead, so the request goes', async (t) => {
    quiet(t);
    const fs = fakeFirestore({
      blogReviewRequests: {
        approved: { ...request, error: 'x' },
        replaced: { ...request, slug: 'other-post', error: 'x' },
      },
      newsPosts: {
        [request.slug!]: draft({ status: 'published', reviewTokenHash: null }),
        'other-post': draft({ reviewTokenHash: hash('a-newer-token') }),
      },
    });
    const { resend, sent } = fakeResend();
    assert.equal(await runBlogReviewRetry({ db: fs.db, resend }), 0);
    assert.equal(sent.length, 0);
    assert.equal(fs.col('blogReviewRequests').size, 0);
  });

  test('leaves alone a request the trigger hasn’t sent yet', async (t) => {
    quiet(t);
    const fs = fakeFirestore({
      blogReviewRequests: { req1: { ...request } },
      newsPosts: { [request.slug!]: draft() },
    });
    const { resend, sent } = fakeResend();
    assert.equal(await runBlogReviewRetry({ db: fs.db, resend }), 0);
    assert.equal(sent.length, 0);
    assert.ok(fs.col('blogReviewRequests').has('req1'));
  });
});
