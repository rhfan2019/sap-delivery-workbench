# FS 工作区开发状态与运行记录

2026-10-03。当前已有真实 Vue/API/PostgreSQL 纵向切片：人工编辑与候选接受、不可变版本、附件隔离、异步解析/重合并/导出、SSE、早期评审及发布拒绝门禁。T01—T15 尚未全部完成，不应作为已上线产品。

## 当前目录职责

- `packages/contracts/fs-workspace/`：候选、HTTP 命令、领域和事件 JSON Schema；`generated/types.ts` 由 Schema 生成。运行时不读取 docs。
- `apps/api/src/fs-workspace/`：共享项目权限适配、路由注册；`workspace/` 管理历史导入及工作区读取/创建；`review/roles.mjs` 管理项目 FS 角色和项目级命令收据。
- `apps/web/src/services/session.ts`：保持旧调用签名，增加 headers、AbortSignal 和结构化错误支持。新 UI 聚合于 `apps/web/src/features/fs-workspace/`，不引用服务端实现。
- `database/migrations/1791046800000_fs-workspace-core.sql` 与 `1791046801000_fs-workspace-protocol-metadata.sql`：新增 25 张表、同范围外键、历史版本及幂等元数据。不可逆 down 明确拒绝。
- `tests/fs-workspace/`：单元、真实数据库及 Fastify inject API 检查。`.runtime/` 保存隔离配置与数据，`artifacts/fs-workspace/` 保存脱敏验证输出。

依赖为路由 → 权限/应用服务 → repository → PostgreSQL；共享契约不依赖 apps。现有 app.mjs 只新增注册与错误分支，旧 fs.mjs 只增加迁移后写保护。

## 隔离测试配置和迁移

以下命令只用于本地独立测试实例。不要替换为主 `.env`。脚本不会对主数据库执行迁移。

```powershell
node scripts/setup-fs-tests.mjs
docker compose --env-file .runtime/fs-tests.env -f .runtime/fs-tests.compose.yaml up -d --wait
node --env-file=.runtime/fs-tests.env scripts/db-migrate.mjs
node --env-file=.runtime/fs-tests.env scripts/db-provision.mjs
npm run test:fs
node --env-file=.runtime/fs-tests.env --test tests/*.test.mjs tests/database/*.test.mjs
npm run check:fs-contracts
npm run typecheck
npm run build
```

数据库位于回环地址端口 55439，名称 sap_fs_test_dev，独立 Docker 项目 sap-fs-tests-dev。随机凭据只存 `.runtime/fs-tests.env`，不入库、不打印。`npm run test:fs -- --unit` 可仅执行离线单元测试；`--list` 列出发现结果。普通 test:fs 递归发现 `.test.mjs`，排除 e2e，并在发现数据库/API/worker 测试时强制加载隔离文件、检查回环地址与测试库名。直接 node --test 的 FS 数据库夹具也执行隔离检查。

已在该实例应用原有迁移以及 FS 前滚迁移至 `1791046805000_fs-publication-reason.sql`。未对用户主库执行任何迁移。新代码依赖新表；在其他开发实例运行前必须备份并显式应用迁移。主 `.env` 保持不变。

## 已接入 API

同源登录后可调用：

- GET/POST `/api/projects/{projectId}/development-items/{id}/fs-workspace`。GET 不创建对象；POST 需要 UUID Idempotency-Key。真实项目成员/编辑权限、归档检查与创建命令收据均在服务器执行。
- GET/POST `/api/projects/{projectId}/fs-roles`。仅项目内组织管理员可配置；POST 需要 Idempotency-Key 和成员 expected_revision；作者的审批能力仍为 false。
- 已迁移项的旧 PATCH fs、POST fs/versions、POST fs/submit 返回 409 FS_WORKSPACE_ENABLED，即使工作区入口关闭也不重开旧写口。

开发服务器沿用现有启动方式。开发项 FS 页签已提供新入口；直接路由为 `/projects/{projectId}/development-items/{itemId}/fs/workspace`。启用后旧编辑器隐藏，后端旧写接口继续拒绝。不要把 design prototype 当成正式功能。

历史导入 CLI 需已认证本地会话（`FS_IMPORT_COOKIE`），只允许回环 HTTP origin（`FS_IMPORT_ORIGIN`），通过同一创建 API 执行：

```powershell
node scripts/import-legacy-fs.mjs <projectUUID> <itemUUID> report [legacyVersionUUID]
```

CLI 输出幂等键而不输出 Cookie；响应丢失后用同一 `FS_IMPORT_IDEMPOTENCY_KEY` 重试。该 CLI 的真实 HTTP API 路径已有 inject 测试，但尚未用人工登录的浏览器会话执行 CLI 验证。

