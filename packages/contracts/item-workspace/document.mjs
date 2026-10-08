import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { validateSpecContract } from '../agent-runtime/fsd/v1/validate.mjs';
import { renderConsultantMarkdown as renderMarkdown } from '../agent-runtime/markdown.mjs';
export const schema = JSON.parse(
  readFileSync(new URL('./document.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv({ allErrors: true }).compile(schema);
export function validDocument(document, stage) {
  return (
    validate(document) &&
    document.kind === stage &&
    (stage !== 'design' || document.spec === null || validateSpecContract(document.spec).valid)
  );
}
export function renderDocument(d) {
  if (d.kind === 'design')
    return (
      (d.spec ? renderMarkdown(d.spec) : '# 设计工作稿\n\n### 2.1 权限设计\n\n') +
      (d.notes ? '\n\n## 工作备注\n\n' + d.notes : '')
    );
  return `# ${d.title}\n\n## 开发说明\n\n${d.overview}\n\n## 技术设计\n\n${d.technicalDesign}\n\n## 程序\n\n\`\`\`abap\n${d.code}\n\`\`\`\n\n## 测试方案（执行结果另行记录）\n\n${d.tests}\n\n## 工作备注\n\n${d.notes}`;
}
