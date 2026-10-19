/**
 * JSON-LD script bodies (src/lib/seo.ts). Run with `npm test`.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { jsonLdHtml } from '../src/lib/seo';

describe('jsonLdHtml', () => {
  test("a tour name can't close the script tag", () => {
    const html = jsonLdHtml({ name: 'x</script><script>alert(1)</script>' });
    assert.ok(!html.includes('<'));
    assert.ok(!html.includes('>'));
  });

  test('parses back to the same object', () => {
    const data = { name: 'Fish & <Chips>', nested: [{ a: '</script>' }], n: 3 };
    assert.deepEqual(JSON.parse(jsonLdHtml(data)), data);
  });
});
