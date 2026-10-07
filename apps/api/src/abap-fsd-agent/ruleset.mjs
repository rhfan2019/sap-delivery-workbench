import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(
  new URL('../../../../packages/agents/abap-fsd-agent/v1/', import.meta.url),
);
export function loadRules({
  task = 'dialogue',
  riceType = null,
  practices = [],
  rootPath = root,
} = {}) {
  const base = realpathSync(rootPath);
  const manifest = JSON.parse(readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  if (!Object.hasOwn(manifest.profiles, task)) throw new Error('Unknown rule task');
  if (riceType !== null && !['R', 'I', 'C', 'E'].includes(riceType))
    throw new Error('Unsupported RICE type');
  if (['draft', 'review'].includes(task) && !riceType) throw new Error('RICE type required');
  if (!Array.isArray(practices) || practices.some((p) => !Object.hasOwn(manifest.practices, p)))
    throw new Error('Unknown practice');
  if (task === 'dialogue' && (riceType || practices.length))
    throw new Error('Dialogue profile cannot activate future capabilities');
  const selected = [...manifest.profiles[task]];
  if (riceType) selected.push(manifest.types[riceType]);
  for (const practice of practices) selected.push(manifest.practices[practice]);
  const rules = [...new Set(selected)].map((file) => {
    const entries = manifest.modules.filter((m) => m.file === file);
    if (
      entries.length !== 1 ||
      !entries[0].loadable ||
      typeof file !== 'string' ||
      file.includes('\\') ||
      path.isAbsolute(file) ||
      file.split('/').some((part) => part === '..' || part === '.' || !part)
    )
      throw new Error('Invalid rule module path');
    const resolved = realpathSync(path.resolve(base, file));
    const relative = path.relative(base, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('Rule path escapes package');
    const text = readFileSync(resolved, 'utf8');
    const sha256 = createHash('sha256').update(text).digest('hex');
    if (manifest.integrity !== 'runtime-sha256' && sha256 !== entries[0].sha256)
      throw new Error('Rule content hash mismatch');
    return { file, text, sha256 };
  });
  return { version: manifest.version, contractVersion: manifest.contractVersion, task, rules };
}
