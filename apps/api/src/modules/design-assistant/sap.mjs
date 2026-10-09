import { readFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { connectMcp, resolveReadEnvironment } from '../sap/public.mjs';
import { fault, validateTool, hash, ddicTableUrl } from './policy.mjs';
export async function registeredTarget(scope, targetRef) {
  if (!process.env.FSD_TARGET_MANIFEST)
    throw fault('SAP_CAPABILITY_UNVERIFIED', 'SAP_ADAPTER', 409);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(process.env.FSD_TARGET_MANIFEST, 'utf8'));
  } catch {
    throw fault('INVALID_TARGET_MANIFEST', 'SAP_ADAPTER', 409);
  }
  const scoped =
    manifest.targets?.filter(
      (t) => t.organization_id === scope.organizationId && t.project_id === scope.projectId,
    ) ?? [];
  if (!targetRef && scoped.length === 1) targetRef = scoped[0].target_ref;
  const target = manifest.targets?.find(
    (t) =>
      t.target_ref === targetRef &&
      t.organization_id === scope.organizationId &&
      t.project_id === scope.projectId,
  );
  if (
    !Array.from({ length: 7 }, (_, i) => 'SAP-C' + String(i + 1).padStart(2, '0')).every((id) =>
      target?.capabilities?.some(
        (c) =>
          c.id === id &&
          (c.status === 'PASS' || (c.status === 'NOT_APPLICABLE' && c.reason && c.approved_by)),
      ),
    )
  )
    throw fault('SAP_CAPABILITY_UNVERIFIED', 'SAP_ADAPTER', 409);
  if (
    !target ||
    target.data_egress_approved !== true ||
    !['DEV', 'QAS'].includes(target.environment) ||
    !target.client ||
    !target.system_id ||
    !target.deployment_version ||
    !Array.isArray(target.capabilities) ||
    !target.capabilities.every(
      (c) => c.status === 'PASS' || (c.status === 'NOT_APPLICABLE' && c.reason),
    )
  )
    throw fault('SAP_CAPABILITY_UNVERIFIED', 'SAP_ADAPTER', 409);
  for (const capability of target.capabilities) {
    if (capability.status !== 'PASS') continue;
    const root = dirname(resolve(process.env.FSD_TARGET_MANIFEST));
    if (
      !capability.approved_by ||
      typeof capability.evidence_ref !== 'string' ||
      !/^[a-f0-9]{64}$/.test(capability.evidence_sha256 ?? '')
    )
      throw fault('SAP_CAPABILITY_UNVERIFIED', 'SAP_ADAPTER', 409);
    const file = resolve(root, capability.evidence_ref),
      rel = relative(root, file);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../'))
      throw fault('SAP_CAPABILITY_UNVERIFIED', 'SAP_ADAPTER', 409);
    try {
      const content = await readFile(file, 'utf8'),
        evidence = JSON.parse(content);
      if (
        hash(content) !== capability.evidence_sha256 ||
        evidence.capability_id !== capability.id ||
        evidence.target_ref !== target.target_ref ||
        evidence.client !== target.client ||
        evidence.system_id !== target.system_id ||
        evidence.deployment_version !== target.deployment_version ||
        evidence.status !== 'PASS' ||
        evidence.approved_by !== capability.approved_by ||
        !Number.isFinite(Date.parse(evidence.observed_at))
      )
        throw Error('unverified');
    } catch {
      throw fault('SAP_CAPABILITY_UNVERIFIED', 'SAP_ADAPTER', 409);
    }
  }
  return { ...target, manifest_hash: hash(target) };
}
function decode(envelope) {
  if (envelope?.isError) throw fault('UNKNOWN_CAUSE', 'SAP_REMOTE');
  if (envelope?.content?.length !== 1 || envelope.content[0].type !== 'text')
    throw fault('PARTIAL_RESULT', 'SAP_ADAPTER');
  let result;
  try {
    result = JSON.parse(envelope.content[0].text);
  } catch {
    throw fault('PARTIAL_RESULT', 'SAP_ADAPTER');
  }
  if (result?.status === 'error') {
    const code = [
      'AUTH_DENIED',
      'UNSUPPORTED',
      'RATE_LIMIT',
      'BUSY',
      'CONNECTION_ERROR',
      'RESULT_EXPIRED',
    ].includes(result.error?.code)
      ? result.error.code
      : 'UNKNOWN_CAUSE';
    throw Object.assign(fault(code, 'SAP_REMOTE'), {
      retry_after_ms: Number.isFinite(result.error?.retry_after_ms)
        ? Math.min(1000, Math.max(0, result.error.retry_after_ms))
        : null,
    });
  }
  return result;
}
export async function collectPages(
  envelope,
  call,
  { readGeneration, onPage = async (_page, read) => read() } = {},
) {
  let value = decode(envelope);
  if (value.status !== 'paged') return value;
  const id = value.resultId,
    total = value.totalCharacters;
  let offset = 0,
    text = '',
    pages = 0;
  if (!id || !Number.isSafeInteger(total) || total < 1 || total > 4 * 1024 * 1024)
    throw fault('PARTIAL_RESULT', 'SAP_ADAPTER');
  try {
    while (true) {
      if (
        ++pages > 300 ||
        value.resultId !== id ||
        value.offset !== offset ||
        typeof value.page !== 'string' ||
        !value.page.length ||
        (value.read_generation && value.read_generation !== readGeneration)
      )
        throw fault('RESULT_EXPIRED', 'SAP_ADAPTER');
      text += value.page;
      offset = text.length;
      if (offset > total) throw fault('PARTIAL_RESULT', 'SAP_ADAPTER');
      if (value.nextOffset === null) break;
      if (value.nextOffset !== offset) throw fault('RESULT_EXPIRED', 'SAP_ADAPTER');
      value = decode(
        await onPage({ result_id: id, offset, read_generation: readGeneration }, () =>
          call('readResultPage', { resultId: id, offset }),
        ),
      );
    }
    if (text.length !== total) throw fault('PARTIAL_RESULT', 'SAP_ADAPTER');
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw fault('PARTIAL_RESULT', 'SAP_ADAPTER');
    }
    return result.content ? decode(result) : result;
  } catch (error) {
    error.read_progress = {
      received_characters: Math.min(offset, total),
      expected_characters: total,
    };
    throw error;
  }
}
export function configuredTool(pool, scope) {
  return async (item, { target, read_generation, signal, onPage }) => {
    validateTool(item, target);
    const approved = await registeredTarget(scope, target.target_ref);
    if (approved.manifest_hash !== target.manifest_hash)
      throw fault('COMPATIBILITY', 'SAP_ADAPTER');
    const env = await resolveReadEnvironment(pool, scope, target);
    return readTargetTool(item, { target, read_generation, signal, onPage, env });
  };
}
// Internal read transport shared by runtime and the explicitly invoked capability probe.
// The runtime always checks registeredTarget first; the probe records observations, never approval.
export async function readTargetTool(
  item,
  {
    target,
    read_generation,
    signal,
    onPage,
    env,
    connect = connectMcp,
    beforeCall = async () => {},
  },
) {
  validateTool(item, target);
  signal.throwIfAborted();
  let connection;
  const abort = () => {
    void connection?.close().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const connecting = connect(env);
    // A connection arriving after the caller timed out must never become a live session.
    void connecting.then(
      (c) => {
        if (signal.aborted) void c.close().catch(() => {});
      },
      () => {},
    );
    connection = await deadline(() => connecting, signal);
    signal.throwIfAborted();
    let name = item.tool_name,
      args = item.arguments;
    if (name === 'configurationTemplate') {
      const template = target.templates?.[args.template_id];
      if (!template || Object.keys(args.filters ?? {}).length)
        throw fault('INVALID_TOOL_INPUT', 'SAP_ADAPTER');
      if (
        typeof template.sql !== 'string' ||
        !/^\s*SELECT\b/i.test(template.sql) ||
        /;|--|\/\*|\b(INSERT|UPDATE|DELETE|MODIFY|DROP|ALTER|EXEC|CALL)\b/i.test(template.sql)
      )
        throw fault('TOOL_DENIED', 'SAP_ADAPTER');
      // Fixed server-reviewed SQL only, never interpolation of model data.
      name = 'runQuery';
      args = {
        sqlQuery: template.sql,
        rowNumber: Math.min(template.max_rows ?? 100, 100),
        decode: true,
      };
    }
    if (!connection.tools.some((t) => t.name === name)) throw fault('UNSUPPORTED', 'SAP_ADAPTER');
    const call = async (tool, parameters) => {
      signal.throwIfAborted();
      await beforeCall();
      return deadline(() => connection.call(tool, parameters), signal);
    };
    const result = await collectPages(await call(name, args), call, {
      readGeneration: read_generation,
      onPage,
    });
    // DDIC element reads carry no version; take the active version stamp from the
    // object's ADT metadata so the evidence can be checked for staleness.
    if (
      name === 'ddicElement' &&
      !result.source_version &&
      connection.tools.some((t) => t.name === 'objectStructure')
    ) {
      const url = args.path.startsWith('/sap/') ? args.path : ddicTableUrl(args.path);
      result.source_version = adtVersion(
        await collectPages(await call('objectStructure', { objectUrl: url }), call, {
          readGeneration: read_generation,
        }),
      );
    }
    result.source_version ??= adtVersion(result);
    return normalizeToolResult(result, item, target, read_generation);
  } finally {
    signal.removeEventListener('abort', abort);
    if (connection)
      await deadline(
        () => connection.close(),
        signal.aborted
          ? AbortSignal.timeout(1)
          : AbortSignal.any([signal, AbortSignal.timeout(1000)]),
      ).catch(() => {});
  }
}

