import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
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
];
export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Stored rich text is sanitized on the server; the browser sanitizes again before rendering.
export function safeHtml(value: string): string {
  if (typeof window === 'undefined') return escapeText(value);
  return DOMPurify.sanitize(value, { ALLOWED_TAGS, ALLOWED_ATTR: ['colspan', 'rowspan', 'start'] });
}
