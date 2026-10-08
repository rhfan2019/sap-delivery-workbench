import { MODEL_REQUEST_TIMEOUT_MS } from './runtime.mjs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { setTimeout as delay } from 'node:timers/promises';
import { requestModel } from './transport.mjs';
import { openKey } from './crypto.mjs';
export const STRUCTURED_ADAPTER_VERSION = 'structured-json-v1';

export function structuredPayload(config, schema, policy, input) {
  const common = { model: config.modelId };
  if (config.protocol === 'openai_responses')
    return {
      ...common,
      store: false,
      input: [
        { role: 'system', content: policy },
        { role: 'user', content: input },
      ],
      text: { format: { type: 'json_schema', name: 'fs_candidate', strict: true, schema } },
    };
  if (config.protocol === 'openai_chat')
    return {
      ...common,
      messages: [
        { role: 'system', content: policy },
        { role: 'user', content: input },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'fs_candidate', strict: true, schema },
      },
    };
  throw new Error('PROTOCOL_NOT_VERIFIED');
}
export function interpretStructured(protocol, data, schema) {
  let text;
  if (protocol === 'openai_responses') {
    if (data?.status === 'incomplete') throw new Error('OUTPUT_TRUNCATED');
    if (data?.status !== 'completed') throw new Error('PROVIDER_INCOMPLETE');
    if (data.output?.some((item) => item.type !== 'message' && item.type !== 'reasoning'))
      throw new Error('UNEXPECTED_TOOL_CALL');
    const parts =
      data.output
        ?.filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? []) ?? [];
    if (parts.some((part) => part.type === 'refusal')) throw new Error('MODEL_REFUSAL');
    if (parts.length !== 1 || parts[0].type !== 'output_text') throw new Error('OUTPUT_INVALID');
    text = parts[0].text;
  } else if (protocol === 'openai_chat') {
    const choice = data?.choices?.[0];
    if (choice?.message?.refusal) throw new Error('MODEL_REFUSAL');
    if (choice?.finish_reason !== 'stop') throw new Error('OUTPUT_TRUNCATED');
    if (choice.message.tool_calls?.length) throw new Error('UNEXPECTED_TOOL_CALL');
    text = choice.message.content;
  } else throw new Error('PROTOCOL_NOT_VERIFIED');
  if (typeof text !== 'string' || text.length > 1000000) throw new Error('OUTPUT_INVALID');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('JSON_INVALID');
  }
  const ajv = new Ajv({
    strict: true,
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
  });
  addFormats(ajv);
  if (!ajv.compile(schema)(value)) throw new Error('SCHEMA_INVALID');
  return value;
}
export async function inferStructured({
  db,
  organizationId,
  modelVersion,
  credentialRef,
  schema,
  input,
  policy,
  signal,
}) {
  const versionId = typeof modelVersion === 'string' ? modelVersion : modelVersion.versionId;
  const {
    rows: [row],
  } = await db.query(
    `SELECT v.config,v.credential_id,c.secret_cipher FROM app.llm_model_version v JOIN app.llm_model m ON m.id=v.model_id AND m.organization_id=v.organization_id JOIN app.llm_credential c ON c.id=v.credential_id AND c.organization_id=v.organization_id WHERE v.organization_id=$1 AND v.id=$2 AND m.deleted_at IS NULL`,
    [organizationId, versionId],
  );
  if (!row || row.credential_id !== credentialRef)
    throw new Error('MODEL_CONFIGURATION_UNAVAILABLE');
  const capability = await db.query(
    "SELECT 1 FROM (SELECT * FROM app.llm_test_run WHERE organization_id=$1 AND version_id=$2 AND adapter_version=$3 ORDER BY started_at DESC,id DESC LIMIT 1) latest WHERE status='passed' AND expires_at>clock_timestamp() AND capabilities @> '[\"structured_output\"]'::jsonb",
    [organizationId, versionId, STRUCTURED_ADAPTER_VERSION],
  );
  if (!capability.rowCount) throw new Error('MODEL_CAPABILITY_REQUIRED');
  const key = openKey(row.secret_cipher, organizationId, credentialRef),
    payload = structuredPayload(row.config, schema, policy, input);
  const deadline = AbortSignal.any([
    AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS),
    ...(signal ? [signal] : []),
  ]);
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await requestModel(row.config, key, payload, {
      signal: deadline,
      maxResponseBytes: 2000000,
    });
    if (result.status === 429 && attempt < 2) {
      const seconds = Math.min(5, Math.max(1, Number(result.retryAfter) || 2 ** attempt));
      await delay(seconds * 1000, undefined, { signal: deadline });
      continue;
    }
    if (result.status === 401 || result.status === 403) throw new Error('MODEL_AUTH_FAILED');
    if (result.status === 429) throw new Error('MODEL_RATE_LIMITED');
    if (result.status < 200 || result.status >= 300) throw new Error('MODEL_PROVIDER_ERROR');
    return {
      value: interpretStructured(row.config.protocol, result.data, schema),
      model_version_id: versionId,
      adapter_version: STRUCTURED_ADAPTER_VERSION,
    };
  }
}
