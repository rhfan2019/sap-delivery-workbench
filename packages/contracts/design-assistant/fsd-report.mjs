// Node validation entry for the fsd-report/1 content model (reads the schema file).
// Browser code uses fsd-report-refs.mjs instead.
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { checkReferences } from './fsd-report-refs.mjs';

export {
  FSD_REPORT_VERSION,
  RESERVED_SECTIONS,
  collectObjectIds,
  findReferences,
  checkReferences,
  collectSapRefs,
} from './fsd-report-refs.mjs';

export const fsdReportSchema = Object.freeze(
  JSON.parse(readFileSync(new URL('./fsd-report.schema.json', import.meta.url), 'utf8')),
);

const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false });
addFormats(ajv);
const validateSchema = ajv.compile(fsdReportSchema);

/**
 * Full check of a stored FSD: JSON Schema first, then reference closure.
 * Errors: { path, keyword, message }; keywords dangling/duplicate/reserved come from the
 * reference check, which only runs once the shape is valid.
 */
export function validateFsdReport(doc) {
  if (!validateSchema(doc))
    return {
      ok: false,
      errors: validateSchema.errors.map((e) => ({
        path: e.instancePath,
        keyword: e.keyword,
        // Repair prompts quote these messages; the allowed values are what the model needs.
        message: e.params?.allowedValues
          ? `${e.message}: ${e.params.allowedValues.join(' / ')}`
          : e.message,
      })),
    };
  const refs = checkReferences(doc);
  const errors = [
    ...refs.dangling.map((r) => ({
      path: r.path,
      keyword: 'dangling',
      message: `unknown reference ${r.id}`,
    })),
    ...refs.duplicates.map((d) => ({
      path: d.path,
      keyword: 'duplicate',
      message: `duplicate id ${d.id}, first at ${d.first}`,
    })),
    ...refs.redefined.map((d) => ({
      path: d.path,
      keyword: 'reserved',
      message: `reserved id ${d.id} cannot be defined`,
    })),
  ];
  return { ok: !errors.length, errors };
}
