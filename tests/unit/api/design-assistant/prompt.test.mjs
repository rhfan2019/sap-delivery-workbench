import test from 'node:test';
import assert from 'node:assert/strict';
import { structuredPrompt } from '../../../../apps/api/src/modules/design-assistant/model.mjs';

test('PROMPT-01 saved objects enter a structured prompt once, not again as the snapshot copy', () => {
  const objects = {
    'section-3': {
      object_id: 'section-3',
      section: 3,
      version: 1,
      content: 'MARKER-OBJECT-CONTENT',
    },
  };
  const { prompt } = structuredPrompt({
    kind: 'ChangeProposal',
    r: {
      assets: { prompt_text: 'system' },
      snapshot: {
        text: '需求',
        answers: {},
        base_objects: structuredClone(objects),
        base_evidence: [],
      },
      state: {},
      input_snapshot_id: 'snap',
    },
    t: { evidence: [], objects, target: { target_ref: 'no-sap', sap_disabled: true } },
    part: { group: { id: 'data', sections: [3, 6] }, draft: null },
  });
  assert.equal(prompt.split('MARKER-OBJECT-CONTENT').length - 1, 1);
  assert.ok(!prompt.includes('base_objects'));
});
