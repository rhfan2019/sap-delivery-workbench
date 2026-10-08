import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, relative, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const commit = '86c90df1b27cfd7ca05bd7f6c312c46f89c11603';
const root = resolve('.runtime/ai-elements-upstream/ai-elements-vue-' + commit);
const destination = resolve('apps/web/src/components');
const groups = [
  'conversation',
  'message',
  'prompt-input',
  'model-selector',
  'attachments',
  'plan',
  'task',
  'confirmation',
  'artifact',
  'suggestion',
  'shimmer',
  'tool',
  'code-block',
  'sources',
  'inline-citation',
];
const manifest = { repository: 'https://github.com/vuepont/ai-elements-vue', commit, files: [] };
const copied = new Set();
async function copyGroup(source, target) {
  if (copied.has(source)) return;
  copied.add(source);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const file = join(source, entry.name),
      out = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyGroup(file, out);
      continue;
    }
    const original = await readFile(file, 'utf8');
    const rewritten = original
      .replaceAll('@repo/shadcn-vue/components/ui/', '@/components/ui/')
      .replaceAll('@repo/shadcn-vue/lib/utils', '@/lib/utils')
      .replaceAll('@repo/elements/', '@/components/ai-elements/');
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, rewritten);
    manifest.files.push({
      source: relative(root, file).replaceAll('\\', '/'),
      target: relative(resolve('.'), out).replaceAll('\\', '/'),
      upstreamSha256: createHash('sha256').update(original).digest('hex'),
    });
    for (const match of original.matchAll(/@repo\/shadcn-vue\/components\/ui\/([\w-]+)/g))
      await copyGroup(
        join(root, 'packages/shadcn-vue/components/ui', match[1]),
        join(destination, 'ui', match[1]),
      );
  }
}
for (const group of groups)
  await copyGroup(
    join(root, 'packages/elements/src', group),
    join(destination, 'ai-elements', group),
  );
await mkdir('apps/web/src/lib', { recursive: true });
await copyFile(join(root, 'packages/shadcn-vue/lib/utils.ts'), 'apps/web/src/lib/utils.ts');
await copyFile(join(root, 'LICENSE'), join(destination, 'ai-elements/LICENSE'));
await writeFile(
  join(destination, 'ai-elements/upstream.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
console.log(`Imported ${manifest.files.length} source files at ${commit}`);