## 迁移和恢复边界

旧版本、当前草稿及 submitted pointer 分开导入；每份原文保留 JSON 与 SHA-256，legacy_submission 不会生成新 Approval。未知章节仍保留；异常文字为 pending。迁移不改变 development_item.stage。当前导入事务和新 API 仅构成底座，尚不能正式评审或发布这些文档。

发生问题时停止新入口，保留数据库和 blob 快照，以前滚迁移修复；不要运行破坏性 down，也不要让已迁移开发项重新经旧接口写入。生产备份恢复演练尚未执行。

## 未完成与未验证

T04—T11 已有后端/界面切片，整体任务仍未完成；详情见 artifacts/fs-workspace/implementation-ledger.md。A01—A40 未整体验收；真实 SAP、模型、ClamAV/OCR、批准发布正向链、Word 独立分页渲染、完整性能与可访问性验收仍未完成。真实 Word/PDF 内容生成已测试，PDF 百行中文表格生成11页并核对内容、重复表头、边界和每页状态标识。真实浏览器已验证一条人工修改闭环、中文输入法和390px布局，不代表全部产品验收。没有生产发布或生产 SAP 操作。

独立 worker 入口：`node --env-file=<目标环境文件> scripts/fs-worker.mjs`，需要该环境的 `DEFAULT_ORGANIZATION_ID` 及既有数据库运行账号。不要将主环境用于测试。生产必须设置绝对路径 `FS_ATTACHMENTS_DIR`；`FS_CLAMSCAN_PATH` 指向受信本地 ClamAV 可执行文件。缺扫描配置会持久化等待证据，文件不会放行。OCR 尚未接入；扫描页会保留不可读状态。worker 执行附件扫描/解析、三方重新合并和真实导出，模型对话阶段尚未接入；其他意图明确阻断。过期租约最多执行预算次数（默认3次），耗尽后持久失败事件；复用断点要求输入与配置版本完全一致。

本轮新增前滚迁移 `1791046803000_fs-message-input.sql` 保存消息原始请求与任务关联；仅已应用于隔离测试数据库。需要运行相同迁移才能在开发环境使用新增消息接口。测试命令：`node --env-file=.runtime/fs-tests.env node_modules/@playwright/test/cli.js test --config=playwright.fs.config.mjs`；端口5187/3197，报告与截图写 artifacts/fs-workspace。

未将旧 `npm test` 原命令直接运行，因为它自动加载主 `.env`；使用同一根测试文件集合加隔离 env 执行。根回归曾出现 Vite HMR 24678 端口占用提示，断言通过；这不是工作区 UI QA。

## 导出和模型配置补充

导出运行环境需设置绝对路径 `FS_EXPORTS_DIR`、`FS_FONT_FILE`、`FS_CHROMIUM_PATH` 和字体名 `FS_FONT_NAME`。字体字节哈希写入导出manifest；改变字体后重新创建导出。浏览器禁止外网请求，文档文本转义，文件内容核对后才ready。当前测试使用本机Chrome和微软雅黑，其他主机需要显式配置并验证；不自动安装字体或浏览器。示例文件在 `artifacts/fs-workspace/export/`，全部为合成数据。

`POST /api/admin/models/{id}/test` 可带 `capability: "structured_output"` 和既有 `rowVersion`，只允许组织管理员。通过真实随机挑战、严格JSON与Schema才保存30分钟结构化能力凭证。文本探测不代替此能力。Responses/Chat推理共用既有HTTPS允许域名、DNS固定地址与密钥解密边界。Anthropic结构化推理目前明确拒绝。当前没有执行真实供应商请求，也尚未把推理接入FS阶段调度。

`POST .../publications` 与 `POST .../publications/withdraw` 使用服务端publisher权限、If-Match、幂等收据；撤回原因追加保留。发布再次检查精确文档/证据/政策绑定与两角色决定。RuleDetail写入路径和SAP证据闭环尚未完成，不能据此声称完整发布已验收。


当前界面提供“附件与来源”和“导出固定版本”。导出按钮调用实际服务端任务，状态为ready才出现下载；可手动刷新状态。讨论稿不因导出变为已批准。PDF状态标识使用Chromium分页页边距盒；部署浏览器须支持并运行多页回归。测试下载文件为 `artifacts/fs-workspace/export/browser-download.docx`。

最新验证：FS62/62，既有回归54/54，浏览器1/1，契约/类型/构建通过。日志为 `artifacts/fs-workspace/*-latest.txt`。这些不是全部A01—A40的验收通过，剩余清单见实施证据。
