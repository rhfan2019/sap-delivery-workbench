# 设计助手后端清理（2026-10-08）

用户已备份并授权：仅清理设计助手后端，包括全部旧 v1 提示词和 Gem FSD v2；不使用 Git，不开始 LangGraph 实现。

## 执行计划

- [x] 记录受保护文件哈希；核对开发助手共享依赖。
- [x] 增加停用边界测试：设计旧路径明确停用，开发路径不受影响。
- [x] 删除设计专用执行器、设计循环、规则加载和提示词包，以及对应专用脚本测试。
- [x] 解除开发助手对设计提示词及执行器的依赖，保留其自身指令和共享传输。
- [x] 移除旧设计注册；仅保留明确停用响应，无旧流程回退。
- [x] 验证构建、模块依赖、模型/SAP/开发能力和受保护文件哈希，记录实际清单。

## 边界

前端、模型与 SAP 配置代码及数据、数据库和历史迁移、开发助手、独立 fs-workspace 功能保留。前端及历史读取依赖的契约不是可执行的旧设计版本，不删除。备份目录不操作。

共享模块中的开发与历史读取能力保留，设计专用提示词不得通过复制完整旧包继续存在。保留的开发专用提示词使用无版本路径。

清理后设计分析/生成暂不可用，待后续 LangGraph 重写。旧 URL 仅返回明确的停用响应，不代表保留旧引擎。

## 实际结果

已删除 77 个文件（含项目内部旧设计后端备份副本）；未使用 Git。删除清单如下。
- `tools/fsd-batch/backups/apps__api__src__abap-fsd-agent__design-loop.mjs`
- `tools/fsd-batch/backups/apps__api__src__abap-fsd-agent__errors.mjs`
- `tools/fsd-batch/backups/apps__api__src__abap-fsd-agent__executor.mjs`
- `tools/fsd-batch/backups/apps__api__src__abap-fsd-agent__generation.mjs`
- `tools/fsd-batch/backups/apps__api__src__abap-fsd-agent__object-verification.mjs`
- `tools/fsd-batch/backups/apps__api__src__abap-fsd-agent__routes.mjs`
- `tools/fsd-batch/backups/apps__api__src__abap-fsd-agent__runs.mjs`
- `tools/fsd-batch/backups/apps__api__src__abap-fsd-agent__specification.mjs`
- `tools/fsd-batch/backups/v2/app.mjs`

- `packages/agents/gem-fsd-v2.md`
- `apps/api/src/gem-fsd-v2.mjs`
- `apps/api/src/abap-fsd-agent/executor.mjs`
- `apps/api/src/abap-fsd-agent/design-loop.mjs`
- `apps/api/src/abap-fsd-agent/ruleset.mjs`
- `apps/api/src/abap-fsd-agent/prompts.mjs`
- `apps/api/src/abap-fsd-agent/context.mjs`
- `apps/api/src/abap-fsd-agent/object-verification.mjs`
- `scripts/check-abap-fsd-rules.mjs`
- `scripts/check-abap-fsd-prompts.mjs`
- `scripts/test-assistant-round2-live.mjs`
- `scripts/test-assistant-feedback-live.mjs`
- `tools/fsd-batch/gem-v2-pilot.mjs`
- `tools/fsd-batch/analyze-gem-v2.mjs`
- `tools/fsd-batch/tests/gem-v2.test.mjs`
- `tools/fsd-batch/tests/gem-v2.integration.mjs`
- `tools/fsd-batch/tests/schema.test.mjs`
- `tools/fsd-batch/tests/terminal.test.mjs`
- `tools/fsd-batch/tests/provider.test.mjs`
- `tests/fs-workspace/unit/assistant-context.test.mjs`
- `tests/fs-workspace/unit/assistant-design-loop.test.mjs`
- `tests/fs-workspace/unit/assistant-issue-merge.test.mjs`
- `tests/fs-workspace/unit/assistant-managed-executor.test.mjs`
- `tests/fs-workspace/unit/assistant-preflight.test.mjs`
- `tests/fs-workspace/unit/assistant-prompt-engineering.test.mjs`
- `tests/fs-workspace/unit/assistant-repair.test.mjs`
- `tests/fs-workspace/unit/assistant-review-regressions.test.mjs`
- `tests/fs-workspace/unit/assistant-rules-contracts.test.mjs`
- `tests/fs-workspace/unit/assistant-round2.test.mjs`
- `tests/fs-workspace/unit/assistant-verification.test.mjs`
- `packages/agents/abap-fsd-agent/v1/manifest.json`
- `packages/agents/abap-fsd-agent/v1/主提示词.md`
- `packages/agents/abap-fsd-agent/v1/任务/澄清.md`
- `packages/agents/abap-fsd-agent/v1/任务/讨论.md`
- `packages/agents/abap-fsd-agent/v1/任务/设计计划.md`
- `packages/agents/abap-fsd-agent/v1/任务/证据修订.md`
- `packages/agents/abap-fsd-agent/v1/任务/质量审查.md`
- `packages/agents/abap-fsd-agent/v1/任务/起草.md`
- `packages/agents/abap-fsd-agent/v1/实践/可编辑批处理与并发.md`
- `packages/agents/abap-fsd-agent/v1/实践/逐对象结果与重试反馈.md`
- `packages/agents/abap-fsd-agent/v1/提示词工程完整方案.md`
- `packages/agents/abap-fsd-agent/v1/渲染/增强功能说明书.md`
- `packages/agents/abap-fsd-agent/v1/渲染/报表功能说明书.md`
- `packages/agents/abap-fsd-agent/v1/渲染/接口功能说明书.md`
- `packages/agents/abap-fsd-agent/v1/渲染/转换迁移功能说明书.md`
- `packages/agents/abap-fsd-agent/v1/渲染/通用章节与来源映射.md`
- `packages/agents/abap-fsd-agent/v1/目录说明.md`
- `packages/agents/abap-fsd-agent/v1/类型/增强功能规则.md`
- `packages/agents/abap-fsd-agent/v1/类型/报表功能规则.md`
- `packages/agents/abap-fsd-agent/v1/类型/接口功能规则.md`
- `packages/agents/abap-fsd-agent/v1/类型/转换迁移功能规则.md`
- `packages/agents/abap-fsd-agent/v1/运行协议.md`
- `packages/agents/abap-fsd-agent/v1/验收/四类案例与预期问题.md`
- `packages/agents/abap-fsd-agent/v1/验收/规则覆盖与反例清单.md`
- `packages/agents/abap-fsd-agent/v1/验收/采购申请批处理案例.md`
- `apps/api/src/abap-fsd-agent/workflow.mjs`
- `tests/fs-workspace/workflow.test.mjs`
- `tests/fs-workspace/workflow-db.test.mjs`
- `tools/fsd-batch/lib/runner.mjs`
- `tools/fsd-batch/cli.mjs`
- `tools/fsd-batch/fsd-batch.cmd`
- `tools/fsd-batch/tests/runner.test.mjs`
- `tests/fs-workspace/api/assistant-context.test.mjs`
- `tests/fs-workspace/api/assistant-stream.test.mjs`
- `tests/fs-workspace/api/assistant-s08.test.mjs`
- `tests/fs-workspace/api/assistant-decisions.test.mjs`
- `tests/fs-workspace/api/assistant-review-provenance.test.mjs`
- `tests/fs-workspace/api/workflow.test.mjs`

