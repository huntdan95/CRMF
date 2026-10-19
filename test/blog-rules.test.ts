/**
 * When grokbot may write a post (src/lib/blog-rules.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DAY_MS, cadenceOf, holdsItsPlace, type PostRow } from '../src/lib/blog-rules';

const NOW = Date.parse('2026-10-20T14:00:00Z');
const daysAgo = (n: number) => NOW - n * DAY_MS;
const row = (slug: string, status: PostRow['status'], submittedDaysAgo: number, more: Partial<PostRow> = {}): PostRow => ({
  slug,
  title: slug.replace(/-/g, ' '),
  status,
  submittedAt: daysAgo(submittedDaysAgo),
  reviewedAt: null,
  reviewNote: null,
  ...more,
});

describe('cadenceOf', () => {
  test('the very first post is due', () => {
    assert.equal(cadenceOf([], NOW).due, true);
  });

  test('nothing new while a draft waits for Travis', () => {
    const c = cadenceOf([row('old-post', 'published', 30), row('new-draft', 'pending-review', 2)], NOW);
    assert.equal(c.due, false);
    assert.equal(c.pending?.slug, 'new-draft');
    assert.match(c.status, /Waiting for Travis to review “new draft”/);
  });

  test('every other week, counted from when the last approved post was submitted', () => {
    // Weekly runs: 7 days after the last one isn't due, 14 days after is,
    // even though Travis took 4 days to approve it.
    const lastWeek = cadenceOf([row('a', 'published', 7, { reviewedAt: daysAgo(3) })], NOW);
    assert.equal(lastWeek.due, false);
    assert.equal(lastWeek.nextDueAt, new Date(daysAgo(7) + 13 * DAY_MS).toISOString());
    assert.equal(cadenceOf([row('a', 'published', 14)], NOW).due, true);
    // A run that starts a few hours early still lands.
    assert.equal(cadenceOf([row('a', 'published', 13.9)], NOW).due, true);
  });

  test('a post taken down still counts, so hiding one doesn’t trigger another', () => {
    assert.equal(cadenceOf([row('a', 'hidden', 5)], NOW).due, false);
  });

  test('a turned-down draft doesn’t count: the next run tries again, with Travis’s note', () => {
    const c = cadenceOf(
      [row('a', 'published', 20), row('b', 'declined', 6, { reviewedAt: daysAgo(5), reviewNote: 'Too much about prices' })],
      NOW,
    );
    assert.equal(c.due, true);
    assert.match(c.status, /turned down “b”, saying: “Too much about prices\.” Take that into account\./);
    assert.equal(c.declined[0]?.note, 'Too much about prices');
  });

  test('old feedback, from before the last approved post, isn’t repeated', () => {
    const c = cadenceOf(
      [row('b', 'declined', 40, { reviewedAt: daysAgo(39), reviewNote: 'old' }), row('a', 'published', 20)],
      NOW,
    );
    assert.equal(c.due, true);
    assert.doesNotMatch(c.status, /old/);
  });

  test('a draft nobody reviewed for a week stops blocking, and is flagged to be replaced', () => {
    const c = cadenceOf([row('a', 'published', 30), row('forgotten', 'pending-review', 8)], NOW);
    assert.equal(c.due, true);
    assert.equal(c.stale?.slug, 'forgotten');
    assert.match(c.status, /replaces it/);
  });

  test('a draft submitted minutes into last week’s run has expired by this week’s', () => {
    const c = cadenceOf([row('a', 'published', 30), row('forgotten', 'pending-review', 7 - 10 / (24 * 60))], NOW);
    assert.equal(c.due, true);
    assert.equal(c.stale?.slug, 'forgotten');
  });
});

describe('holdsItsPlace', () => {
  test('approved posts and fresh drafts keep their slug and photos; the rest free them', () => {
    assert.equal(holdsItsPlace('published', daysAgo(100), NOW), true);
    assert.equal(holdsItsPlace('hidden', daysAgo(100), NOW), true);
    assert.equal(holdsItsPlace('pending-review', daysAgo(2), NOW), true);
    assert.equal(holdsItsPlace('pending-review', daysAgo(8), NOW), false);
    // Freed by the weekly run a week after it was submitted, a few minutes early or not.
    assert.equal(holdsItsPlace('pending-review', daysAgo(7 - 10 / (24 * 60)), NOW), false);
    assert.equal(holdsItsPlace('declined', daysAgo(1), NOW), false);
    assert.equal(holdsItsPlace('expired', daysAgo(1), NOW), false);
  });
});
