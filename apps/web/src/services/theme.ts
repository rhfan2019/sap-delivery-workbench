import { ref } from 'vue';

// The site theme a person picks in 个人设置 › 外观 (DESIGN.md 11). The values live in
// theme.css as [data-ui-theme] presets; this only chooses one and remembers it in this browser.
export const THEMES = [
  {
    id: 'navy',
    name: '海军蓝',
    note: '默认。中性白底，海军蓝强调，留白与对话排版参考 ChatGPT / Claude。',
  },
  {
    id: 'ibm',
    name: 'IBM Carbon',
    note: '企业蓝与直角，信息密度高，接近 SAP Fiori 的企业应用风格。',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    note: '黑白极简，精确克制；蓝色只用于链接和焦点。',
  },
  {
    id: 'linear',
    name: 'Linear 深色',
    note: '深色工程风格，靛蓝强调，适合长时间阅读代码与文档。',
  },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'ui-theme';
const known = (value: unknown): value is ThemeId => THEMES.some((t) => t.id === value);

function stored(): ThemeId {
  try {
    const value = localStorage.getItem(KEY);
    return known(value) ? value : 'navy';
  } catch {
    return 'navy';
  }
}

export const theme = ref<ThemeId>(stored());

function apply(id: ThemeId) {
  document.documentElement.dataset.uiTheme = id;
}

// Called before the app mounts, so the first paint already has the chosen theme.
export function applyStoredTheme() {
  apply(theme.value);
}

export function setTheme(id: ThemeId) {
  if (!known(id)) return;
  theme.value = id;
  apply(id);
  try {
    localStorage.setItem(KEY, id);
  } catch {}
}
