/** Renders an fsd-report/1 document in the delivered layout (Markdown). */
export function renderFsdMarkdown(doc: unknown): string;
/** id -> section number or field name used when the id is referenced as [[ID]]. */
export function referenceLabels(doc: unknown): Map<string, string>;
