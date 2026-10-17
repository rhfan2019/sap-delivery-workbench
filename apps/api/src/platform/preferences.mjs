import { failure } from './auth.mjs';

// The appearance a person picks in 个人设置 › 外观 (contract 1.14): a theme package and a
// light/dark mode. The API stores any well-formed theme id; the browser knows which exist.
export const MODES = ['light', 'dark', 'system'];
export const DEFAULTS = { theme: 'navy', mode: 'system' };

export async function getPreferences(db, userId) {
  const { rows } = await db.query('SELECT theme,mode FROM app.user_preference WHERE user_id=$1', [
    userId,
  ]);
  return rows[0] ?? { ...DEFAULTS };
}

export async function savePreferences(db, userId, body = {}) {
  const current = await getPreferences(db, userId);
  const theme = body.theme ?? current.theme,
    mode = body.mode ?? current.mode;
  if (typeof theme !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(theme))
    throw failure(400, '主题名称无效。');
  if (!MODES.includes(mode)) throw failure(400, '显示模式只能是浅色、深色或跟随系统。');
  await db.query(
    `INSERT INTO app.user_preference(user_id,theme,mode) VALUES($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET theme=EXCLUDED.theme,mode=EXCLUDED.mode,updated_at=CURRENT_TIMESTAMP`,
    [userId, theme, mode],
  );
  return { theme, mode };
}
