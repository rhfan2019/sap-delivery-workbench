# 智能助手 Elements 改造验收记录

日期：2026-10-05。改造已直接落地当前工作区，未保留 legacy/elements 开关。本记录不代表部署或真实外部服务验收。

## 实现与来源

上游为 [vuepont/ai-elements-vue](https://github.com/vuepont/ai-elements-vue/tree/86c90df1b27cfd7ca05bd7f6c312c46f89c11603)，固定提交 `86c90df1b27cfd7ca05bd7f6c312c46f89c11603`。按助手业务所需引入 15 个组件族及递归依赖的 shadcn 基础组件，共 277 个源文件；不是把上游所有展示功能强行加入产品。

- [来源清单与原始 SHA-256](../../apps/web/src/components/ai-elements/upstream.json)
- [上游许可证](../../apps/web/src/components/ai-elements/LICENSE)
- [本地适配与升级说明](../../apps/web/src/components/ai-elements/README.md)

对话、消息、输入框、模型选择、Markdown/代码、附件、执行步骤、澄清问题及成果预览均已采用 Elements 组件系统。Tailwind 4 只引入主题与工具样式，不启用全局 Preflight，保留平台样式基础。

运行逻辑及服务端协议仍由平台负责：保留项目/开发项/阶段上下文、独立开发会话、固定设计版本、成果采用和下载、会话恢复、附件服务端身份，以及父级 openArtifact/artifact/conversation/busy/filesChanged 事件。业务澄清不伪装为工具授权；不存在伪造的工具调用或引用。

## 关键修复

- 停止运行与提交分离，失败恢复不会覆盖新输入的草稿；保留中文输入法及换行行为。
- 附件读取、哈希与上传准备阶段阻止提前发送和新建会话；只读状态遵守平台限制。
- 流式 Markdown 异步标题出现后更新目录；限制活动 HTML 和不安全 URL，远程图片不自动获取。
- 长对话允许向上阅读及返回最新消息；历史恢复校验开发项归属。

独立只读审查发现目录时序和附件准备竞态，均先通过浏览器场景复现后修复。复现证据：[目录](../../artifacts/fs-workspace/elements-regression-red.log)、[附件](../../artifacts/fs-workspace/elements-attachment-red.log)。最终完整测试通过。

## 验证结果与复现命令

| 验证 | 结果 | 命令 / 证据 |
|---|---|---|
| Vue 类型检查与生产构建 | 通过 | `npm run build` · [日志](../../artifacts/fs-workspace/elements-build.log) |
| FS 单元、数据库、API、worker 测试 | 164 通过，0 失败/跳过 | `npm run test:fs` · [日志](../../artifacts/fs-workspace/elements-integration.log) |
| 平台回归测试 | 53 通过，0 失败/跳过 | `node scripts/testing/test-elements-e2e.mjs --test 'tests/*.test.mjs'` · [日志](../../artifacts/fs-workspace/elements-platform-tests.log) |
| Elements 浏览器场景 | 8 通过 | `npm run test:elements:ui` · [日志](../../artifacts/fs-workspace/elements-browser.log) |
| 实际开发项页面/API/数据库闭环 | 9 项检查通过 | `npm run test:elements:integration` · [日志](../../artifacts/fs-workspace/elements-item.log) · [结构化验收](../../artifacts/fs-workspace/elements-item/页面验收.json) |
| 本次修改文件格式 | 通过 | [定向 Prettier 检查日志](../../artifacts/fs-workspace/elements-format-check.log) |

Node 测试共 217 项（164 + 53）；8 个浏览器场景和 9 项页面检查独立计数，不重复累加为单元测试数量。

浏览器覆盖模型选择、中文输入法、发送/停止/失败草稿、流式内容安全、附件上传删除及准备竞态、多问题澄清续跑、成果采用/下载/目录、开发项事件、桌面/手机、长对话滚动和会话隔离。

实际开发项闭环覆盖讨论转生成、人工修改进入模型上下文、明确采用保存、新会话承接摘要、刷新恢复、服务端附件提取预览、开发独立会话与固定设计依据。浏览器无未捕获异常。

## 页面证据

- [桌面设计与成果并排](../../artifacts/fs-workspace/elements-item/设计-文档并排-1600.png)
- [开发项页面](../../artifacts/fs-workspace/elements-item/开发-1600.png)
- [手机对话](../../artifacts/fs-workspace/elements-item/对话-390.png)
- [手机资料面板](../../artifacts/fs-workspace/elements-item/资料面板-390.png)

## 验证边界

测试使用隔离 PostgreSQL、真实平台 API 和本地模拟模型/SSE；SAP 调用为 0。未验证真实模型供应商、真实 SAP 及生产部署，不能据此宣称外部服务端到端已验收。

生产构建成功，但存在超过 500 KB 的分块提示；Markdown/高亮依赖相关最大分块约 1.59 MB（gzip 约 490 KB）。这仍是后续首屏性能优化项，本次没有将调整告警阈值作为解决办法。

当前目录无 Git 仓库，未创建提交、PR 或部署。上游导入脚本仅供初始导入，再运行会覆盖本地适配；升级需对照来源清单与适配说明审查。
