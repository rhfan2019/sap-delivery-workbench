import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { posix as path, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const browserContracts = new Set([
  'abap-fsd-agent/types',
  'abap-fsd-agent/sse',
  'abap-dev-agent/types',
  'agent-core/sse',
  'delivery/fields',
]);
// Contract 1.3/1.7: one assistant version; earlier generations stay deleted.
const agentModules = ['agent-core', 'abap-fsd-agent', 'abap-dev-agent'];
const agentRoots = [
  ...agentModules.map((m) => `apps/api/src/modules/${m}/`),
  ...['agent-workbench', 'abap-fsd-agent', 'abap-dev-agent'].map(
    (f) => `apps/web/src/features/${f}/`,
  ),
  ...agentModules.map((m) => `packages/contracts/${m}/`),
];
// Contract 1.7: prompts hold system.md, <kind>.md and <kind>-example.abap; framework copies are .abap.
const agentResource =
  /^apps\/api\/src\/modules\/(agent-core|abap-fsd-agent|abap-dev-agent)\/(prompts|frameworks)\/(.+)$/;
const removedModules =
  /^(apps|packages|scripts|tools|infra)\/(.+\/)?(design-assistant|agent-runtime|fs-workspace|fs-assistant-test)(\/|$)/;
const legacyIdentifiers = [
  'fsd_v1_',
  '/work/design/fsd',
  'gem-fsd-v2',
  'work/design/agent',
  '/api/admin/abap-fsd-agent',
  'DESIGN_ASSISTANT_REMOVED',
  'fsd_checkpoint',
  // Contract 1.6: the manual FS ledger is replaced by the design agent.
  'app.fs_draft',
  'app.fs_version',
];
export function checkLegacy(file, content = '') {
  const errors = [];
  if (agentRoots.some((root) => file.startsWith(root)) && /\/v\d+\//.test(file))
    errors.push(`${file}: Version directory in assistant code`);
  if (removedModules.test(file)) errors.push(`${file}: Removed assistant module path`);
  const resource = file.match(agentResource);
  if (resource) {
    const [, , kind, name] = resource;
    const valid =
      kind === 'prompts'
        ? /^[a-z]+(-[a-z]+)*\.md$/.test(name) || /^[a-z]+-example\.abap$/.test(name)
        : /^[a-z0-9_]+\.abap$/.test(name);
    if (!valid) errors.push(`${file}: Agent ${kind} file outside the naming rule`);
  }
  if (
    /^(apps|packages|scripts|tools|infra)\//.test(file) &&
    file !== 'scripts/checks/architecture.mjs'
  )
    for (const id of legacyIdentifiers)
      if (content.includes(id)) errors.push(`${file}: Legacy assistant identifier ${id}`);
  return errors;
}
const workspace = (file) =>
  file.startsWith('apps/web/')
    ? 'web'
    : file.startsWith('apps/api/')
      ? 'api'
      : file.startsWith('packages/contracts/')
        ? 'contracts'
        : null;
const moduleName = (file) => file.match(/^apps\/api\/src\/modules\/([^/]+)\//)?.[1];
const featureName = (file) => file.match(/^apps\/web\/src\/features\/([^/]+)\//)?.[1];

export function importsOf(file, content) {
  const sourceText = file.endsWith('.vue')
    ? [...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
    : content;
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const result = [];
  const requireNames = new Set(['require']);
  const factories = new Set(['createRequire']);
  function findRequireBindings(node) {
    if (
      ts.isImportSpecifier(node) &&
      (node.propertyName?.text ?? node.name.text) === 'createRequire'
    )
      factories.add(node.name.text);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      factories.has(node.initializer.expression.text)
    )
      requireNames.add(node.name.text);
    ts.forEachChild(node, findRequireBindings);
  }
  findRequireBindings(source);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
      result.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      result.push(node.arguments[0].text);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      requireNames.has(node.expression.text) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      result.push(node.arguments[0].text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      result.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

export function checkImport(file, specifier, { files, allowedModuleEdges }) {
  const errors = [];
  const owner = workspace(file);
  const inBrowser = file.startsWith('apps/web/src/');
  const prefix = '@sap-delivery-workbench/contracts/';
  if (
    inBrowser &&
    specifier.startsWith(prefix) &&
    !browserContracts.has(specifier.slice(prefix.length))
  )
    errors.push('Node-only contract entry is forbidden in browser code');
  if (
    inBrowser &&
    (specifier.startsWith('node:') || specifier.startsWith('@sap-delivery-workbench/api'))
  )
    errors.push('web cannot depend on api or Node runtime');
  if (owner === 'contracts' && specifier.startsWith('@sap-delivery-workbench/api'))
    errors.push('contracts cannot depend on api');
  if (['api', 'contracts'].includes(owner) && specifier.startsWith('@sap-delivery-workbench/web'))
    errors.push(`${owner} cannot depend on web`);
  if (!specifier.startsWith('.')) return errors;
  const target = path.normalize(path.join(path.dirname(file), specifier)).replace(/\/$/, '');
  const found = [
    target,
    target + '.ts',
    target + '.mjs',
    target + '.js',
    target + '.vue',
    target + '/index.ts',
  ].find((p) => files.has(p));
  if (!found) errors.push(`Missing local import: ${specifier}`);
  const targetOwner = workspace(target);
  if (inBrowser && (targetOwner === 'api' || /^(scripts|tests|tools|docs)\//.test(target)))
    errors.push('web cannot depend on api or engineering code');
  if (owner === 'api' && (targetOwner === 'web' || /^(scripts|tests|tools|docs)\//.test(target)))
    errors.push('api cannot depend on web, scripts, tests, tools or docs');
  if (owner === 'contracts' && /^(apps|scripts|tests|tools|docs)\//.test(target))
    errors.push('contracts cannot depend on application or engineering code');
  if (targetOwner && targetOwner !== owner && !file.startsWith('tests/'))
    errors.push('Cross-workspace imports must use public exports');
  const fromModule = moduleName(file),
    toModule = moduleName(target);
  if (
    agentModules.includes(fromModule) &&
    toModule &&
    toModule !== fromModule &&
    !/^apps\/api\/src\/modules\/[^/]+\/public\.mjs$/.test(target)
  )
    errors.push(`${fromModule} must use an explicit module public facade`);
  const fromFeature = featureName(file),
    toFeature = featureName(target);
  if (
    ['abap-fsd-agent', 'abap-dev-agent'].includes(fromFeature) &&
    ['abap-fsd-agent', 'abap-dev-agent'].includes(toFeature) &&
    fromFeature !== toFeature
  )
    errors.push('Assistant features share code through agent-workbench, not each other');
  if (
    fromModule &&
    toModule &&
    fromModule !== toModule &&
    !allowedModuleEdges.has(`${fromModule}->${toModule}`)
  )
    errors.push(`Unregistered module dependency: ${fromModule}->${toModule}`);
  return errors;
}

async function walk(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['node_modules', 'dist', '.git', '.runtime'].includes(entry.name)) continue;
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) files.push(...(await walk(resolve(directory, entry.name), name)));
    else files.push(name);
  }
  return files;
}

export function checkTestDiscovery(files) {
  const errors = [];
  for (const file of files) {
    if (file.endsWith('.spec.ts')) errors.push(`Playwright test not discovered: ${file}`);
    if (
      file.endsWith('.test.mjs') &&
      !/^tests\/(unit\/(api|web|contracts|tooling)|integration\/(api|database)|e2e)\//.test(file)
    )
      errors.push(`Node test not discovered: ${file}`);
  }
  return errors;
}

export async function checkRepository(directory = root) {
  const errors = [];
  const allowedRoots = new Set([
    'apps',
    'packages',
    'scripts',
    'tests',
    'database',
    'infra',
    'docs',
    'tools',
    'vendor',
    '.runtime',
    '.archify',
    '.git',
    '.vscode',
    'node_modules',
  ]);
  const allowedRootFiles = new Set([
    'AGENTS.md',
    'README.md',
    'package.json',
    'package-lock.json',
    'start.cmd',
    'stop.cmd',
    'compose.yaml',
    'sap-delivery-workbench.code-workspace',
    '.dockerignore',
    '.editorconfig',
    '.env',
    '.env.example',
    '.gitattributes',
    '.gitignore',
    '.nvmrc',
    '.prettierignore',
    '.prettierrc.json',
  ]);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() ? !allowedRoots.has(entry.name) : !allowedRootFiles.has(entry.name))
      errors.push(`Unregistered root entry: ${entry.name}`);
  }
  const list = await walk(directory),
    files = new Set(list);
  const config = JSON.parse(
    await readFile(resolve(directory, 'docs/architecture/module-dependencies.json'), 'utf8'),
  );
  const options = { files, allowedModuleEdges: new Set(config.allowedEdges) };
  const manifests = await Promise.all(
    ['', 'apps/web/', 'apps/api/', 'packages/contracts/'].map(async (dir) => [
      dir,
      JSON.parse(await readFile(resolve(directory, dir + 'package.json'), 'utf8')),
    ]),
  );
  const expected = ['apps/api', 'apps/web', 'packages/contracts'];
  if (JSON.stringify([...manifests[0][1].workspaces].sort()) !== JSON.stringify(expected))
    errors.push('Workspace list differs from directory contract');
  const sourcePaths = list.filter((file) => /^(apps\/[^/]+\/src|packages\/contracts)\//.test(file));
  const ignored = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: directory,
    input: sourcePaths.join('\n') + '\n',
    encoding: 'utf8',
    windowsHide: true,
  });
  if (ignored.status === 0)
    errors.push(`Product source excluded by Git ignore rules:\n${ignored.stdout.trim()}`);
  else if (ignored.status !== 1)
    errors.push('Cannot verify source tracking: git check-ignore failed');
  for (const file of list.filter(
    (p) => /^(apps|packages|scripts|tests|tools)\//.test(p) && /\.(mjs|cjs|js|ts|mts|vue)$/.test(p),
  )) {
    const content = await readFile(resolve(directory, file), 'utf8');
    for (const match of content.matchAll(/new URL\(\s*(['"])(\.[^'"]+)\1,\s*import\.meta\.url/g)) {
      const target = path.normalize(path.join(path.dirname(file), match[2])).replace(/\/$/, '');
      if (target === '.' || target === '.env' || target.startsWith('.runtime/')) continue;
      if (!existsSync(resolve(directory, target)))
        errors.push(`${file}: Missing static resource ${match[2]}`);
    }
    for (const spec of importsOf(file, content)) {
      errors.push(
        ...checkImport(file, spec, options).map((error) => `${file}: ${error} (${spec})`),
      );
      const manifest =
        manifests.find(([dir]) => dir && file.startsWith(dir))?.[1] ?? manifests[0][1];
      if (!/^(\.|\/|@\/|node:)/.test(spec)) {
        const name = spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0];
        if (
          !manifest.dependencies?.[name] &&
          !manifest.devDependencies?.[name] &&
          manifest.name !== name
        )
          errors.push(`${file}: Undeclared dependency ${name}`);
        const target = manifests.find(([, m]) => m.name === name);
        if (target) {
          const key = spec === name ? '.' : '.' + spec.slice(name.length);
          const exported = target[1].exports?.[key];
          if (typeof exported !== 'string' || !files.has(path.normalize(target[0] + exported)))
            errors.push(`${file}: Missing public export ${spec}`);
        }
      }
    }
    if (/^(apps|packages)\//.test(file) && /(?:\.\.\/)+(?:docs|tests)\//.test(content))
      errors.push(`${file}: Product resource depends on docs/tests`);
  }
  errors.push(
    ...checkTestDiscovery(
      list.filter((p) => p.startsWith('tests/') && /\.(?:test\.mjs|spec\.ts)$/.test(p)),
    ),
  );
  for (const file of list.filter((p) => /^(apps|packages|scripts|tools|infra)\//.test(p))) {
    const text = /\.(mjs|cjs|js|ts|mts|vue|json|ya?ml|sql|cmd)$/.test(file)
      ? await readFile(resolve(directory, file), 'utf8')
      : '';
    errors.push(...checkLegacy(file, text));
  }
  return errors;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const errors = await checkRepository();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      'Architecture contract verified: layout, imports, exports, dependencies and test ownership.',
    );
}
