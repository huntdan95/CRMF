/**
 * The visitor's address the waiver list compares for "signed on the same
 * phone" (src/lib/forwarded-for.ts), against the one the checkout limit
 * counts (readForwardedFor in functions/src/lib/checkout-limit.ts). Run with
 * `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { visitorIp } from '../src/lib/forwarded-for';
import { sameDeviceSigners, type WaiverDoc } from '../src/lib/admin-waivers';
import { readForwardedFor } from '../functions/src/lib/checkout-limit';

describe('visitorIp', () => {
  test('skips Google’s proxy hops at the end, so two phones behind them aren’t one', () => {
    assert.equal(visitorIp('198.51.100.7, 35.191.10.20'), '198.51.100.7');
    assert.equal(visitorIp('203.0.113.9, 35.191.10.20'), '203.0.113.9');
    assert.equal(visitorIp('203.0.113.9, 130.211.2.4, 35.191.0.1'), '203.0.113.9');
  });

  test('the address Google saw, not what the client wrote to its left', () => {
    assert.equal(visitorIp('1.2.3.4, 203.0.113.9'), '203.0.113.9');
    assert.equal(visitorIp('203.0.113.9'), '203.0.113.9');
    assert.equal(visitorIp('::ffff:203.0.113.9'), '203.0.113.9');
    assert.equal(visitorIp('2001:db8::1'), '2001:db8::1');
  });

  test('nothing to go on: no chain, not an address, or a private one', () => {
    for (const chain of [null, undefined, '', 'unknown', '203.0.113.9, 10.0.0.4', '127.0.0.1', '::1', 'fd00::5', '35.191.10.20']) {
      assert.equal(visitorIp(chain), null, String(chain));
    }
  });

  test('the same answer as the checkout limit', () => {
    const chains = [
      '198.51.100.7, 35.191.10.20',
      '1.2.3.4, 203.0.113.9',
      '203.0.113.9, 130.211.2.4, 35.191.0.1',
      '::ffff:203.0.113.9',
      '2001:db8::1',
      '2001:db8:0:0:0:0:0:1',
      '64:ff9b::203.0.113.5',
      'fe80::1',
      '203.0.113.9, 10.0.0.4',
      '172.20.1.1',
      '192.168.1.5',
      '169.254.0.9',
      '999.1.1.1',
      '1:2:3',
      'garbage',
      '',
    ];
    for (const chain of chains) {
      assert.equal(visitorIp(chain), readForwardedFor({ 'x-forwarded-for': chain }).ip, chain);
    }
  });
});

describe('sameDeviceSigners', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
  const signed = (id: string, name: string, ip: string | null, userAgent: string | null = IPHONE) =>
    ({ id, signer: { name }, ip, userAgent }) as unknown as WaiverDoc;

  test('two of the same iPhone on different connections, behind the same Google proxy, aren’t one phone', () => {
    const out = sameDeviceSigners([
      signed('w1', 'Pat Example', '198.51.100.7, 35.191.10.20'),
      signed('w2', 'Sam Example', '203.0.113.9, 35.191.10.20'),
    ]);
    assert.equal(out.size, 0);
  });

  test('one phone passed around is still matched, whichever Google hop each came through', () => {
    const out = sameDeviceSigners([
      signed('w1', 'Pat Example', '198.51.100.7, 35.191.10.20'),
      signed('w2', 'Sam Example', '198.51.100.7, 35.191.4.2'),
    ]);
    assert.deepEqual(out.get('w1'), ['Sam Example']);
    assert.deepEqual(out.get('w2'), ['Pat Example']);
  });

  test('no address to go on matches nobody', () => {
    assert.equal(sameDeviceSigners([signed('w1', 'Pat Example', null), signed('w2', 'Sam Example', null)]).size, 0);
  });
});
