import { failure } from '../auth.mjs';
import { openKey } from './crypto.mjs';
import { generateText } from './text.mjs';

export function registerTextRoute(app, c, check, generate = generateText) {
  const active = new Set();
  app.post('/api/admin/models/:id/generate-text', { bodyLimit: 100000 }, async (req) => {
    await c.authorize(req);
    const body = req.body;
    if (
      !body ||
      typeof body.prompt !== 'string' ||
      !body.prompt.trim() ||
      body.prompt.length > 20000 ||
      Object.keys(body).some((k) => !['prompt', 'rowVersion'].includes(k))
    )
      throw failure(400, '请输入 1–20000 字的消息。');
    const token = c.organizationId + ':' + req.params.id;
    if (active.has(token)) throw failure(409, '此模型正在调用，请等待当前请求完成。');
    active.add(token);
    try {
      const pinned = await c.write(req, 'model.text.request', 'llm_model', async (db) => {
        const model = await check(db, req);
        const {
          rows: [credential],
        } = await db.query(
          'SELECT secret_cipher FROM app.llm_credential WHERE organization_id=$1 AND id=$2',
          [c.organizationId, model.credentialId],
        );
        if (!credential) throw failure(503, '模型凭据不可用，请检查配置。');
        return {
          subjectId: model.id,
          data: {
            model,
            key: openKey(credential.secret_cipher, c.organizationId, model.credentialId),
          },
        };
      });
      // Network I/O is outside the organization transaction; no prompts or replies in audit logs.
      const result = await generate(pinned.model.config, pinned.key, body.prompt.trim());
      await c.authorize(req);
      return result;
    } finally {
      active.delete(token);
    }
  });
}
