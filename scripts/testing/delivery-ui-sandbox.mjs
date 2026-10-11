// Real API + isolated PostgreSQL fixture for manual browser acceptance.
// Invoke through scripts/testing/test-elements-e2e.mjs, never against the primary .env.
import { apiFixture } from '../../tests/fixtures/api.mjs';
import { hashPassword } from '@sap-delivery-workbench/api/platform/password';
import { createServer } from 'vite';
import { writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const origin = 'http://127.0.0.1:5196';
const f = await apiFixture({ origin });
const { actorId, organizationId, projectId, customerId, itemId } = f.scope;
const login = 'delivery-' + actorId.slice(0, 8);
await f.db.query('UPDATE app.app_user SET login_name=$2,display_name=$3 WHERE id=$1', [
  actorId,
  login,
  '陈顾问',
]);
await f.db.query('UPDATE app.user_password SET password_hash=$2 WHERE user_id=$1', [
  actorId,
  await hashPassword('Delivery-QA-2026!'),
]);
await f.db.query("UPDATE app.project SET name='交付工作台 · 隔离验收' WHERE id=$1", [projectId]);
await f.db.query(
  "UPDATE app.development_item SET code='DEV-0001',name='采购订单执行进度与异常跟踪',module='MM',business_owner_id=$2 WHERE id=$1",
  [itemId, actorId],
);
for (let n = 2; n <= 45; n++) {
  const res = await f.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/development-items`,
    headers: f.headers,
    payload: {
      name:
        n === 2
          ? '跨公司采购订单与供应商对账异常处理及多组织审批追溯的长名称开发任务验收'
          : ['销售交货到期与逾期分析', '生产订单成本归集报表', '供应商未清项核对'][n % 3] +
            ` · ${String(n).padStart(2, '0')}`,
      module: ['MM', 'SD', 'FI'][n % 3],
      kind: 'report',
      priority: n % 7 === 0 ? 'high' : 'low',
      businessOwnerId: n % 2 ? actorId : '',
      developerId: n % 3 ? '' : actorId,
      plannedDevDate: n % 4 ? '2026-10-20' : '',
    },
  });
  if (res.statusCode !== 201) throw Error(res.body);
}
const emptyProjectId = randomUUID();
await f.db.query(
  "INSERT INTO app.project(id,organization_id,customer_id,code,name) VALUES($1,$2,$3,'QA-EMPTY','空项目 · 隔离验收')",
  [emptyProjectId, organizationId, customerId],
);
await f.db.query(
  'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
  [organizationId, emptyProjectId, actorId],
);
await f.app.inject({
  method: 'POST',
  url: '/api/project-preference',
  headers: f.headers,
  payload: { projectId },
});
// Optional fault injection changes only this test server; successful reads use real routes/database.
await f.app.listen({ host: '127.0.0.1', port: 3206 });
const web = await createServer({
  root: 'apps/web',
  plugins: [
    {
      name: 'acceptance-fault',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.method === 'GET' && req.url === `/api/projects/${projectId}/development-items`) {
            const mode = await readFile('.runtime/delivery-ui-mode.txt', 'utf8').catch(() => '');
            if (mode.trim() === 'error') {
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ message: '验收故障：清单服务暂时不可用，请重试。' }));
              return;
            }
            if (mode.trim() === 'slow') await new Promise((r) => setTimeout(r, 3500));
          }
          next();
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5196,
    strictPort: true,
    hmr: false,
    proxy: { '/api': 'http://127.0.0.1:3206' },
  },
});
await web.listen();
await writeFile(
  '.runtime/delivery-ui-sandbox.json',
  JSON.stringify({ origin, login, ...f.scope, emptyProjectId }),
);
console.log(JSON.stringify({ origin, login, projectId, emptyProjectId, itemId }));
const close = async () => {
  await web.close();
  await f.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
