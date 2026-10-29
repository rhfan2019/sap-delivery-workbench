# 项目协作约束

任何新增、移动、重命名、删除文件或改变模块依赖前，必须先阅读并遵守
[目录与依赖契约](docs/architecture/repository-contract.md)。该文件是本仓库目录归属的唯一规范。

- 先确定责任模块，再确定目录；禁止新增没有明确职责的根目录、通用杂物包或第二套同义结构。
- 跨 workspace 使用 package.json 的公开 exports；后端不得依赖 scripts，前端不得依赖后端源码。
- 删除前检查代码导入、运行时资源、测试、构建、部署和文档入口。不能把提示词、Schema、类型或附件当缓存。
- 变更目录必须同步修改引用、测试发现、npm 命令、Docker COPY 和目录导航；不得留下旧路径转发壳。
- 提交前运行 npm run check:architecture，并完成契约规定的相关验证；失败必须如实报告。
- 需要改变规则时，先修改契约及对应检查规则，再迁移消费者。不得临时绕过检查器。
- 平台定位为实施方内部的交付生产工具，按[平台定位方向决策](docs/architecture/2026-10-17-platform-positioning-decision.md)执行：不做客户的项目管理系统，不做客户内网部署，不连 PRD；项目数据无限期保留、人工归档。
- 权限按[项目主数据、权限与设置菜单设计](docs/specs/project-access-admin.md)：每个接口都经 `access` 模块按权限点校验，不得再按“是否管理员 / 是否成员”判断；新增功能先在 `packages/contracts/access/catalog.mjs` 登记权限点，并为缺权限（403）与范围外项目（404）写集成测试。
- FSD 设计助手按[方向决策](docs/architecture/2026-10-11-fsd-assistant-direction-decision.md)完全重构：只保留一个版本，历史设计助手各代（含 410 边界、旧表与数据）按契约 3.1 清除，不恢复旧设计引擎。其他模块的目录整理仍不授权删除历史数据或改变公开 API。
- ABAP 开发助手按[方向决策](docs/architecture/2026-10-13-abap-dev-agent-direction-decision.md)与[实施计划](docs/plans/2026-10-14-abap-dev-agent-implementation.md)实施；智能体共用能力归 agent-core，提示词与运行资源按契约 3.1 放置和命名。
- 界面风格以 [设计规范](docs/specs/DESIGN.md) 为准：只用其中的令牌（`theme.css` 变量），不新增颜色值；页面按其第 9 节分批迁移。
- 本机 .env、.runtime 中的凭据与附件、数据库卷和用户备份受保护，不做批量清理。

## 协作约定

- 全程用中文交流。只在 `main` 上开发，不建分支；检查通过后自行提交并推送。
- Prettier 只格式化自己改过的文件，不对目录运行。
- 重启 API 前确认没有运行中的助手轮次；不往用户自己的助手对话里发测试消息。运行与观察方法见[智能助手本机运行与观察](docs/guides/agent-operations.md)。
- **未完成事项只登记在[待办与问题清单](docs/plans/backlog.md)**：发现的问题、提出未被采纳的建议、做了一半的事都加一行；修复后写上提交号，攒批移到 `docs/archive/backlog-done.md`。专项测试记录保存原始分析，状态以待办清单为准。
- **每条工作线一份交接文档，持续更新**：`docs/plans/*-handover.md`，固定结构为现状一句话、下一步、已知问题（只列待办编号）、架构速览、测试资产、本工作线注意事项、新会话开场提示；顶部写“最后更新：日期（提交号）”。通用的运行方法、约定写在本文件、README 或运行指南，交接文档只放链接。
- **结束一个任务前**：把本次的进展、新发现的问题更新到对应的交接文档与待办清单，和代码一起提交；之后这个对话即可归档。

2026-10-08 的重构记录见 docs/architecture/refactor-record.md；执行计划见 docs/plans/2026-10-08-repository-refactor.md。
