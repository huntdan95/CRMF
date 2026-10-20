/**
 * The key the admin Cloud Functions send to POST /api/revalidate: both sides
 * work it out from MCP_TOKEN, so they have to agree.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isRevalidateKey, revalidateKey } from '../src/lib/revalidate-key';
import { revalidateKey as functionsRevalidateKey } from '../functions/src/lib/site-refresh';

const TOKEN = 'mcp-test-token-0123456789abcdefghijklmnop';

describe('revalidate key', () => {
  test('the site and the functions work out the same key', () => {
    assert.equal(revalidateKey(TOKEN), functionsRevalidateKey(TOKEN));
    assert.equal(revalidateKey(`${TOKEN}x`), functionsRevalidateKey(`${TOKEN}x`));
  });

  test('is neither MCP_TOKEN nor the same for another token', () => {
    assert.notEqual(revalidateKey(TOKEN), TOKEN);
    assert.notEqual(revalidateKey(TOKEN), revalidateKey(`${TOKEN}x`));
    assert.match(revalidateKey(TOKEN), /^[A-Za-z0-9_-]{43}$/);
  });

  test('the route takes the key and nothing else', () => {
    const key = revalidateKey(TOKEN);
    assert.equal(isRevalidateKey(key, TOKEN), true);
    assert.equal(isRevalidateKey(TOKEN, TOKEN), false, 'MCP_TOKEN itself');
    assert.equal(isRevalidateKey(key.slice(0, -1), TOKEN), false, 'a shorter key');
    assert.equal(isRevalidateKey(`${key}x`, TOKEN), false, 'a longer key');
    assert.equal(isRevalidateKey('', TOKEN), false);
    assert.equal(isRevalidateKey(key, `${TOKEN}x`), false, 'after MCP_TOKEN changes');
  });
});
