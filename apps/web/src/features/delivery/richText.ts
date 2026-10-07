import DOMPurify from 'dompurify';
export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
export function safeRequirement(value: string, format = 'plain'): string {
  if (format !== 'html')
    return value
      .split(/\r?\n/)
      .map((line) => `<p>${escapeText(line) || '<br>'}</p>`)
      .join('');
  if (typeof window === 'undefined') return escapeText(value);
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      's',
      'u',
      'h2',
      'h3',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'hr',
    ],
    ALLOWED_ATTR: ['colspan', 'rowspan', 'start'],
  });
}
export function requirementText(value: string, format = 'plain'): string {
  if (format !== 'html') return value;
  const html = value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|li|h2|h3|tr|blockquote)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t');
  if (typeof window === 'undefined') return html.replace(/<[^>]*>/g, '');
  return (
    new DOMParser()
      .parseFromString(safeRequirement(html, 'html'), 'text/html')
      .body.textContent?.trim() ?? ''
  );
}
