# 模型配置及待实施事项 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; independent UI and deployment domains use superpowers:dispatching-parallel-agents. 用户已明确执行构建、待实施条目修改与全量测试，本计划直接执行。

**Goal:** 构建已选第三套模型配置并完成 TODO-009/010/011/014/015/016。
**Architecture:** Vue 3 + Fastify + PostgreSQL；组织内模型注册表、不可变版本、加密凭据、测试记录和默认模型指针。现有组织管理员事务与审计复用；不实现操作模型分配或AI生成业务。
**Tech Stack:** Node >=22.12，Vue/TypeScript，PostgreSQL 17，原生 node:test。
**Spec:** 本会话确认的模型注册表范围及 docs/design-options/llm-registry-refined-2026-10-03/option-3.png、design-notes.txt；正式文档待办事项.md 中指定待实施条目。

## Global Constraints

- 默认作用域为组织，保存版本不静默切换默认版本；测试只能使用合成文本。
- 默认模型禁止删除，其他模型逻辑删除；历史版本保留。
- 只在模型页面采用候选表格，未授权全站替换表格。
- 云部署准备与实际云部署明确区分；现目录无Git，不初始化、不伪造commit。
- 不改动后续规划TODO-005/013/017和暂停方案TODO-007。

## Review Focus

- 跨组织ID、非管理员与过期会话不得读写模型管理。
- 测试期间版本变化、并发设置默认不得悄然覆盖。
- 私有地址、重定向、DNS重绑定和错误响应不得泄漏凭据。
- 保存草稿不影响默认生效版本；历史模型引用删除后仍存在。
- 生产入口不使用Vite开发服务器，附件/数据库/密钥具备独立持久化与恢复说明。

## Task 1 模型数据库与服务

- [x] 新建 tests/models.test.mjs / tests/model-api.test.mjs，观察缺失路由/功能失败。
- [x] 新迁移建立 llm_model/llm_model_version/llm_credential/llm_test_run/llm_default；运行账号仅给必要权限。
- [x] apps/api/src/models/{validation,transport,store,routes}.mjs 实现组织管理列表、版本保存、测试、默认切换、逻辑删除、内部默认解析。
- [x] 接口 /api/admin/models，/:id/test、/:id/default、DELETE /:id；所有写入携带版本；测试通过有效期30分钟。
- [x] 针对权限、并发、加密、SSRF、错误分类及删除行为验证并集成原测试。

## Task 2 第三套页面

- [x] ModelsView.vue 与样式实现默认星形列、双行模型名称、最近测试、行操作、搜索筛选分页。
- [x] 右侧抽屉维护名称/提供方/协议/URL/modelId/更换密钥/调用参数；保存、未保存保护、验证/默认操作状态。
- [x] 接入路由，不生成虚假生产种子数据；空态允许添加。
- [x] 类型检查及浏览器验证空态、新建/编辑/测试失败、默认与删除保护、键盘抽屉。

## Task 3 独立界面待办

- [x] TODO-009/010/011/015/016，由 ui_todos 子任务实施，主线合并核验。

## Task 4 部署准备

- [x] TODO-014，由 deployment 子任务审计实施并更新README；主线补充readiness及package scripts。

## Task 5 全量测试与交付

- [x] 新迁移与授权；npm test + test:sap + db:test + 新模型/部署测试。
- [x] npm run check，浏览器主要修改页面与模型抽屉对照截图。
- [x] 独立代码审查并处理影响功能或安全的问题。
- [x] 更新正式待办状态、设计/实施记录、README副本；逐项记录未验证外部条件。

## Execution ledger

- 2026-10-03：范围已核对，用户授权直接实施；不增加二次计划审批。
- 原schema-draft.sql为历史方案，新的正式迁移不含任务绑定表。

- 2026-10-03：模型迁移、权限、服务与第三套页面完成；界面及部署子任务完成，独立审查的两项问题已处理。
- 最终自动化：npm test 40/40、db:test 11/11、check 通过。浏览器使用独立临时组织，真实模型测试仅验证白名单拒绝；新建/删除成功路径由 API 集成测试覆盖。
- 云部署材料及本地配置检查完成；Docker Hub 超时阻断镜像构建，腾讯云端和真实供应商验收保留为外部验证，不计为已通过。
- 详见正式文档 11. 大模型配置与待实施事项交付记录.md 与工程 design-qa.md。