async function deadline(action, signal) {
  signal.throwIfAborted();
  let cancel;
  const aborted = new Promise((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([action(), aborted]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export function adtVersion(result) {
  const meta = (result?.result ?? result)?.structure?.metaData ?? result?.metaData;
  const changedAt = meta?.['adtcore:changedAt'];
  return changedAt ? { changed_at: changedAt, version: meta['adtcore:version'] ?? null } : null;
}
// A full DDIC element lists every field (VBAP: ~450); keep the requested fields and keys.
function ddicFields(data, wanted) {
  const fields = data.children
    .filter((c) => c.type === 'TABL/DTF')
    .map((c) => {
      const p = c.properties?.elementProps ?? {};
      return {
        name: String(c.name).toUpperCase(),
        key: !!p.ddicIsKey,
        data_element: p.ddicDataElement ? String(p.ddicDataElement).toUpperCase() : null,
        data_type: p.ddicDataType ?? null,
        length: p.ddicLength ?? null,
      };
    });
  return {
    name: String(data.name).toUpperCase(),
    type: data.type,
    field_count: fields.length,
    fields: wanted.length ? fields.filter((f) => f.key || wanted.includes(f.name)) : fields,
  };
}
export function normalizeToolResult(result, item, target, read_generation) {
  if (result.status !== 'success') throw fault('UNKNOWN_CAUSE', 'SAP_REMOTE');
  if (item.tool_name === 'searchObject' && !result.results?.length)
    throw fault('NOT_FOUND_UNCONFIRMED', 'SAP_REMOTE');
  let data = result.result ?? result.results ?? result;
  let properties = Object.keys(data ?? {});
  const fieldList = item.tool_name === 'ddicElement' && Array.isArray(data?.children);
  if (fieldList) {
    if (!data.children.length) throw fault('NOT_FOUND_UNCONFIRMED', 'SAP_REMOTE');
    data = ddicFields(
      data,
      item.required_properties.map((p) => p.toUpperCase()),
    );
    properties = data.fields.map((f) => f.name);
  }
  const missing = item.required_properties.filter(
    (p) => !properties.includes(fieldList ? p.toUpperCase() : p),
  );
  return {
    status: missing.length || result.hasMore ? 'PARTIAL' : 'SUCCESS',
    remote_outcome: 'SUCCEEDED',
    target_ref: target.target_ref,
    client: target.client,
    source_version: result.source_version ?? null,
    observed_at: new Date().toISOString(),
    read_generation,
    coverage: {
      complete: !missing.length && !result.hasMore,
      truncated: !!result.hasMore,
      properties,
      version_kind: result.version_kind ?? 'UNKNOWN',
    },
    validity: missing.length || result.hasMore ? 'PENDING_REVIEW' : 'VALID',
    missing_properties: missing,
    data,
  };
}
