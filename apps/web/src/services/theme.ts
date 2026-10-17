import { ref } from 'vue';
import { api } from './session';

// The site theme and light/dark mode a person picks in 个人设置 › 外观 (contract 1.14,
// DESIGN.md 11). Theme packages live in assets/ (theme.css, themes/*.css) as
// [data-ui-theme] / [data-ui-mode] blocks; this only chooses one, loads its font, keeps the
// choice with the account and caches it in this browser so the first paint is right.
export const THEMES = [
  {
    id: 'navy',
    name: '海军蓝',
    note: '默认。中性白底、海军蓝强调，留白与对话排版参考 ChatGPT / Claude。',
    font: () => import('@fontsource-variable/inter'),
  },
  {
    id: 'airbnb',
    name: 'Airbnb',
    note: '温暖宽松：Rausch 红强调、8px 控件、圆润卡片与胶囊标签、单层柔和阴影。',
    font: () => import('@fontsource-variable/plus-jakarta-sans'),
  },
  {
    id: 'airtable',
    name: 'Airtable',
    note: '克制的编辑风：深墨色文字与按钮、蓝色链接、色块代替阴影、细线输入框。',
    font: () => import('@fontsource-variable/inter'),
  },
] as const;
export const MODES = [
  { id: 'light', name: '浅色' },
  { id: 'dark', name: '深色' },
  { id: 'system', name: '跟随系统' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
export type ModeId = (typeof MODES)[number]['id'];

const KEY = 'ui-appearance';
const isTheme = (value: unknown): value is ThemeId => THEMES.some((t) => t.id === value);
const isMode = (value: unknown): value is ModeId => MODES.some((m) => m.id === value);

function cached(): { theme: ThemeId; mode: ModeId } {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      theme: isTheme(value.theme) ? value.theme : 'navy',
      mode: isMode(value.mode) ? value.mode : 'system',
    };
  } catch {
    return { theme: 'navy', mode: 'system' };
  }
}

const initial = cached();
export const theme = ref<ThemeId>(initial.theme);
export const mode = ref<ModeId>(initial.mode);
const systemDark =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
// The mode actually shown: "system" follows the operating system.
export const resolvedMode = ref<'light' | 'dark'>('light');

function apply() {
  resolvedMode.value =
    mode.value === 'system' ? (systemDark?.matches ? 'dark' : 'light') : mode.value;
  const root = document.documentElement;
  root.dataset.uiTheme = theme.value;
  root.dataset.uiMode = resolvedMode.value;
  void THEMES.find((t) => t.id === theme.value)
    ?.font()
    .catch(() => {});
  try {
    localStorage.setItem(KEY, JSON.stringify({ theme: theme.value, mode: mode.value }));
  } catch {}
}

// Before the app mounts: the cached choice, and follow the system while in "system" mode.
export function applyStoredTheme() {
  apply();
  systemDark?.addEventListener('change', () => {
    if (mode.value === 'system') apply();
  });
}

// After sign-in: the account's choice wins over this browser's cache.
export async function syncAppearance() {
  try {
    const saved = await api<{ theme: string; mode: string }>('/preferences');
    if (isTheme(saved.theme)) theme.value = saved.theme;
    if (isMode(saved.mode)) mode.value = saved.mode;
    apply();
  } catch {}
}

export async function setAppearance(next: { theme?: ThemeId; mode?: ModeId }) {
  if (next.theme && isTheme(next.theme)) theme.value = next.theme;
  if (next.mode && isMode(next.mode)) mode.value = next.mode;
  apply();
  await api('/preferences', { theme: theme.value, mode: mode.value }, 'PUT');
}

// Font for a preview card of another theme.
export function loadThemeFont(id: ThemeId) {
  void THEMES.find((t) => t.id === id)
    ?.font()
    .catch(() => {});
}
