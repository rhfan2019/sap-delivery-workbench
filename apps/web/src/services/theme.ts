import { ref, watch } from 'vue';
import { identity } from './session';

// Colour themes (DESIGN.md 2.3, contract 1.25): one click swaps the accent and the backdrop. The
// values live in assets/theme.css under [data-theme]; the choice is remembered per browser and
// user, and the last one used colours the login page too.
export const themes = [
  { id: 'yellow', label: '明黄' },
  { id: 'coral', label: '珊瑚橙' },
  { id: 'mint', label: '薄荷' },
  { id: 'sky', label: '天蓝' },
  { id: 'lilac', label: '丁香' },
] as const;
export type ThemeId = (typeof themes)[number]['id'];

const LAST = 'theme:last';
const keyOf = (userId: string) => 'theme:' + userId;
const known = (id: string | null): id is ThemeId => themes.some((t) => t.id === id);

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be refused; the theme then lasts for this page only.
  }
}

export const theme = ref<ThemeId>('yellow');
function apply(id: ThemeId) {
  theme.value = id;
  document.documentElement.dataset.theme = id;
}

export function setTheme(id: ThemeId) {
  apply(id);
  write(LAST, id);
  const user = identity.value?.user.id;
  if (user) write(keyOf(user), id);
}

// Before mounting: the last theme used in this browser, so nothing flashes; once someone signs in,
// their own choice.
export function startTheme() {
  const last = read(LAST);
  apply(known(last) ? last : 'yellow');
  watch(
    () => identity.value?.user.id,
    (user) => {
      if (!user) return;
      const own = read(keyOf(user));
      if (known(own)) apply(own);
    },
    { immediate: true },
  );
}
