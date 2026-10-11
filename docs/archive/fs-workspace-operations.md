# FS 工作区运行说明

> 历史文档：所述功能已在 2026-10-11 的 abap-fsd-agent 重构中删除，见[方向决策](../architecture/2026-10-11-fsd-assistant-direction-decision.md)。不代表当前可用功能。

目录结构以 [仓库契约](../architecture/repository-contract.md) 为准。FS 是功能规格说明书，不是文件系统。

- 后端：apps/api/src/modules/fs-workspace。
- 前端：apps/web/src/features/fs-workspace。
- 共享 Schema 与类型：packages/contracts/fs-workspace，通过公开 npm exports 引用。
- 测试：tests/unit 的对应技术类别、tests/integration/api/fs-workspace、tests/e2e/fs-workspace；样本位于 tests/fixtures/fs-workspace。

先运行 `npm run test:setup` 准备隔离测试库，再运行 `npm run test:fs`。`npm run test:fs -- --unit` 仅执行单元测试；`npm run test:playwright` 使用隔离环境验证浏览器行为。生成类型使用 `npm run generate:fs`，一致性使用 `npm run check:fs-contracts`。

生产页面的旧 `/fs/workspace` URL 已重定向到开发项设计页。独立 FS 模块保留；其浏览器验收通过仅测试环境的挂载入口访问，并使用真实 API 和隔离数据库，不在生产恢复旧页面路由。

旧设计生成助手继续返回 410；文档契约、历史读取与开发助手不随旧引擎停用而删除。工作稿被开发项设计页面接管后，独立 FS 的旧写入门禁仍然生效。

.runtime 中的附件、导出、轨迹与凭据分别保留；不要整体清空。新的测试证据在 .runtime/artifacts/fs-workspace，历史产物在 .runtime/archive。备份需同时包含数据库与对应附件存储。

[2026-10-03 历史实施记录](../archive/fs-workspace-operations-2026-10-03.md) 仅用于追溯，不表示当前目录、路由或功能验收状态。
