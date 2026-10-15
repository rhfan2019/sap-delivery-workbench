import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { readFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePdfBytes } from './pdf.mjs';
export const parserVersion = 'fsd-material-v1';
const xmlText = (v) =>
  v === undefined ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v);
const richText = (v) =>
  typeof v === 'string'
    ? v
    : v?.t !== undefined
      ? xmlText(v.t)
      : array(v?.r)
          .map((r) => xmlText(r.t))
          .join('');
const array = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const fail = (message) => ({ state: 'failed', parserVersion, regions: [], warnings: [message] });
function xml(t, ordered = false) {
  if (/<!DOCTYPE|<!ENTITY/i.test(t) || XMLValidator.validate(t) !== true)
    throw Error('XML格式无效或包含实体声明');
  return new XMLParser({
    ignoreAttributes: false,
    preserveOrder: ordered,
    parseTagValue: false,
    processEntities: true,
  }).parse(t);
}
export async function extractBytes(name, bytes) {
  try {
    if (!bytes.length) return fail('空文件，未读取');
    if (bytes.length > 20 * 1024 * 1024) return fail('单文件超过20MB');
    const ext = name.split('.').pop().toLowerCase();
    const regions = [],
      warnings = [];
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'].includes(ext))
      return {
        state: 'preview_only',
        parserVersion,
        regions: [],
        warnings: ['当前未配置并验证图片传输/OCR能力，仅可本地预览，未发送给模型'],
      };
    if (['doc', 'xls'].includes(ext)) return fail('旧版Office格式不支持，请另存为DOCX/XLSX');
    if (['txt', 'md', 'csv', 'json', 'xml', 'log', 'abap', 'yaml', 'yml'].includes(ext)) {
      const t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (t.includes('\0')) throw Error('非UTF-8文本');
      regions.push({ locator: 'lines:1-' + t.split('\n').length, text: t });
    } else if (ext === 'pdf') {
      if (bytes.subarray(0, 5).toString() !== '%PDF-') return fail('PDF签名无效');
      const r = await parsePdfBytes(bytes);
      if (r.state === 'failed') return fail(r.warnings.join('；'));
      regions.push(...r.regions.map((x) => ({ locator: x.locator, text: x.text })));
      warnings.push(...r.warnings, ...r.unread_regions.map((x) => x + '未读取，需OCR'));
    } else if (['docx', 'xlsx'].includes(ext)) {
      if (bytes.subarray(0, 2).toString() !== 'PK') return fail('Office文件签名无效');
      const z = await JSZip.loadAsync(bytes);
      const files = Object.values(z.files);
      if (files.length > 1000) throw Error('ZIP条目超过1000');
      let size = 0;
      for (const f of files) {
        size += f._data?.uncompressedSize ?? 0;
        if (size > 16 * 1024 * 1024 || (f._data?.uncompressedSize ?? 0) > 8 * 1024 * 1024)
          throw Error('Office解压资源超限，请拆分文件');
      }
      const read = async (p) => {
        const f = z.file(p);
        if (!f) throw Error('Office必需部件缺失：' + p);
        return f.async('string');
      };
      if (ext === 'docx') {
        const root = xml(await read('word/document.xml'), true);
        let paragraph = 0,
          table = 0;
        const collect = (v) =>
          array(v)
            .map((n) =>
              Object.entries(n)
                .map(([k, x]) =>
                  k === 'w:t'
                    ? array(x)
                        .map((y) => y['#text'] ?? '')
                        .join('')
                    : k === 'w:tab'
                      ? '\t'
                      : k === 'w:br'
                        ? '\n'
                        : k !== ':@' && Array.isArray(x)
                          ? collect(x)
                          : '',
                )
                .join(''),
            )
            .join('');
        function walk(nodes, loc = 'body') {
          for (const n of array(nodes))
            for (const [k, v] of Object.entries(n)) {
              if (k === 'w:tbl') {
                const t = ++table;
                let row = 0;
                for (const tr of v.filter((n) => n['w:tr'])) {
                  row++;
                  let col = 0;
                  for (const tc of tr['w:tr'].filter((n) => n['w:tc']))
                    regions.push({
                      locator: `table:${t}/row:${row}/cell:${++col}`,
                      text: collect(tc['w:tc']),
                    });
                }
              } else if (k === 'w:p')
                regions.push({ locator: `${loc}/paragraph:${++paragraph}`, text: collect(v) });
              else if (Array.isArray(v)) walk(v, loc);
            }
        }
        walk(root);
        warnings.push('DOCX正文段落与表格；页眉页脚、批注、图片、文本框未提取');
      } else {
        const book = xml(await read('xl/workbook.xml')),
          rels = xml(await read('xl/_rels/workbook.xml.rels'));
        const ss = z.file('xl/sharedStrings.xml') ? xml(await read('xl/sharedStrings.xml')) : {};
        const strings = array(ss.sst?.si).map((s) => richText(s));
        let cells = 0;
        for (const sheet of array(book.workbook?.sheets?.sheet)) {
          const rel = array(rels.Relationships?.Relationship).find(
            (r) => r['@_Id'] === sheet['@_r:id'],
          );
          if (!rel || rel['@_TargetMode'] === 'External') throw Error('无效或外部工作表关系');
          const target = rel['@_Target'];
          if (typeof target !== 'string' || target.includes('..') || target.includes('\\'))
            throw Error('工作表路径无效');
          const p = target.startsWith('/xl/') ? target.slice(1) : 'xl/' + target.replace(/^\//, '');
          const data = xml(await read(p));
          for (const row of array(data.worksheet?.sheetData?.row))
            for (const cell of array(row.c)) {
              if (++cells > 3000) throw Error('工作表超过3000单元格，请选段另存后上传');
              const cached =
                cell['@_t'] === 's'
                  ? strings[Number(cell.v)]
                  : cell['@_t'] === 'inlineStr'
                    ? richText(cell.is)
                    : (cell.v ?? '');
              regions.push({
                locator: `sheet:${sheet['@_name']}!${cell['@_r']}`,
                text:
                  cell.f !== undefined
                    ? `公式=${typeof cell.f === 'object' ? (cell.f['#text'] ?? '共享公式') : cell.f}；缓存=${cached || '缺失（未计算）'}`
                    : String(cached),
              });
            }
        }
        warnings.push(
          '读取单元格原始值及公式缓存；未计算公式，未应用日期/数字显示格式，未读取图表/图片',
        );
      }
    } else return fail('此格式尚不支持文本提取；HTML/SVG不能作为活动内容上传');
    const nonempty = regions.filter((r) => r.text.trim());
    if (!nonempty.length) return fail('未取得文本，扫描件或图片需OCR');
    if (nonempty.reduce((n, r) => n + r.text.length, 0) > 200000)
      return fail('提取文本超过20万字符，请按页/工作表选段另存后上传');
    return {
      state: 'ready',
      parserVersion,
      regions: nonempty,
      warnings,
      coverage: {
        regions: nonempty.length,
        characters: nonempty.reduce((n, r) => n + r.text.length, 0),
      },
    };
  } catch (e) {
    return fail(
      e.message === 'Invalid PDF structure.' ? 'PDF损坏' : String(e.message).slice(0, 200),
    );
  }
}
export function parseFile(path, name) {
  return new Promise((resolve) => {
    const child = fork(fileURLToPath(import.meta.url), ['--agent-parse'], {
      execArgv: ['--max-old-space-size=192'],
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        SystemRoot: process.env.SystemRoot ?? '',
        TEMP: process.env.TEMP ?? '',
        TMP: process.env.TMP ?? '',
      },
    });
    let settled = false;
    const end = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(r);
    };
    const timer = setTimeout(() => end(fail('解析超过20秒，请拆分文件')), 20000);
    child.once('message', end);
    child.once('error', () => end(fail('解析进程不可用')));
    child.once('exit', () => end(fail('解析失败或资源超限')));
    child.send({ path, name });
  });
}
if (process.argv.includes('--agent-parse'))
  process.once('message', async ({ path, name }) => {
    try {
      process.send(await extractBytes(name, await readFile(path)));
    } catch {
      process.send(fail('文件读取失败'));
    }
  });
