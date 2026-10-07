import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  Footer,
  PageNumber,
} from 'docx';
import { watermarkLabel } from './html.mjs';
export async function renderDocx(model, manifest, { fontName } = {}) {
  if (!fontName) throw new Error('FONT_NOT_CONFIGURED');
  const paragraph = (text) =>
    new Paragraph({
      children: [new TextRun({ text: String(text ?? '') })],
      spacing: { after: 120 },
    });
  const children = [
    paragraph(watermarkLabel(manifest.watermark_policy)),
    new Paragraph({ text: model.title, heading: HeadingLevel.TITLE }),
    paragraph('固定版本：' + manifest.document_version_id),
    paragraph('内容哈希：' + model.content_hash),
  ];
  for (const section of model.sections) {
    children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }));
    for (const block of section.blocks) {
      if (block.classification === 'pending') children.push(paragraph('待确认'));
      if (block.kind === 'table')
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: block.columns.map(
                  (text) => new TableCell({ children: [paragraph(text)] }),
                ),
              }),
              ...block.rows.map(
                (row) =>
                  new TableRow({
                    cantSplit: true,
                    children: row.cells.map(
                      (text) => new TableCell({ children: [paragraph(text)] }),
                    ),
                  }),
              ),
            ],
          }),
        );
      else for (const line of (block.text ?? '').split('\n')) children.push(paragraph(line));
      for (const ref of block.evidence_refs)
        children.push(paragraph(`来源 ${ref.locator}：${ref.conclusion} [${ref.evidence_id}]`));
    }
  }
  for (const scenario of model.tests) {
    children.push(
      new Paragraph({ text: scenario.title, heading: HeadingLevel.HEADING_2 }),
      paragraph('前提：' + scenario.preconditions.join('\n')),
      paragraph('步骤：' + scenario.steps.join('\n')),
      paragraph('预期：' + scenario.expected.join('\n')),
    );
  }
  children.push(
    new Paragraph({ text: '证据索引', heading: HeadingLevel.HEADING_1 }),
    paragraph(model.evidence_ids.join('\n') || '暂无证据'),
  );
  const document = new Document({
    styles: {
      default: {
        document: { run: { font: fontName, size: 22 }, paragraph: { spacing: { line: 320 } } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1247, bottom: 1247, left: 1020, right: 1020 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun(watermarkLabel(manifest.watermark_policy) + ' · '),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}
