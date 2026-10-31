# LangGraph 原聊天协议适配计划

> 状态：历史 / 已废弃（LangGraph 版设计助手已删除），不代表当前状态；现状以[待办与问题清单](backlog.md)为准。

按 executing-plans / test-driven-development 在当前已有分支实施，不提交或推送。用户已确认：前端界面严格不动，保留多轮交互和真实流式输出。

架构：新 `work/design/fsd/v1/chat` 返回现有 AgentWorkbench 的会话、运行、SSE、澄清和阶段协议。只更改前端数据入口与必要的连接恢复逻辑，模板和样式保持。旧 `/agent` 保持 410。复用 LangGraph、PostgreSQL saver、task/run/operation/租约预算与公开 model-stream 传输，不启动旧引擎。

- [x] 保存 UI 基线，测试原组件调用的协议；建立 chat turn 与持久 SSE 事件迁移。
- [x] 在原图增加对话节点：冻结多轮输入，真实供应商增量逐段保存/发送；预算、取消、迟到写和恢复受租约保护。
- [x] 新路由适配会话/历史、附件、澄清、精确版本审批、成果与诊断。服务器历史权威，不信任客户端历史。
- [x] 数据入口接入原组件，保持原 DOM/样式，断线重连去重而不重复模型调用。
- [x] 原页面端到端验证多轮、流式先于完成、附件、澄清、两确认、停止、历史恢复；运行接口安全与既有回归、类型/构建/架构检查。

实现归属：design-assistant 的 chat-store/chat-protocol/chat-routes/chat-model/chat-node；共享传输通过 agent-runtime/public；版本化迁移归 database，协议/隔离库/浏览器测试归根 tests。证据 `.runtime/artifacts/langgraph-chat-2026-10-09`。

实际文件归属：chat-service 管理回合，chat-events 管理持久文本事件，chat-workflow 投影原审批合同，chat-files 处理材料，chat-legacy 只读旧会话，chat-routes 提供 HTTP；模型流复用 model.mjs 和公开 streamText。未增依赖或另建执行引擎。

实施记录：核心图及事务按 TDD 内联完成后，按 subagent-driven-development 分派互不重叠的前端数据层、附件/历史及原页面验收；代码评审修复了真实流返回格式、私有会话通用入口、恢复游标、超时及等待设计恢复问题。

决策：新八章节文字与旧结构化 Schema 不作推测映射；采用时保留旧结构化字段与备注，将新内容追加到原备注编辑器，并绑定生成时工作稿版本。审批后材料变化撤销批准、fence 旧运行，重新生成冻结快照和审阅。原设计等待时插入问答，成功、失败及停止均恢复设计上下文和附件。

原界面 15 文件模板/样式核对通过（仅允许 :base 数据绑定变化）；原页面 7 项浏览器验收已通过。真实模型/SAP/专家业务验收仍属外部条件，合成验证不替代该验收。未提交、推送或发布。

最终验证：`npm test` 363/363 PASS；`npm run check` PASS；`npm run test:fsd:chat:ui` 7 项 PASS。证据分别为 `regression-final.log`、`check-final.log`、`browser-final.log`、`original-chat-result.json`、`ui-template-style-verification.json`。最终代码评审无剩余重要发现。检查点恢复通过两个真实子进程强杀测试；真实协议适配通过加密注册模型配置与可控传输验证，未调用付费供应商。

重点：流式正文只保存在授权会话表，不进入遥测或诊断摘要；正文来自实时模型增量，不把完整文本拆成假流。一次用户回合与后台逻辑运行分别标识，审批恢复可复用逻辑运行/thread，但使用新的 UI 回合事件序列。固定收题不调用模型；历史身份/项目越权拒绝；已停止回合不因迟到块恢复。
