import {
  writeFileSync,
  renameSync,
  readFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(path + '.tmp', path);
}
export function acquireLock(dir) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, '.lock');
  try {
    const fd = openSync(path, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    closeSync(fd);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const { pid } = readJson(path);
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') alive = false;
    }
    if (alive) throw Error('批次已有执行器，请勿并行执行');
    unlinkSync(path);
    return acquireLock(dir);
  }
  return () => unlinkSync(path);
}
