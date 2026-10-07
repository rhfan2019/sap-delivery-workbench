import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Inspect model-message content expressions, not UI messages or database literals.
const files = [
  'context.mjs',
  'specification.mjs',
  'generation.mjs',
  'executor.mjs',
  'routes.mjs',
  'design-loop.mjs',
].map((f) => 'apps/api/src/abap-fsd-agent/' + f);
files.push('apps/api/src/item-workspace/agent.mjs');
const violations = [];
for (const file of files) {
  const text = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function inspectExpression(node) {
    if (ts.isCallExpression(node)) return; // Calls select MD templates or serialize data.
    if (ts.isConditionalExpression(node)) {
      inspectExpression(node.whenTrue);
      inspectExpression(node.whenFalse);
      return;
    }
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateTail(node) ||
        ts.isTemplateMiddle(node)) &&
      node.text.trim()
    ) {
      violations.push(file + ':' + (source.getLineAndCharacterOfPosition(node.pos).line + 1));
    }
    ts.forEachChild(node, inspectExpression);
  }
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'content')
      inspectExpression(node.initializer);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'content'
    )
      inspectExpression(node.right);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (violations.length) {
  console.error('Embedded model-message text must move to Markdown: ' + violations.join(', '));
  process.exitCode = 1;
} else console.log('FSD model-message prose check passed (' + files.length + ' files).');
