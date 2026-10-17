import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Every theme a person can pick (DESIGN.md 11) sets the colour tokens the pages use, so no
// theme falls back to another theme's colours for part of the page.
const css = await readFile(
  new URL('../../../apps/web/src/assets/theme.css', import.meta.url),
  'utf8',
);
const block = (selector) => {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `${selector} is missing`);
  return css.slice(start, css.indexOf('}', start));
};
const names = (text) => new Set([...text.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
const required = [
  'bg',
  'surface',
  'surface-muted',
  'text',
  'muted',
  'text-tertiary',
  'border',
  'border-strong',
  'control-border',
  'hover',
  'active',
  'link',
  'primary',
  'primary-hover',
  'focus',
  'on-primary',
  'nav-bg',
  'nav-text',
  'nav-muted',
  'nav-border',
  'nav-hover',
  'nav-active',
  'nav-focus',
  'error-bg',
  'error-text',
  'error-border',
  'success-bg',
  'success-text',
  'success-border',
  'warning-bg',
  'warning-text',
  'warning-border',
];

test('each selectable theme sets every colour token', async () => {
  const source = await readFile(
    new URL('../../../apps/web/src/services/theme.ts', import.meta.url),
    'utf8',
  );
  const ids = [...source.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['navy', 'ibm', 'vercel', 'linear']);
  for (const id of ids) {
    const defined = names(block(`[data-ui-theme='${id}']`));
    assert.deepEqual(
      required.filter((n) => !defined.has(n)),
      [],
      id,
    );
  }
});

test('a dark theme also re-colours the tags and charts it keeps readable', () => {
  const linear = names(block("[data-ui-theme='linear']"));
  for (const n of ['chart-1', 'tag-blue-bg', 'tag-blue-text', 'tag-yellow-text'])
    assert.ok(linear.has(n), n);
  assert.match(block("[data-ui-theme='linear']"), /color-scheme: dark/);
});
