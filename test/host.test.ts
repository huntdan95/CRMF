/**
 * Which host a request is for (src/lib/host.ts), as the proxy and
 * robots.txt read it. Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { hostFromHeaders, namesProductionHost } from '../src/lib/host';

function headers(h: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

describe('hostFromHeaders', () => {
  test('the first X-Forwarded-Host, else Host, lowercased without a port', () => {
    assert.equal(hostFromHeaders(headers({ 'X-Forwarded-Host': 'WWW.Example.com:443, b', Host: 'c' })), 'www.example.com');
    assert.equal(hostFromHeaders(headers({ Host: 'localhost:3000' })), 'localhost');
  });
});

describe('namesProductionHost', () => {
  test('the real domain, however it arrives', () => {
    assert.ok(namesProductionHost(headers({ 'X-Forwarded-Host': 'crystalrivermanateefun.com' })));
    assert.ok(namesProductionHost(headers({ Host: 'CrystalRiverManateeFun.com:443' })));
    assert.ok(namesProductionHost(headers({ 'X-Forwarded-Host': 'crystalrivermanateefun.com', Host: 'x.a.run.app' })));
  });

  test("a visitor's made-up X-Forwarded-Host can't hide the real domain", () => {
    // Appended to by the front end…
    assert.ok(namesProductionHost(headers({ 'X-Forwarded-Host': 'evil.example, crystalrivermanateefun.com' })));
    // …or passed through, with the real host in Host.
    assert.ok(namesProductionHost(headers({ 'X-Forwarded-Host': 'evil.example', Host: 'crystalrivermanateefun.com' })));
  });

  test('staging, www and localhost are not production', () => {
    const cases: Record<string, string>[] = [
      { 'X-Forwarded-Host': 'default--crmf-99aad.us-east4.hosted.app' },
      { 'X-Forwarded-Host': 'www.crystalrivermanateefun.com', Host: 'x.a.run.app' },
      { Host: 'localhost:3000' },
      { 'X-Forwarded-Host': 'crystalrivermanateefun.com.evil.example' },
      {},
    ];
    for (const h of cases) {
      assert.equal(namesProductionHost(headers(h)), false, JSON.stringify(h));
    }
  });
});
