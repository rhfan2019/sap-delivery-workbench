import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// The report framework the generated programs build on (decision section 4). The base
// class keeps its protected section because the local class inherits from it; the
// utilities and the exception are only called, so their public section is enough.
export const FRAMEWORK = [
  { name: 'YCL_FRH_REPORT', keepProtected: true },
  { name: 'YCL_FRH_UTIL_AUTH', keepProtected: false },
  { name: 'YCL_FRH_UTIL_LOGGER', keepProtected: false },
  { name: 'YCL_FRH_UTIL_TVARVC', keepProtected: false },
  { name: 'YCX_FRH_UTIL', keepProtected: false },
];

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map(); // `${system}:${client}` -> { at, classes }

export const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export function bundledSource(name) {
  return readFile(new URL(`./frameworks/${name.toLowerCase()}.abap`, import.meta.url), 'utf8');
}

// Cuts the class definition out of a full class source: from `CLASS x DEFINITION` to its
// ENDCLASS (or to the implementation when ENDCLASS is missing), without the private
// section, the protected section unless asked for, and without comment-only lines.
export function extractDefinition(source, { keepProtected = false } = {}) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^\s*class\s+\S+\s+definition\b/i.test(l));
  if (start < 0) return '';
  const out = [];
  let section = 'header';
  for (const line of lines.slice(start)) {
    if (/^\s*endclass\s*\./i.test(line) || /^\s*class\s+\S+\s+implementation\b/i.test(line)) break;
    const heading = /^\s*(public|protected|private)\s+section\s*\./i.exec(line);
    if (heading) section = heading[1].toLowerCase();
    if (section === 'private' || (section === 'protected' && !keepProtected)) continue;
    if (/^\*/.test(line) || !line.trim()) continue;
    out.push(line.replace(/\s+$/, ''));
  }
  return out.join('\n') + '\nENDCLASS.';
}

const classUrl = (name) => `/sap/bc/adt/oo/classes/${name.toLowerCase()}/source/main`;

// Loads every framework class: from the target SAP system when it has the class, otherwise
// from the bundled copy. Never throws; a class missing in a connected system is reported so
// the plan can tell the consultant to deploy the framework.
export async function loadFramework(sap, { read = bundledSource } = {}) {
  const key = sap.available ? `${sap.target.systemCode}:${sap.target.client}` : null;
  const hit = key && cache.get(key);
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.classes;
  const classes = [];
  for (const { name, keepProtected } of FRAMEWORK) {
    let source = null,
      origin = 'bundled';
    if (sap.available)
      try {
        source = (await sap.readSource(classUrl(name))).source;
        origin = 'sap';
      } catch {}
    if (!source?.trim()) {
      source = await read(name);
      origin = 'bundled';
    }
    classes.push({
      name,
      origin,
      missingInSap: sap.available && origin === 'bundled',
      digest: digest(source),
      definition: extractDefinition(source, { keepProtected }),
    });
  }
  if (key) cache.set(key, { at: Date.now(), classes });
  return classes;
}

// The "framework interface" section of the system context.
export function frameworkSection(classes) {
  const origin = (c) => (c.origin === 'sap' ? '目标系统' : '内置副本');
  const missing = classes.filter((c) => c.missingInSap).map((c) => c.name);
  return [
    '# 框架接口',
    '',
    '以下是报表框架各类的定义部分（基类含 PUBLIC 与 PROTECTED，其余类只含 PUBLIC），重定义与调用以此为准；行为与用法见开发类型规范。',
    '',
    classes.map((c) => `- ${c.name}：来自${origin(c)}`).join('\n'),
    missing.length
      ? `\n目标系统中读不到 ${missing.join('、')}，已用内置副本。开发方案 3.4 节必须写明：先在 SAP 中部署报表框架。`
      : '',
    '',
    ...classes.map((c) => '```abap\n' + c.definition + '\n```'),
  ].join('\n');
}
