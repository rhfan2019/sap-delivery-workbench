# 文档索引

本仓库保留与源码版本对应的工程文档；外部知识库可维护产品研究，但应用和测试不能依赖本机知识库路径。

- [目录与依赖契约](architecture/repository-contract.md)：新增、修改、移动、删除文件的唯一目录规范。
- [平台定位方向决策](architecture/2026-10-17-platform-positioning-decision.md)：平台定位为实施方内部的交付生产工具；资产与产出物归属、部署与数据安全、项目结束与归档、对现有设计的影响（已确认）。
- [目录重构记录](architecture/refactor-record.md)：原问题、迁移清单与实际验证结果。
- [实施计划](plans/2026-10-08-repository-refactor.md)：本轮执行任务。
- [ABAP FSD 开发计划](plans/2026-10-08-abap-fsd-backend.md)：LangGraph 版设计助手的实施记录（历史，该链路已删除）。
- [FSD 设计助手方案审视](architecture/2026-10-11-fsd-assistant-approach-review.md)：重构前设计助手的现状、问题和待讨论方向（决策前记录）。
- [FSD 设计助手方向决策](architecture/2026-10-11-fsd-assistant-direction-decision.md)：转为模型主导智能体的决策、目标形态、完全重构方式与实施顺序。
- [abap-fsd-agent 重构实施计划](plans/2026-10-11-abap-fsd-agent-refactor.md)：历史助手清除清单、新模块与前端改接、DEV-0024 验收。
- [审计日志与优化建议](specs/audit.md)：后台审计页面口径、运行评论与 Claude Code 优化建议流程。
- [项目主数据、权限与后台管理设计](specs/project-access-admin.md)：项目主数据扩展、职位 / 角色 / 复合角色 / 数据权限、项目 SAP 系统与个人凭据安全策略、对照 Plain 的设置菜单体系（草稿，待确认）。
- [开发清单重构设计](specs/development-list.md)：字段口径、数据库表设计、标签与自定义列、接口与实施结果（已实施）。
- [abap-fsd-agent 端到端测试](plans/2026-10-12-abap-fsd-agent-e2e-test.md)：DEV-0031 测试脚本、结果、结论与问题分析（E2E-01～06，本轮问题的唯一权威清单）。
- [abap-fsd-agent 交接文档](plans/2026-10-12-abap-fsd-agent-handover.md)：新会话接手入口：现状、运行方法、待办与协作约定。
- [ABAP 开发助手方向决策](architecture/2026-10-13-abap-dev-agent-direction-decision.md)：abap-dev-agent 的工作模式、产物、框架加载、工具、校验与模块拆分（已确认）。
- [abap-dev-agent 实施计划](plans/2026-10-14-abap-dev-agent-implementation.md)：契约修订、抽取 agent-core、开发助手后端与前端、端到端验证与进度。
- [abap-dev-agent 端到端测试](plans/2026-10-14-abap-dev-agent-e2e-test.md)：真实模型与 SAP 下的场景、结论与问题清单（DEV-E2E-01～05）。
- [abap-dev-agent 测试交接文档](plans/2026-10-15-abap-dev-agent-handover.md)：新会话接手入口：现状、运行与观察方法、测试资产、测试重点、已知问题与协作约定。
- abap-dev-agent 系统指令：[主指令](../apps/api/src/modules/abap-dev-agent/prompts/system.md)、[可执行程序规范](../apps/api/src/modules/abap-dev-agent/prompts/report.md)与[范例](../apps/api/src/modules/abap-dev-agent/prompts/report-example.abap)，框架类内置副本在 [frameworks/](../apps/api/src/modules/abap-dev-agent/frameworks/)。
- [待办与问题清单](plans/backlog.md)：日常发现的小问题和零散改进，攒批统一处理。
- [SAP 开发者导读](guides/sap-developer-orientation.md)：用 SAP / Fiori 概念对照本仓库的目录、模块、一条完整调用链路与文档阅读顺序，新人入口。
- [表格页面模板：开发清单](guides/table-page-template.md)：按钮分类、行内编辑、详情抽屉与新表格页面接入约定。
- `guides/`：当前维护与操作说明。
- `specs/`：版本化设计规格。
- `plans/`：实施计划；历史计划不自动代表当前完成状态。
- `archive/`：历史方案、验收与已删除助手的文档（含 LangGraph 版运行指南、实施说明和 FS 智能工作区设计），不作为现行运行配置。
- `design-options/` 与 `screenshots/`：设计参考和评审资料。

运行方法、端口、测试命令以根目录 [README](../README.md) 为入口；目录规则以契约为准，旧说明若有冲突不覆盖契约。
