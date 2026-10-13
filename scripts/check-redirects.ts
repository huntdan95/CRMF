/**
 * Verify every old WordPress URL lands on the right page of a running site.
 *
 * Usage:
 *   npm run check:redirects                                  # http://localhost:3000
 *   npm run check:redirects -- --base https://default--crmf-99aad.us-east4.hosted.app
 *   npm run check:redirects -- --base https://crystalrivermanateefun.com
 *
 * For each URL in src/lib/legacy-redirects.ts (plus one made-up URL per
 * catch-all), requests `base + from` without following redirects, then
 * follows up to 5 hops by hand. A check passes when:
 *   - the final response is a 200,
 *   - the final path matches the expected destination (fragment ignored),
 *   - it took 2 hops or fewer, and
 *   - every hop was a 301 or 308.
 *
 * Exits non-zero if any check fails.
 */

import { legacyCatchAlls, legacyUrls } from '../src/lib/legacy-redirects';

const MAX_HOPS = 5;
const ALLOWED_HOPS = 2;
const PERMANENT = new Set([301, 308]);
const CONCURRENCY = 4;

function parseBase(argv: string[]): string {
  const i = argv.indexOf('--base');
  const raw = i >= 0 ? argv[i + 1] : 'http://localhost:3000';
  if (!raw) {
    console.error('Missing value for --base');
    process.exit(2);
  }
  return raw.replace(/\/+$/, '');
}

interface Case {
  from: string;
  to: string;
}

interface Hop {
  status: number;
  location: string;
}

interface Result extends Case {
  hops: Hop[];
  finalStatus: number | null;
  pass: boolean;
  reason: string;
}

async function check(base: string, c: Case): Promise<Result> {
  const hops: Hop[] = [];
  const problems: string[] = [];
  let current = new URL(base + c.from);
  let finalStatus: number | null = null;

  try {
    for (;;) {
      const res = await fetch(current, { redirect: 'manual' });
      // Drain the body so the connection can be reused.
      await res.arrayBuffer();
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) {
        finalStatus = res.status;
        break;
      }
      if (hops.length === MAX_HOPS) {
        problems.push(`more than ${MAX_HOPS} hops`);
        break;
      }
      const next = new URL(location, current);
      hops.push({ status: res.status, location: next.pathname + next.search + next.hash });
      current = next;
    }
  } catch (err) {
    problems.push(`request failed: ${(err as Error).message}`);
  }

  if (finalStatus !== null) {
    const expectedPath = c.to.split('#')[0];
    if (finalStatus !== 200) problems.push(`final status ${finalStatus}`);
    if (current.pathname !== expectedPath) problems.push(`ended at ${current.pathname}`);
    if (current.origin !== new URL(base).origin) problems.push(`left the host for ${current.origin}`);
    if (hops.length > ALLOWED_HOPS) problems.push(`${hops.length} hops`);
    const bad = hops.filter((h) => !PERMANENT.has(h.status)).map((h) => h.status);
    if (bad.length) problems.push(`non-permanent hop (${bad.join(', ')})`);
  }

  return { ...c, hops, finalStatus, pass: problems.length === 0, reason: problems.join('; ') };
}

async function runAll(base: string, cases: Case[]): Promise<Result[]> {
  const results: Result[] = new Array(cases.length);
  let next = 0;
  async function worker() {
    while (next < cases.length) {
      const i = next++;
      results[i] = await check(base, cases[i]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printTable(results: Result[]) {
  const rows = results.map((r) => [
    r.pass ? 'PASS' : 'FAIL',
    r.from,
    r.to,
    [...r.hops.map((h) => String(h.status)), r.finalStatus ?? 'ERR'].join(' → '),
    r.pass ? '' : r.reason,
  ]);
  const header = ['', 'From', 'Expected', 'Chain', 'Problem'];
  const widths = header.map((h, col) =>
    Math.max(h.length, ...rows.map((row) => String(row[col]).length)),
  );
  const line = (cols: (string | number)[]) =>
    cols.map((c, i) => pad(String(c), widths[i])).join('  ').trimEnd();
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

async function main() {
  const base = parseBase(process.argv.slice(2));
  const cases: Case[] = [
    ...legacyUrls.map((u) => ({ from: u.from, to: u.to })),
    ...legacyCatchAlls.map((c) => ({ from: c.example, to: c.destination })),
  ];

  console.log(`Checking ${cases.length} old URLs against ${base}\n`);
  const results = await runAll(base, cases);
  printTable(results);

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} passed` +
      (failed.length ? `, ${failed.length} failed` : ''),
  );
  process.exit(failed.length ? 1 : 0);
}

main();
