import { documentHash } from '../document/ast.mjs';

export function toRenderModel(document, template) {
  const slots = new Map(template.slots.map((slot, i) => [slot.stable_slot, i]));
  return {
    schema_version: '1.0.0',
    title: document.title,
    content_hash: documentHash(document, template),
    template_version: template.version,
    renderer_version: template.renderer_version,
    sections: structuredClone(document.sections).sort(
      (a, b) => (slots.get(a.template_slot) ?? Infinity) - (slots.get(b.template_slot) ?? Infinity),
    ),
    tests: structuredClone(document.tests),
    evidence_ids: [...document.evidence_manifest_ids],
  };
}
