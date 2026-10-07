import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { chromium } from 'playwright';
import { renderHtml } from './html.mjs';
export async function renderPdf(
  model,
  manifest,
  {
    executablePath = process.env.FS_CHROMIUM_PATH,
    fontName = process.env.FS_FONT_NAME,
    fontFile = process.env.FS_FONT_FILE,
  } = {},
) {
  if (!fontName || !fontFile || !isAbsolute(fontFile)) throw new Error('FONT_NOT_CONFIGURED');
  if (!executablePath || !isAbsolute(executablePath)) throw new Error('BROWSER_NOT_CONFIGURED');
  const font = await readFile(fontFile);
  if (font.length > 40000000) throw new Error('FONT_TOO_LARGE');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.route('**/*', (route) => route.abort());
    const html = renderHtml(model, manifest, { fontName: 'FsPinnedFont' }).replace(
      '</style>',
      `@font-face{font-family:FsPinnedFont;src:url(data:font/ttf;base64,${font.toString('base64')})}</style>`,
    );
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() =>
      [...document.fonts].every((font) => font.status === 'loaded'),
    );
    if (!loaded) throw new Error('FONT_LOAD_FAILED');
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 20000,
    });
  } finally {
    await browser.close();
  }
}
