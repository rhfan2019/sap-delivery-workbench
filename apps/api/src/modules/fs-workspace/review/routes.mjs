import { failure } from '../../../platform/auth.mjs';
import { readContext, executeCommand, envelope, uuidPattern } from '../workspace/commands.mjs';
import { submitReview, getReview, recordApproval } from './service.mjs';
import { publishBaseline, withdrawBaseline } from './publication.mjs';
const base = '/api/projects/:projectId/development-items/:id/fs-workspace';
export function registerReviewRoutes(app, c) {
  for (const [path, operation, handler] of [
    ['/publications', 'publishFsBaseline', publishBaseline],
    ['/publications/withdraw', 'withdrawFsBaseline', withdrawBaseline],
  ]) {
    app.post(base + path, (req) =>
      executeCommand(
        c,
        req,
        operation,
        async (db, scope, workspace) => {
          const data = await handler(db, scope, workspace, req.body);
          return { data, result_ids: [data.id] };
        },
        { capability: 'can_publish' },
      ),
    );
  }
  app.post(base + '/reviews', async (req, reply) => {
    const result = await executeCommand(c, req, 'submitFsReview', async (db, scope, workspace) => {
      const data = await submitReview(db, scope, workspace, req.body);
      return { data, result_ids: [data.id] };
    });
    reply.code(201);
    return result;
  });
  app.get(base + '/reviews/:reviewId', async (req) => {
    const { scope } = await readContext(c, req);
    if (!uuidPattern.test(req.params.reviewId)) throw failure(404, '评审不存在。');
    return envelope(req, await getReview(c.pool, scope, req.params.reviewId));
  });
  app.post(base + '/reviews/:reviewId/approvals', async (req, reply) => {
    if (!uuidPattern.test(req.params.reviewId)) throw failure(404, '评审不存在。');
    const capability =
      req.body?.review_role === 'technical_reviewer'
        ? 'can_review_technical'
        : 'can_approve_business';
    const result = await executeCommand(
      c,
      req,
      'recordFsApproval',
      async (db, scope, workspace) => {
        const data = await recordApproval(db, scope, workspace, req.params.reviewId, req.body);
        return { data, result_ids: [data.id] };
      },
      { capability },
    );
    reply.code(201);
    return result;
  });
}
