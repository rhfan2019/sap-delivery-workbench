import test from 'node:test';
import assert from 'node:assert/strict';
import { runCapabilityProbes } from '../../../../apps/api/src/modules/design-assistant/probe.mjs';

test('SAP-C01..07 missing approval never connects and retains seven blockers', async () => {
  const result = await runCapabilityProbes(null, {
    execute: true,
    env: {},
    read: () => assert.fail('must not connect'),
  });
  assert.equal(result.results.length, 7);
  assert.ok(result.results.every((r) => r.status === 'BLOCKED' && !r.observations.length));
});
test('SAP-C probes execute only exact read samples, redact data, and never auto-approve', async () => {
  const env = {
    SAP_URL: 'https://sap.invalid',
    SAP_CLIENT: '000',
    SAP_USER: 'test',
    SAP_PASSWORD: 'SECRET',
  };
  const plan = {
    approval: { approved_by: 'operator', approved_at: new Date().toISOString() },
    target: {
      target_ref: 't',
      origin: env.SAP_URL,
      client: '000',
      data_egress_approved: true,
      environment: 'DEV',
    },
    probes: [
      {
        capability_id: 'SAP-C02',
        item: {
          target_ref: 't',
          tool_name: 'searchObject',
          arguments: { query: 'ZPOC' },
          required_properties: [],
        },
      },
      {
        capability_id: 'SAP-C07',
        item: { target_ref: 't', tool_name: 'activate', arguments: {}, required_properties: [] },
      },
    ],
  };
  let calls = 0;
  const result = await runCapabilityProbes(plan, {
    execute: true,
    env,
    read: async () => {
      calls++;
      return {
        data: 'SECRET BUSINESS',
        source_version: 'v1',
        coverage: { complete: true, properties: [] },
        missing_properties: [],
      };
    },
  });
  assert.equal(calls, 1);
  assert.ok(result.results.every((r) => r.status === 'BLOCKED'));
  assert.equal(result.results[6].observations[0].error.code, 'TOOL_DENIED');
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  await runCapabilityProbes(plan, { execute: false, env, read: () => assert.fail('plan only') });
});
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registeredTarget } from '../../../../apps/api/src/modules/design-assistant/sap.mjs';
import { hash } from '../../../../apps/api/src/modules/design-assistant/policy.mjs';
test('SAP capability approval binds verified file hashes to exact deployment and target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fsd-probe-')),
    prior = process.env.FSD_TARGET_MANIFEST;
  try {
    const target = {
      target_ref: 't',
      organization_id: 'o',
      project_id: 'p',
      system_id: 's',
      client: '000',
      environment: 'DEV',
      deployment_version: 'v1',
      data_egress_approved: true,
      capabilities: [],
    };
    for (let n = 1; n <= 7; n++) {
      const id = 'SAP-C0' + n,
        body = JSON.stringify({
          capability_id: id,
          target_ref: 't',
          system_id: 's',
          client: '000',
          deployment_version: 'v1',
          status: 'PASS',
          approved_by: 'reviewer',
          observed_at: new Date().toISOString(),
        });
      await writeFile(join(dir, id + '.json'), body);
      target.capabilities.push({
        id,
        status: 'PASS',
        approved_by: 'reviewer',
        evidence_ref: id + '.json',
        evidence_sha256: hash(body),
      });
    }
    process.env.FSD_TARGET_MANIFEST = join(dir, 'manifest.json');
    await writeFile(process.env.FSD_TARGET_MANIFEST, JSON.stringify({ targets: [target] }));
    assert.equal(
      (await registeredTarget({ organizationId: 'o', projectId: 'p' }, 't')).client,
      '000',
    );
    await writeFile(join(dir, 'SAP-C01.json'), '{}');
    await assert.rejects(() => registeredTarget({ organizationId: 'o', projectId: 'p' }, 't'), {
      code: 'SAP_CAPABILITY_UNVERIFIED',
    });
  } finally {
    if (prior === undefined) delete process.env.FSD_TARGET_MANIFEST;
    else process.env.FSD_TARGET_MANIFEST = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
import { readTargetTool } from '../../../../apps/api/src/modules/design-assistant/sap.mjs';
test('SAP probe absolute timeout releases caller and closes a late connection without calling it', async () => {
  const controller = new AbortController();
  let release,
    closed = 0,
    calls = 0;
  const pending = new Promise((r) => (release = r));
  const running = readTargetTool(
    {
      target_ref: 't',
      tool_name: 'searchObject',
      arguments: { query: 'ZPOC' },
      required_properties: [],
    },
    {
      target: { target_ref: 't' },
      read_generation: 'g',
      signal: controller.signal,
      env: {},
      connect: () => pending,
    },
  );
  controller.abort(new DOMException('deadline', 'TimeoutError'));
  await assert.rejects(running, { name: 'TimeoutError' });
  release({
    close: async () => {
      closed++;
    },
    call: async () => {
      calls++;
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, 1);
  assert.equal(calls, 0);
});
test('SAP probe physical page budget applies across all representative samples', async () => {
  const env = {
    SAP_URL: 'https://sap.invalid',
    SAP_CLIENT: '000',
    SAP_USER: 'test',
    SAP_PASSWORD: 'local',
  };
  const plan = {
    approval: { approved_by: 'operator', approved_at: new Date().toISOString() },
    target: {
      target_ref: 't',
      origin: env.SAP_URL,
      client: '000',
      data_egress_approved: true,
      environment: 'DEV',
    },
    probes: [
      {
        capability_id: 'SAP-C06',
        item: {
          target_ref: 't',
          tool_name: 'searchObject',
          arguments: { query: 'ZPOC' },
          required_properties: [],
        },
      },
    ],
  };
  let calls = 0;
  const envelope = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const result = await runCapabilityProbes(plan, {
    execute: true,
    env,
    read: (item, options) =>
      readTargetTool(item, {
        ...options,
        connect: async () => ({
          tools: [{ name: 'searchObject' }, { name: 'readResultPage' }],
          close: async () => {},
          call: async () => {
            const offset = calls++;
            return envelope({
              status: 'paged',
              resultId: 'r',
              totalCharacters: 100,
              offset,
              page: 'x',
              nextOffset: offset + 1,
            });
          },
        }),
      }),
  });
  assert.equal(calls, 60);
  assert.equal(result.budget.calls, 60);
  assert.equal(result.results[5].observations[0].error.code, 'BUDGET_EXHAUSTED');
});
