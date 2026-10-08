import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
export const parserVersion = 'pdfjs-text-v1';
const failed = (code) => ({
  state: 'failed',
  regions: [],
  unread_regions: [],
  warnings: [code],
  coverage: { total_pages: 0, read_pages: 0 },
});

export async function parsePdfBytes(bytes) {
  if (bytes.length > 5242880) return failed('FILE_TOO_LARGE');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let document, task;
  try {
    task = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      verbosity: 0,
    });
    document = await task.promise;
    if (document.numPages > 100) return failed('PAGE_LIMIT_EXCEEDED');
    const regions = [],
      unread = [],
      warnings = ['TABLE_LAYOUT_REQUIRES_REVIEW'];
    let characters = 0;
    for (let n = 1; n <= document.numPages; n++) {
      const locator = `page:${n}`;
      try {
        const page = await document.getPage(n),
          content = await page.getTextContent();
        const text = content.items
          .map((item) =>
            typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '',
          )
          .join('')
          .trim();
        characters += text.length;
        if (characters > 1000000) return failed('TEXT_BUDGET_EXCEEDED');
        if (!text) {
          unread.push(locator);
          if (!warnings.includes('OCR_UNAVAILABLE')) warnings.push('OCR_UNAVAILABLE');
        } else regions.push({ id: locator, locator, text, confidence: null, rows: [] });
        page.cleanup();
      } catch {
        unread.push(locator);
        warnings.push('PAGE_EXTRACTION_FAILED');
      }
    }
    return {
      state: unread.length ? (regions.length ? 'partial' : 'failed') : 'complete',
      regions,
      unread_regions: unread,
      warnings,
      coverage: { total_pages: document.numPages, read_pages: regions.length },
    };
  } catch {
    return failed('PDF_INVALID_OR_ENCRYPTED');
  } finally {
    await task?.destroy();
  }
}

// Production parsing runs outside the API process with time, memory and output limits.
export async function parseAttachment(path, { mime } = {}) {
  if (mime !== 'application/pdf') return failed('OCR_UNAVAILABLE');
  if ((await stat(path)).size > 5242880) return failed('FILE_TOO_LARGE');
  return new Promise((resolve) => {
    const child = fork(fileURLToPath(import.meta.url), ['--parse-child'], {
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
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };
    const timer = setTimeout(() => finish(failed('PARSER_TIMEOUT')), 20000);
    child.once('message', (result) => finish(result));
    child.once('error', () => finish(failed('PARSER_UNAVAILABLE')));
    child.once('exit', () => finish(failed('PARSER_PROCESS_FAILED')));
    child.send({ path });
  });
}
if (process.argv.includes('--parse-child'))
  process.once('message', async ({ path }) => {
    try {
      process.send(await parsePdfBytes(await readFile(path)));
    } catch {
      process.send(failed('PARSER_PROCESS_FAILED'));
    }
  });
