import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readTargetTool } from './sap.mjs';
import { hash, safeError, validateTool } from './policy.mjs';

export const capabilityIds = Array.from({ length: 7 }, (_, i) => `SAP-C0${i + 1}`);
// A transport observation is never an expert capability approval. Plans contain exact
// read arguments and expected coverage; credentials remain in the local environment.
export async function runCapabilityProbes(
  plan,
  { execute = false, env = process.env, read = readTargetTool } = {},
) {
  const target = plan?.target;
  let authorized = false;
  try {
    authorized =
      execute &&
      plan.approval?.approved_by &&
      Number.isFinite(Date.parse(plan.approval.approved_at)) &&
      target?.data_egress_approved === true &&
      ['DEV', 'QAS'].includes(target.environment) &&
      target.client === env.SAP_CLIENT &&
      target.origin === new URL(env.SAP_URL).origin &&
      !!env.SAP_USER &&
      !!env.SAP_PASSWORD;
  } catch {
    /* No configured target: report BLOCKED without connecting. */
  }
  const results = [];
  const budget = { calls: 0, max_calls: 60 };
  const overall = AbortSignal.timeout(900000);
  for (const id of capabilityIds) {
    const samples = plan?.probes?.filter((p) => p.capability_id === id) ?? [];
    const result = {
      id,
      status: 'BLOCKED',
      reason: !authorized ? 'APPROVED_TARGET_REQUIRED' : 'EXPERT_CAPABILITY_REVIEW_REQUIRED',
      observations: [],
    };
    if (authorized && samples.length > 0 && samples.length <= 8) {
      for (const sample of samples) {
        const generation = randomUUID();
        const started = performance.now();
        try {
          if (
            !Array.isArray(sample.item?.required_properties) ||
            sample.item.required_properties.some((p) => typeof p !== 'string')
          )
            throw Object.assign(new Error('INVALID_TOOL_INPUT'), { code: 'INVALID_TOOL_INPUT' });
          validateTool(sample.item, target);
          const evidence = await read(sample.item, {
            target,
            env,
            read_generation: generation,
            signal: AbortSignal.any([overall, AbortSignal.timeout(45000)]),
            beforeCall: async () => {
              if (budget.calls >= budget.max_calls)
                throw Object.assign(new Error('BUDGET_EXHAUSTED'), {
                  code: 'BUDGET_EXHAUSTED',
                  error_origin: 'SAP_ADAPTER',
                });
              budget.calls++;
            },
          });
          result.observations.push({
            outcome: 'READ_RETURNED',
            read_generation: generation,
            request_sha256: hash(sample.item),
            evidence_sha256: hash(evidence),
            source_version: evidence.source_version ? hash(evidence.source_version) : null,
            coverage: evidence.coverage,
            missing_properties: evidence.missing_properties,
            duration_ms: Math.round(performance.now() - started),
          });
        } catch (error) {
          result.observations.push({
            outcome: 'READ_FAILED',
            read_generation: generation,
            error: safeError(
              error.name === 'TimeoutError'
                ? { code: 'TIMEOUT', error_origin: 'SAP_ADAPTER' }
                : error,
            ),
            remote_outcome: error.name === 'TimeoutError' ? 'UNKNOWN' : null,
            duration_ms: Math.round(performance.now() - started),
          });
        }
      }
    } else if (authorized) result.reason = 'REPRESENTATIVE_READ_SAMPLES_REQUIRED';
    results.push(result);
  }
  return {
    version: 1,
    mode: execute ? 'REAL_PROBE_REQUESTED' : 'PLAN_ONLY',
    at: new Date().toISOString(),
    plan_sha256: hash(plan ?? {}),
    results,
    budget,
    limitation:
      'Read observations do not establish account isolation, denial behavior, dependency completeness, result TTL or remote timeout outcome. Review paired identities and server evidence before approving SAP-C01..07. No manifest is modified.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const planPath = process.env.FSD_PROBE_PLAN;
  const plan = planPath ? JSON.parse(await readFile(planPath, 'utf8')) : null;
  const result = await runCapabilityProbes(plan, { execute: process.argv.includes('--execute') });
  const directory = resolve('.runtime/artifacts/abap-backend-2026-10-08/sap-probes');
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, randomUUID() + '.json');
  await writeFile(file, JSON.stringify(result, null, 2) + '\n');
  console.log(
    JSON.stringify({
      file,
      statuses: result.results.map((r) => ({ id: r.id, status: r.status, reason: r.reason })),
    }),
  );
}
