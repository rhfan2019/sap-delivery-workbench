export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
export const watermarkLabel = (policy) =>
  ({
    discussion: '讨论稿 · 未批准',
    approved: '已批准版本',
    superseded: '历史版本 · 已替代',
    withdrawn: '已撤回',
    legacy_submission: '历史提交 · 非新流程批准',
  })[policy] ?? '讨论稿 · 未批准';
export function renderHtml(model, manifest, { fontName = 'sans-serif' } = {}) {
  const e = escapeHtml;
  const paragraphs = model.sections
    .map(
      (section) =>
        `<section><h2>${e(section.title)}</h2>${section.blocks
          .map((block) => {
            const content =
              block.kind === 'table'
                ? `<table><thead><tr>${block.columns.map((c) => `<th>${e(c)}</th>`).join('')}</tr></thead><tbody>${block.rows.map((r) => `<tr>${r.cells.map((c) => `<td>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
                : `<p>${e(block.text)}</p>`;
            return `${block.classification === 'pending' ? '<p class="pending">待确认</p>' : ''}${content}${block.evidence_refs.map((ref) => `<p class="reference">来源 ${e(ref.locator)}：${e(ref.conclusion)} [${e(ref.evidence_id)}]</p>`).join('')}`;
          })
          .join('')}</section>`,
    )
    .join('');
  const tests = model.tests
    .map(
      (t) =>
        `<section><h3>${e(t.title)}</h3><p>前提：${e(t.preconditions.join('\n'))}</p><p>步骤：${e(t.steps.join('\n'))}</p><p>预期：${e(t.expected.join('\n'))}</p></section>`,
    )
    .join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:"><style>@page{size:A4;margin:22mm 18mm;@top-left{content:"${e(watermarkLabel(manifest.watermark_policy))}";font-family:"${e(fontName)}",sans-serif;font-size:9pt;color:#6b4216}}body{font-family:"${e(fontName)}",sans-serif;font-size:11pt;line-height:1.65;color:#182c43}h1{font-size:22pt}h2{font-size:16pt;border-bottom:1px solid #9aaabd;padding-bottom:6pt;break-after:avoid}h3{break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #8997a8;padding:6pt;overflow-wrap:anywhere;vertical-align:top}.watermark,.pending{color:#6b4216}.reference{font-size:9pt;color:#435266}</style></head><body><p class="watermark">${e(watermarkLabel(manifest.watermark_policy))}</p><h1>${e(model.title)}</h1><p class="reference">固定版本：${e(manifest.document_version_id)}<br>内容哈希：${e(model.content_hash)}</p>${paragraphs}${tests ? '<h2>测试场景</h2>' + tests : ''}<h2>证据索引</h2><p>${e(model.evidence_ids.join('\n') || '暂无证据')}</p></body></html>`;
}
