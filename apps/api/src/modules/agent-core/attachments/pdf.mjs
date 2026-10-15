// PDF text extraction used by attachment parsing.
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
