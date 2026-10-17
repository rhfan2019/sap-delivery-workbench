import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Every theme a person can pick (contract 1.14, DESIGN.md 11) sets the colour tokens the pages
// use in both light and dark, so no theme borrows another theme's colours for part of a page.
const read = (path) => readFile(new URL('../../../apps/web/src/' + path, import.meta.url), 'utf8');
const css =
  (await read('assets/theme.css')) +
  (await read('assets/themes/airbnb.css')) +
  (await read('assets/themes/airtable.css'));
const block = (selector) => {
  const start = css.indexOf(selector + ' {');
  assert.ok(start >= 0, `${selector} is missing`);
  return css.slice(start, css.indexOf('\n}', start));
};
const names = (text) => new Set([...text.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
const colours = [
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

test('each theme sets every colour token in light and in dark', async () => {
  const source = await read('services/theme.ts');
  const ids = [...source.matchAll(/id: '([a-z]+)',\n\s+name:/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['navy', 'airbnb', 'airtable']);
  for (const id of ids) {
    const light = names(
      block(`[data-ui-theme='${id}']`) +
        (id === 'navy' ? block(":root,\n[data-ui-theme='navy']") : ''),
    );
    const dark = names(block(`[data-ui-theme='${id}'][data-ui-mode='dark']`));
    assert.deepEqual(
      colours.filter((n) => !light.has(n)),
      [],
      `${id} light`,
    );
    assert.deepEqual(
      colours.filter((n) => !dark.has(n)),
      [],
      `${id} dark`,
    );
    assert.match(block(`[data-ui-theme='${id}'][data-ui-mode='dark']`), /color-scheme: dark/);
  }
});

test('theme packages change component shapes, not colours only', () => {
  for (const id of ['airbnb', 'airtable']) {
    const own = names(block(`[data-ui-theme='${id}']`));
    for (const token of [
      'font-sans',
      'button-radius',
      'button-height',
      'input-radius',
      'card-radius',
      'tab-indicator',
      'badge-radius',
      'sidebar-inset',
      'composer-radius',
      'heading-weight',
    ])
      assert.ok(own.has(token), `${id} sets --${token}`);
  }
});

test('component tokens are declared on every themed element, so previews compute their own', () => {
  const components = block(':root,\n[data-ui-theme]');
  for (const token of [
    'button-primary-bg',
    'input-radius',
    'card-radius',
    'tab-active-bg',
    'composer-radius',
  ])
    assert.ok(names(components).has(token), token);
});
