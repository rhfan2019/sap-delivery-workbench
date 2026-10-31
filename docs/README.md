# 文档索引

本仓库保留与源码版本对应的工程文档；外部知识库可维护产品研究，但应用和测试不能依赖本机知识库路径。

- [目录与依赖契约](architecture/repository-contract.md)：新增、修改、移动、删除文件的唯一目录规范。
- [项目开发纪律](guides/development-discipline.md)：先文档后代码、提交前检查、界面一致性、对象全生命周期表与完成的定义。
- [平台定位方向决策](architecture/2026-10-17-platform-positioning-decision.md)：平台定位为实施方内部的交付生产工具；资产与产出物归属、部署与数据安全、项目结束与归档、对现有设计的影响（已确认）。
- [目录重构记录](architecture/refactor-record.md)：原问题、迁移清单与实际验证结果。
- [目录重构计划](plans/2026-10-08-repository-refactor.md)：2026-10-08 目录重构的执行任务（已完成，历史）。
- [ABAP FSD 开发计划](plans/2026-10-08-abap-fsd-backend.md)：LangGraph 版设计助手的实施记录（历史，该链路已删除）。
- [FSD 设计助手方案审视](architecture/2026-10-11-fsd-assistant-approach-review.md)：重构前设计助手的现状、问题和待讨论方向（决策前记录）。
- [FSD 设计助手方向决策](architecture/2026-10-11-fsd-assistant-direction-decision.md)：转为模型主导智能体的决策、目标形态、完全重构方式与实施顺序。
- [abap-fsd-agent 重构实施计划](plans/2026-10-11-abap-fsd-agent-refactor.md)：历史助手清除清单、新模块与前端改接、DEV-0024 验收。
- [审计日志与优化建议](specs/audit.md)：后台审计页面口径、运行评论与 Claude Code 优化建议流程。
- [项目主数据、权限与设置菜单设计](specs/project-access-admin.md)：项目主数据扩展、职位 / 角色 / 复合角色 / 数据权限、项目 SAP 系统与个人凭据安全策略、对照 Plain 的设置菜单体系（已实施，执行记录见第 8 节）。
- [权限测试](plans/2026-10-18-permission-test.md)：虚拟测试项目中模块组长、项目经理、开发组长的测试账号、预期权限矩阵、自动验证结果（71/71）与手工测试清单。
- [开发清单重构设计](specs/development-list.md)：字段口径、数据库表设计、标签与自定义列、接口与实施结果（已实施）。
- [开发概览设计](specs/development-overview.md)：按角色的开发驾驶舱，24 个指标的口径、首屏、补记数据、接口与权限、分期与一至三期实施记录（已实施）。
- [开发排期设计](specs/development-load.md)与[交接文档](plans/2026-10-31-development-load-handover.md)：开发人员周排期与负载表，口径、下钻与后退（已实施）。
- [开发概览一期实施计划](plans/2026-10-30-development-overview-implementation.md)与[交接文档](plans/2026-10-30-development-overview-handover.md)：一期步骤、涉及位置与验证方式。
- [abap-fsd-agent 端到端测试](plans/2026-10-12-abap-fsd-agent-e2e-test.md)：DEV-0031 测试脚本、结果、结论与问题的原始分析（E2E-01～06；现状以待办清单为准）。
- [设计助手交接文档](plans/2026-10-12-abap-fsd-agent-handover.md)：设计助手工作线的新会话入口（现行，持续更新）。
- [ABAP 开发助手方向决策](architecture/2026-10-13-abap-dev-agent-direction-decision.md)：abap-dev-agent 的工作模式、产物、框架加载、工具、校验与模块拆分（已确认）。
- [abap-dev-agent 实施计划](plans/2026-10-14-abap-dev-agent-implementation.md)：契约修订、抽取 agent-core、开发助手后端与前端、端到端验证与进度。
- [abap-dev-agent 端到端测试](plans/2026-10-14-abap-dev-agent-e2e-test.md)：真实模型与 SAP 下的场景、结论与问题的原始分析（DEV-E2E-01～06；现状以待办清单为准）。
- [开发助手交接文档](plans/2026-10-15-abap-dev-agent-handover.md)：开发助手测试工作线的新会话入口（现行，持续更新）。
- [智能助手前端交互交接文档](plans/2026-10-16-agent-frontend-handover.md)：两个助手共用前端工作台的新会话入口（现行，持续更新）。
- [智能助手本机运行与观察](guides/agent-operations.md)：启动与重启、登录、观察一轮运行、模型与代理、测试项目与 SAP、审计与优化建议流程，各交接文档共用。
- abap-dev-agent 系统指令：[主指令](../apps/api/src/modules/abap-dev-agent/prompts/system.md)、[可执行程序规范](../apps/api/src/modules/abap-dev-agent/prompts/report.md)与[范例](../apps/api/src/modules/abap-dev-agent/prompts/report-example.abap)，框架类内置副本在 [frameworks/](../apps/api/src/modules/abap-dev-agent/frameworks/)。
- [待办与问题清单](plans/backlog.md)：所有未完成事项的唯一入口（日常问题、专项测试问题、交接待办）；已完成的移到 [已完成清单](archive/backlog-done.md)。
- [SAP 开发者导读](guides/sap-developer-orientation.md)：用 SAP / Fiori 概念对照本仓库的目录、模块、一条完整调用链路与文档阅读顺序，新人入口。
- [查看开发数据库与表关系图](guides/database-browsing.md)：本项目自带的 pgAdmin（`npm run db:admin`，127.0.0.1:5051）的登录、预登记的开发库与 ERD 画图方法。
- [工作台多标签页](specs/workbench-tabs.md)：浏览器式标签的范围、打开 / 切换 / 关闭规则、记住方式与实现位置（第一期已实施；设置共用一个标签与“全部标签”下拉见 UI-012）。
- [工作台多标签页交接文档](plans/2026-10-29-workbench-tabs-handover.md)：多标签页工作线的新会话入口（现行，持续更新）。
- [表格页面模板：开发清单](guides/table-page-template.md)：按钮分类、行内编辑、详情抽屉与新表格页面接入约定。
- [设计规范](specs/DESIGN.md)：界面风格、令牌（`theme.css` 变量）、外壳与组件规则、页面分批迁移；界面以它为准。
- [智能助手对话体验](specs/agent-conversation-ux.md)与[起始页与输入框](specs/agent-workspace-start-and-composer.md)：两个助手共用工作台的交互规格（已实施）。
- [项目目录归属与资料导航](guides/项目目录归属与资料导航.md)：按资料类型查找所在目录。
- [FSD 附录 D 测试案例](plans/2026-10-15-fsd-test-cases.md)：测试案例格式、建单实测与“只写数据需求”的调整（已完成，历史记录）。
- [参照 Plain 重写前端界面层](plans/2026-10-17-plain-style-redesign.md)：Plain 设计语言实测与重写批次（已完成）。
- 主题切换方案（[2026-10-11](plans/2026-10-11-theme-switcher-design-md.md)、[2026-10-16](plans/2026-10-16-theme-system.md)）：历史，已由 Plain 重写取消主题换肤（契约 1.15）。
- 2026-10-03～09 的其余计划（FS 智能工作区、模型配置、旧设计助手各轮执行记录、LangGraph 版）：历史，开头已注明状态。
- `guides/`：当前维护与操作说明。
- `specs/`：版本化设计规格。
- `plans/`：实施计划；历史计划不自动代表当前完成状态。
- `archive/`：历史方案、验收与已删除助手的文档（含 LangGraph 版运行指南、实施说明和 FS 智能工作区设计），不作为现行运行配置。
- `design-options/` 与 `screenshots/`：设计参考和评审资料。

运行方法、端口、测试命令以根目录 [README](../README.md) 为入口；目录规则以契约为准，旧说明若有冲突不覆盖契约。