## 共享文件调整

- `apps/api/src/app.mjs`：取消旧设计注册，增加明确停用响应。
- `apps/api/src/modules/item-workspace/agent.mjs`：只注册开发阶段路由，封装阶段初始化，保留双阶段重置权限校验。
- `apps/api/src/modules/agent-runtime/routes.mjs`：保留开发与历史访问运行基础，删除设计工作流接口、设计预检查、设计执行器回退。
- `apps/api/src/modules/agent-runtime/repository.mjs`：只允许开发阶段保存新生成结果，移除设计阶段写入状态机。
- `apps/api/src/modules/agent-runtime/specification.mjs`：删除设计指令生成；保留被历史文档与契约校验使用的函数。
- `apps/api/src/modules/agent-runtime/generation.mjs`：移除仅设计使用的续写指令与多次执行路径；保留开发单次传输诊断。
- 新增 `item-workspace/development-context.mjs`、`development-prompts.mjs` 和 `abap-fsd-agent/session-lock.mjs`：仅保留开发/共享上下文、通用指令及锁，无设计规则加载器。
- 新增 `design-assistant/unavailable.mjs`：旧设计 URL 返回 410，无引擎和回退。
- 调整共享测试的上下文导入，移除混合测试内已退役设计场景；会话与重置测试改走开发入口。

## 验证记录

- `npm run build` 通过（现有大 chunk 警告仍在）。
- 34 项专项测试通过：停用边界、真实开发路由注册、开发上下文、全应用启动、模型参数/传输、SAP 基础能力及前端工作流控制。
- 后端与脚本静态相对导入无缺失文件。
- 2926 个受保护文件 SHA-256 对比全部一致：前端源码、模型与 SAP 模块、数据库迁移、SAP vendor、契约、`.env`。
- 已重启本地受管服务，未运行数据库迁移。实际 HTTP 验证：health=200；旧管理/设计 agent/Gem v2 路径=410；开发助手与模型管理路径=401（仍保留登录保护）。
- 没有调用真实模型、SAP，没有运行需写入业务库的端到端测试；本记录不宣称真实模型生成或 SAP 联调已验收。
- 独立审查发现并修正静态开发路由的阶段初始化问题，已增加共享重置的独立设计权限检查。

## 保留项说明

`packages/contracts/abap-fsd-agent/fsd/v1` 是仍被前端与历史成果读取使用的数据契约；`packages/agents/item-development/v1` 属于开发助手。两者按“其他内容保持不变”的边界保留，不是设计助手可运行的旧版本。前端上的历史版本名称暂未修改，因为本次明确不改前端。独立 `fs-workspace` 按已确认范围保留。历史报告可能包含旧提示词引用，但没有旧设计后端加载入口。


空目录限制：文件删除使用逐文件补丁完成；自动审批拒绝 PowerShell 删除空目录（blocked by policy），因此旧提示词空目录可能仍存在，但文件内容已全部删除。
