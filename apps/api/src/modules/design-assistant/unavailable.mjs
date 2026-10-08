// Retirement boundary only. No engine, model call, retry or version selection.
export function registerDesignUnavailable(app) {
  app.addHook('onRequest', async (req, reply) => {
    const path = new URL(req.raw.url, 'http://localhost').pathname;
    if (
      /^\/api\/admin\/abap-fsd-agent(?:\/|$)/.test(path) ||
      /^\/api\/projects\/[^/]+\/development-items\/[^/]+\/work\/design\/(?:agent|gem-fsd-v2)(?:\/|$)/.test(
        path,
      )
    )
      return reply.code(410).send({
        code: 'DESIGN_ASSISTANT_REMOVED',
        message: '设计助手旧后端已清理，正在等待 LangGraph 重建。',
      });
  });
}
