import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// DESIGN.md 2.0: six hues with the same roles, in light and in dark, and theme.css carries the
// spec's light values exactly (contract 1.15: one look, dark follows the system).
const css = await readFile(
  new URL('../../../apps/web/src/assets/theme.css', import.meta.url),
  'utf8',
);
const spec = await readFile(new URL('../../../docs/specs/DESIGN.md', import.meta.url), 'utf8');
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
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const light = values(css.slice(0, darkStart));
const dark = values(css.slice(darkStart, css.indexOf('\n}\n', darkStart)));

test('every hue has every role in light and in dark', () => {
  for (const hue of hues)
    for (const role of roles) {
      assert.ok(light[`${hue}-${role}`], `light --${hue}-${role}`);
      assert.ok(dark[`${hue}-${role}`], `dark --${hue}-${role}`);
    }
});

test('theme.css carries the light colours written in DESIGN.md', () => {
  for (const hue of hues) {
    const line = spec.match(new RegExp(`^  ${hue}:\\s*\\{([^}]+)\\}`, 'm'));
    assert.ok(line, `DESIGN.md colours.${hue}`);
    for (const [, role, value] of line[1].matchAll(/([\w-]+): '(#[0-9A-Fa-f]{6})'/g))
      assert.equal(light[`${hue}-${role}`]?.toLowerCase(), value.toLowerCase(), `--${hue}-${role}`);
  }
});

test('there is one look: no theme packages or theme attributes', async () => {
  assert.doesNotMatch(css, /data-ui-theme|data-ui-mode/);
  const main = await readFile(new URL('../../../apps/web/src/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /assets\/themes\//);
});
