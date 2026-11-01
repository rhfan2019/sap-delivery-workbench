# 文档导航

> 最后更新：2026-10-31。文档按主题命名、原地更新，版本靠 Git；打开就是最新版。只有方向决策带日期；做完的计划、测试记录和历史资料在 `archive/`，不代表现状。布局规则见[目录与依赖契约](architecture/repository-contract.md)第 6 节。

## 想了解什么，看哪份

| 想了解                         | 看这份                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| 这个平台是什么、给谁用、有什么 | [产品说明](product.md)                                             |
| 接下来做什么                   | [路线图](roadmap.md)（草案，待确认）与[待办与问题清单](backlog.md) |
| 界面长什么样、用哪些令牌       | [设计规范](DESIGN.md)                                              |
| 代码放哪、模块怎么依赖         | [目录与依赖契约](architecture/repository-contract.md)              |
| 怎么跑起来、命令与端口         | 根目录 [README](../README.md)                                      |
| 开发流程与提交前检查           | [项目开发纪律](guides/development-discipline.md)                   |
| 为什么当初这样定               | [方向决策](#方向决策)                                              |

## 模块文档

一个模块一份：前面是规则（口径、数据、接口、权限），末节“现状与下一步”是接手入口。

| 模块                       | 文档                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| 项目主数据、权限与设置     | [access.md](modules/access.md)                                     |
| 开发清单                   | [development-list.md](modules/development-list.md)                 |
| 开发概览                   | [development-overview.md](modules/development-overview.md)         |
| 开发排期                   | [development-load.md](modules/development-load.md)                 |
| 工作台多标签页             | [workbench-tabs.md](modules/workbench-tabs.md)                     |
| FSD 设计助手               | [fsd-agent.md](modules/fsd-agent.md)                               |
| ABAP 开发助手              | [dev-agent.md](modules/dev-agent.md)                               |
| 助手工作台：对话体验       | [agent-conversation.md](modules/agent-conversation.md)             |
| 助手工作台：起始页与输入框 | [agent-start-and-composer.md](modules/agent-start-and-composer.md) |
| 审计日志与优化建议         | [audit.md](modules/audit.md)                                       |

## 方向决策

- [FSD 设计助手方向决策](decisions/2026-10-11-fsd-assistant-direction-decision.md)（2026-10-11）
- [ABAP 开发助手方向决策](decisions/2026-10-13-abap-dev-agent-direction-decision.md)（2026-10-13）
- [平台定位方向决策](decisions/2026-10-17-platform-positioning-decision.md)（2026-10-17）

## 指南

- [项目开发纪律](guides/development-discipline.md)
- [智能助手本机运行与观察](guides/agent-operations.md)
- [查看开发数据库与表关系图](guides/database-browsing.md)
- [SAP 开发者导读](guides/sap-developer-orientation.md)：新人入口
- [表格页面模板](guides/table-page-template.md)
- [目录结构审查提示词](guides/repository-structure-review-prompt.md)

## 其他

- `samples/`：验收样例（DEV-0024 需求与 FSD）。
- `archive/`：已完成的实施计划与测试记录（`archive/plans/`）、历史方案、评审截图与设计稿、[已完成待办](archive/backlog-done.md)。助手系统指令不在 docs，在各助手模块的 `prompts/` 下。
