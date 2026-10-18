import { randomUUID } from 'node:crypto';
import { accessContext } from '../access/public.mjs';
import { version } from '../admin/validation.mjs';
import { failure } from '../../platform/auth.mjs';
import { saveModel, getModel, listModels, ADAPTER_VERSION } from './store.mjs';
import { openKey } from './crypto.mjs';
import { probeModel } from './transport.mjs';
import { probeStructured } from './capabilities.mjs';
import { STRUCTURED_ADAPTER_VERSION } from './inference.mjs';
import { registerTextRoute } from './text-route.mjs';
export function registerModelRoutes(app, pool, org, requireSession, probe = probeModel) {
  const c = accessContext(pool, org, requireSession),
    base = '/api/admin/models';
  app.get(base, async (req) => {
    await c.authorize(req, 'model:view');
    return listModels(pool, org);
  });
  app.post(base, async (req, reply) =>
    c.write(req, 'model:manage', 'model.create', 'llm_model', async (db, user) => {
      const data = await saveModel(db, org, user.user.id, req.body);
      reply.code(201);
      return { subjectId: data.id, data };
    }),
  );
  app.patch(base + '/:id', async (req) =>
    c.write(req, 'model:manage', 'model.save', 'llm_model', async (db, user) => {
      const data = await saveModel(db, org, user.user.id, req.body, req.params.id);
      return { subjectId: data.id, data };
    }),
  );
  const check = async (db, req) => {
    const m = await getModel(db, org, req.params.id);
    if (m.rowVersion !== version(req.body?.rowVersion))
      throw failure(409, '配置已更新，请刷新后重试。');
    return m;
  };
  registerTextRoute(app, c, check);
  app.delete(base + '/:id', async (req) =>
    c.write(req, 'model:manage', 'model.delete', 'llm_model', async (db) => {
      const m = await check(db, req);
      if (
        (
          await db.query('SELECT 1 FROM app.llm_default WHERE organization_id=$1 AND model_id=$2', [
            org,
            m.id,
          ])
        ).rowCount
      )
        throw failure(409, '请先切换默认模型，再删除此模型。');
      await db.query(
        'UPDATE app.llm_model SET deleted_at=clock_timestamp(),row_version=row_version+1 WHERE id=$1 AND organization_id=$2',
        [m.id, org],
      );
      return { subjectId: m.id, data: { ok: true } };
    }),
  );
  app.post(base + '/:id/default', async (req) =>
    c.write(req, 'model:manage', 'model.default', 'llm_model', async (db) => {
      const m = await check(db, req);
      const d = (
        await db.query('SELECT revision FROM app.llm_default WHERE organization_id=$1', [org])
      ).rows[0];
      if (String(req.body?.defaultRevision) !== (d?.revision ?? '0'))
        throw failure(409, '默认模型已被其他操作修改，请刷新后重试。');
      const t = (
        await db.query(
          'SELECT status,expires_at,adapter_version FROM app.llm_test_run WHERE organization_id=$1 AND version_id=$2 AND adapter_version=$3 ORDER BY started_at DESC,id DESC LIMIT 1',
          [org, m.versionId, ADAPTER_VERSION],
        )
      ).rows[0];
      if (
        t?.status !== 'passed' ||
        new Date(t.expires_at) <= new Date() ||
        t.adapter_version !== ADAPTER_VERSION
      )
        throw failure(409, '请先完成此版本的模型测试；验证有效期为 30 分钟。');
      await db.query(
        `INSERT INTO app.llm_default(organization_id,model_id,version_id) VALUES($1,$2,$3) ON CONFLICT(organization_id) DO UPDATE SET model_id=$2,version_id=$3,revision=app.llm_default.revision+1,updated_at=clock_timestamp()`,
        [org, m.id, m.versionId],
      );
      return { subjectId: m.id, data: { ok: true } };
    }),
  );
  app.post(base + '/:id/test', async (req) => {
    const capability = req.body?.capability ?? 'text';
    if (!['text', 'structured_output'].includes(capability))
      throw failure(400, '不支持的模型能力测试。');
    const adapter = capability === 'text' ? ADAPTER_VERSION : STRUCTURED_ADAPTER_VERSION;
    // Short transaction reserves a version; never hold organization lock during network I/O.
    const test = await c.write(
      req,
      'model:manage',
      'model.test.start',
      'llm_model',
      async (db, user) => {
        const m = await check(db, req);
        await db.query(
          "UPDATE app.llm_test_run SET status='timeout',code='INTERRUPTED',safe_message='先前测试已超时或服务中断。',finished_at=clock_timestamp() WHERE organization_id=$1 AND version_id=$2 AND status='running' AND started_at<clock_timestamp()-($3::int * interval '1 millisecond')",
          [org, m.versionId, MODEL_REQUEST_TIMEOUT_MS + 60000],
        );
        if (
          (
            await db.query(
              "SELECT 1 FROM app.llm_test_run WHERE version_id=$1 AND status='running'",
              [m.versionId],
            )
          ).rowCount
        )
          throw failure(409, '此版本正在测试，请稍后刷新。');
        const id = randomUUID();
        const credential = (
          await db.query(
            'SELECT secret_cipher FROM app.llm_credential WHERE organization_id=$1 AND id=$2',
            [org, m.credentialId],
          )
        ).rows[0];
        const secret = openKey(credential.secret_cipher, org, m.credentialId);
        await db.query(
          "INSERT INTO app.llm_test_run(id,organization_id,model_id,version_id,status,adapter_version,created_by) VALUES($1,$2,$3,$4,'running',$5,$6)",
          [id, org, m.id, m.versionId, adapter, user.user.id],
        );
        return { subjectId: m.id, data: { id, model: m, secret } };
      },
    );
    let result;
    try {
      result = await (capability === 'text' ? probe : probeStructured)(
        test.model.config,
        test.secret,
      );
    } catch {
      result = {
        status: 'failed',
        code: 'CONNECTION_FAILED',
        message: '模型测试失败，请检查连接配置。',
      };
    }
    // Results must persist even if the requesting session expires mid-test. No further privileged action.
    await pool.query(
      `UPDATE app.llm_test_run SET status=$3::varchar,code=$4,safe_message=$5,latency_ms=$6,finished_at=clock_timestamp(),expires_at=CASE WHEN $3='passed' THEN clock_timestamp()+interval '30 minutes' END,capabilities=$7 WHERE organization_id=$1 AND id=$2 AND status='running'`,
      [
        org,
        test.id,
        result.status,
        result.code,
        result.message,
        result.latencyMs ?? null,
        JSON.stringify(result.status === 'passed' ? [capability] : []),
      ],
    );
    return result;
  });
}
import { MODEL_REQUEST_TIMEOUT_MS } from './runtime.mjs';
