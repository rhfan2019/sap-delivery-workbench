import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const promptRoot = fileURLToPath(
  new URL('../../../../packages/agents/abap-fsd-agent/v1/', import.meta.url),
);
export function promptRecord(name, { rootPath = promptRoot } = {}) {
  const base = realpathSync(rootPath);
  const manifest = JSON.parse(readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  const file = manifest.protocolFile;
  if (
    typeof name !== 'string' ||
    !/^[a-z][a-z-]*$/.test(name) ||
    typeof file !== 'string' ||
    path.isAbsolute(file) ||
    file.includes('\\') ||
    file.split('/').some((p) => !p || p === '..' || p === '.') ||
    !file.endsWith('.md')
  )
    throw new Error('Invalid prompt template');
  const resolved = realpathSync(path.resolve(base, file));
  if (
    path.relative(base, resolved).startsWith('..') ||
    path.isAbsolute(path.relative(base, resolved))
  )
    throw new Error('Invalid prompt path');
  const source = readFileSync(resolved, 'utf8');
  const sections = [
    ...source.matchAll(/^## ([a-z][a-z-]*)\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm),
  ];
  const selected = sections.filter((s) => s[1] === name);
  if (selected.length !== 1) throw new Error('Unknown or duplicate prompt template: ' + name);
  return {
    name,
    file,
    text: selected[0][2].trim(),
    sha256: createHash('sha256').update(source).digest('hex'),
  };
}
export function renderPrompt(name, variables = {}, options = {}) {
  return promptRecord(name, options).text.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_, key) => {
    if (!Object.hasOwn(variables, key)) throw new Error('Missing prompt variable: ' + key);
    return String(variables[key]);
  });
}

export function promptRecords(names) {
  return [...new Set(names)].map((name) => {
    const { text, ...record } = promptRecord(name);
    return record;
  });
}

export function withPromptMessages(context, messages, names = []) {
  const records = [...(context.manifest?.promptFiles ?? []), ...promptRecords(names)];
  return {
    ...context,
    messages,
    manifest: {
      ...context.manifest,
      promptFiles: [...new Map(records.map((r) => [r.name, r])).values()],
      bytes: Buffer.byteLength(JSON.stringify(messages), 'utf8'),
      runtimeInstructionsHash: createHash('sha256')
        .update(JSON.stringify(messages.filter((m) => m.role === 'system').map((m) => m.content)))
        .digest('hex'),
      messagesHash: createHash('sha256').update(JSON.stringify(messages)).digest('hex'),
    },
  };
}
