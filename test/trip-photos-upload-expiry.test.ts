/**
 * When a trip's upload link stops taking photos (uploadExpiresAt in
 * src/lib/trip-photos-server.ts): midnight marina time at the end of the
 * 7th day after the trip, in summer time and winter time alike, the same
 * instant the functions' copy (functions/src/lib/trip-photos.ts) gives.
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

// `server-only` throws outside a React Server Components build: stand in for it.
const load = Module.createRequire(__filename);
const serverOnly = load.resolve('server-only');
load.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
const { uploadExpiresAt } = load('../src/lib/trip-photos-server') as typeof import('../src/lib/trip-photos-server');

test('a trip in EDT: the link closes at midnight EDT, not 1 AM', () => {
  // Tue Oct 13 → the end of Tue Oct 20, which is 04:00 UTC on the 21st.
  assert.equal(uploadExpiresAt('2026-10-13').toISOString(), '2026-10-21T04:00:00.000Z');
});

test('a trip in EST: midnight EST', () => {
  assert.equal(uploadExpiresAt('2026-11-10').toISOString(), '2026-11-18T05:00:00.000Z');
});

test('across the clock changes, it goes by the closing day’s own offset', () => {
  // Trip in EDT, link closes after the clocks go back.
  assert.equal(uploadExpiresAt('2026-10-28').toISOString(), '2026-11-05T05:00:00.000Z');
  // Closes the midnight before the clocks go forward (2 AM Mar 14), then the one after.
  assert.equal(uploadExpiresAt('2027-03-05').toISOString(), '2027-03-13T05:00:00.000Z');
  assert.equal(uploadExpiresAt('2027-03-06').toISOString(), '2027-03-14T05:00:00.000Z');
  assert.equal(uploadExpiresAt('2027-03-07').toISOString(), '2027-03-15T04:00:00.000Z');
});
