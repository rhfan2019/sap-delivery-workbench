import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// DESIGN.md 4.0: six hues with the same roles, theme.css carries the spec's values exactly, there
// is no dark mode, and each colour theme swaps only the accent and the backdrop (contract 1.25).
const css = await readFile(
  new URL('../../../apps/web/src/assets/theme.css', import.meta.url),
  'utf8',
);
const spec = await readFile(new URL('../../../docs/DESIGN.md', import.meta.url), 'utf8');
const hues = ['neutral', 'blue', 'green', 'purple', 'red', 'yellow'];
const roles = [
  'bg-1',
  'bg-2',
  'fill-1',
  'fill-2',
  'fill-3',
  'border-1',
  'border-2',
  'border-3',
  'text-1',
  'text-2',
  'icon-1',
  'icon-2',
  'solid-1',
  'solid-2',
];
const values = (text) =>
  Object.fromEntries([...text.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = values(css.slice(0, css.indexOf("[data-theme='")));

test('every hue has every role, and there is no dark mode', () => {
  for (const hue of hues)
    for (const role of roles) assert.ok(light[`${hue}-${role}`], `--${hue}-${role}`);
  assert.doesNotMatch(css, /prefers-color-scheme/);
});

test('theme.css carries the light colours written in DESIGN.md', () => {
  for (const hue of hues) {
    const line = spec.match(new RegExp(`^  ${hue}:\\s*\\{([^}]+)\\}`, 'm'));
    assert.ok(line, `DESIGN.md colours.${hue}`);
    for (const [, role, value] of line[1].matchAll(/([\w-]+): '(#[0-9A-Fa-f]{6})'/g))
      assert.equal(light[`${hue}-${role}`]?.toLowerCase(), value.toLowerCase(), `--${hue}-${role}`);
  }
});

test('each colour theme in DESIGN.md swaps only the accent and the backdrop', () => {
  const blocks = [...css.matchAll(/\[data-theme='([\w-]+)'\]\s*\{([^}]+)\}/g)];
  const table = spec.slice(spec.indexOf('### 2.3'), spec.indexOf('## 3.'));
  assert.ok(blocks.length >= 2);
  for (const [, id, body] of blocks) {
    const set = values(body);
    assert.deepEqual(Object.keys(set).sort(), ['accent', 'accent-hover', 'accent-wash'], id);
    for (const value of Object.values(set)) assert.match(table, new RegExp(value, 'i'), id);
  }
  // The default theme is the one :root carries.
  const yellow = values(blocks.find(([, id]) => id === 'yellow')[2]);
  for (const [name, value] of Object.entries(yellow)) assert.equal(light[name], value, name);
});
