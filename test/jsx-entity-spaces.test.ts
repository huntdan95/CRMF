/**
 * Next's SWC drops the space at the start of a JSX text run that follows an
 * element or an `{expression}`, when the run holds an HTML entity (`&rsquo;`,
 * `&ldquo;`…) and goes over a line break: `<strong>Stripe</strong> — sees your
 * card (we don&rsquo;t)` across two lines renders "Stripe— sees". So a run
 * like that starts with `{' '}` after the element instead (or has its
 * entities written as the characters). This finds any that don't, in every
 * page and component. Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const root = path.resolve(__dirname, '..');

/** Text runs in `src` (a .tsx file's text) SWC would drop the leading space of, as `file:line`. */
function spacesDropped(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const raw = src.slice(node.pos, node.end);
      if (raw.includes('\n') && /&[#\w]+;/.test(raw) && /^[ \t]+\S/.test(raw.split('\n')[0]!)) {
        out.push(`${file}:${sf.getLineAndCharacterOfPosition(node.pos).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

test('no JSX text run loses its leading space to an entity and a line break', () => {
  const files = (fs.readdirSync(path.join(root, 'src'), { recursive: true }) as string[])
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => path.join('src', f));
  assert.ok(files.length > 0);
  assert.deepEqual(
    files.flatMap((f) => spacesDropped(f, fs.readFileSync(path.join(root, f), 'utf8'))),
    [],
  );
});

test('it finds such a run, and passes one that starts with {\' \'}', () => {
  const page = (after: string) =>
    `export const A = () => (\n  <p>\n    <strong>Stripe</strong>${after}sees your card (we don&rsquo;t)\n    and nothing else.\n  </p>\n);\n`;
  assert.deepEqual(spacesDropped('Bad.tsx', page(' ')), ['Bad.tsx:3']);
  assert.deepEqual(spacesDropped('Good.tsx', page("{' '}")), []);
});
