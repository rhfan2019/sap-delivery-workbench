# 文档索引

本仓库保留与源码版本对应的工程文档；外部知识库可维护产品研究，但应用和测试不能依赖本机知识库路径。

- [目录与依赖契约](architecture/repository-contract.md)：新增、修改、移动、删除文件的唯一目录规范。
- [目录重构记录](architecture/refactor-record.md)：原问题、迁移清单与实际验证结果。
- [实施计划](plans/2026-10-08-repository-refactor.md)：本轮执行任务。
- [ABAP FSD 开发计划](plans/2026-10-08-abap-fsd-backend.md)：LangGraph 版设计助手的实施记录（历史，该链路已删除）。
- [FSD 设计助手方案审视](architecture/2026-10-11-fsd-assistant-approach-review.md)：重构前设计助手的现状、问题和待讨论方向（决策前记录）。
- [FSD 设计助手方向决策](architecture/2026-10-11-fsd-assistant-direction-decision.md)：转为模型主导智能体的决策、目标形态、完全重构方式与实施顺序。
- [abap-fsd-agent 重构实施计划](plans/2026-10-11-abap-fsd-agent-refactor.md)：历史助手清除清单、新模块与前端改接、DEV-0024 验收。
- [审计日志与优化建议](specs/audit.md)：后台审计页面口径、运行评论与 Claude Code 优化建议流程。
- [开发清单重构设计](specs/development-list.md)：字段口径、数据库表设计、标签与自定义列、旧数据清除（设计待审阅）。
- [abap-fsd-agent 端到端测试](plans/2026-10-12-abap-fsd-agent-e2e-test.md)：DEV-0031 测试脚本、结果、结论与问题分析（E2E-01～06，本轮问题的唯一权威清单）。
- [abap-fsd-agent 交接文档](plans/2026-10-12-abap-fsd-agent-handover.md)：新会话接手入口：现状、运行方法、待办与协作约定。
- [待办与问题清单](plans/backlog.md)：日常发现的小问题和零散改进，攒批统一处理。
- `guides/`：当前维护与操作说明。
- `specs/`：版本化设计规格。
- `plans/`：实施计划；历史计划不自动代表当前完成状态。
- `archive/`：历史方案、验收与已删除助手的文档（含 LangGraph 版运行指南、实施说明和 FS 智能工作区设计），不作为现行运行配置。
- `design-options/` 与 `screenshots/`：设计参考和评审资料。

运行方法、端口、测试命令以根目录 [README](../README.md) 为入口；目录规则以契约为准，旧说明若有冲突不覆盖契约。
