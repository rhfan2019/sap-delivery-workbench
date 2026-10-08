import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const registry = read('./registry.json');
export const CONTRACT_VERSION = registry.version;
export const schemas = Object.freeze(
  Object.fromEntries(registry.schemas.map((entry) => [entry.name, read(entry.path)])),
);
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats(ajv);
for (const schema of Object.values(schemas)) ajv.addSchema(schema);
// Compile all references eagerly: a broken offline registry fails at startup.
for (const schema of Object.values(schemas)) ajv.getSchema(schema.$id);

function validate(mapping, name, value) {
  const id = Object.hasOwn(mapping, name) ? mapping[name] : null;
  if (!id)
    return {
      ok: false,
      errors: [{ path: '', keyword: 'unknownContract', message: 'Unknown contract' }],
    };
  const validator = ajv.getSchema(id);
  const ok = validator(value);
  return {
    ok,
    errors: ok
      ? []
      : validator.errors.map((error) => ({
          path: error.instancePath,
          keyword: error.keyword,
          message: error.message,
        })),
  };
}

// L3 only. Success does not confer authorization, reference validity or approval.
export const validateProposal = (kind, value) => validate(registry.proposals, kind, value);
const changeValueDefinitions={requirement:'Proposal',rule:'Proposal',decision:'Proposal',issue:'Issue',verification_request:'VerificationRequest',section:'Section',block:'Block',test:'Test'};
export const validateChangeValue=(kind,value)=>validate(Object.fromEntries(Object.entries(changeValueDefinitions).map(([type,name])=>[type,schemas.ChangeSet.$id+'#/$defs/'+name])),kind,value);
export const validateCommand = (operationId, value) =>
  validate(registry.commands, operationId, value);
export const validateDomain = (kind, value) =>
  validate(
    Object.fromEntries(
      registry.schemas
        .filter((s) => s.path.startsWith('domain/') || s.path.startsWith('events/'))
        .map((s) => [s.name, s.id]),
    ),
    kind,
    value,
  );
