/**
 * Which given-up Drive copies the one-off requeue puts back
 * (scripts/requeue-drive-copies.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldRequeue } from '../scripts/requeue-drive-copies';

describe('shouldRequeue', () => {
  test('a file the old functions gave up on because Google wouldn’t sign the site in goes back', () => {
    assert.equal(shouldRequeue({ status: 'failed', attempts: 5, error: 'Google token refresh failed: invalid_grant' }), true);
    // Signed out part way: Drive answered 401.
    assert.equal(
      shouldRequeue({ status: 'failed', attempts: 5, error: 'Starting the Drive upload failed (401): {"error": {}}' }),
      true,
    );
  });

  test('so does one Drive turned away for the whole account', () => {
    const full =
      'Drive POST /upload/drive/v3/files failed (403): {\n "error": {\n  "errors": [\n   {\n    "domain": "usageLimits",\n    "reason": "storageQuotaExceeded"';
    assert.equal(shouldRequeue({ status: 'failed', attempts: 5, error: full }), true);
  });

  test('a file that failed for reasons of its own stays given up on', () => {
    assert.equal(shouldRequeue({ status: 'failed', attempts: 5, error: 'Drive upload failed (500)' }), false);
    assert.equal(shouldRequeue({ status: 'failed', attempts: 5, error: 'The copy kept stopping part way.' }), false);
    assert.equal(shouldRequeue({ status: 'failed', attempts: 5, error: null }), false);
  });

  test('one with tries left, waiting, or copied is the hourly retry’s already', () => {
    const error = 'Google token refresh failed: invalid_grant';
    assert.equal(shouldRequeue({ status: 'failed', attempts: 3, error }), false);
    assert.equal(shouldRequeue({ status: 'not-connected', attempts: 0, error }), false);
    assert.equal(shouldRequeue({ status: 'copied', attempts: 5, error: null }), false);
    assert.equal(shouldRequeue(undefined), false);
  });
});
