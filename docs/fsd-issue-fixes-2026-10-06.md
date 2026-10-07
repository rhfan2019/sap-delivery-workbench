# FSD 测试问题修复记录（2026-10-06）

范围：FSD-ISSUE-001～006。状态：代码修复完成，待用户验收。旧 TODO-005、007、013、017 保持原规划或暂停状态。本次未调用真实模型或 SAP，不把合成回归表述为真实业务生成验收。

## 根因与修复

| Issue | 取证与根因 | 修复与验收证据 |
| --- | --- | --- |
| 001 | 执行步骤原位于整段消息和澄清卡片之后。 | 当前运行的进度移至对应助手输出之前；历史消息携带各自步骤；运行步骤展开、成功收起、失败保留原因。浏览器检查输出顺序。 |
| 002 | f591c752 为 completed 的需求讨论运行，没有已保存 artifact，不能将其冒充可确认初稿。历史 JSON 缺少可读投影；原审阅按钮一点击便放行确认。 | 历史完整 JSON 确定性生成阅读稿并可下载，明确不是可确认版本。工作流默认展示已保存版本 Markdown，JSON 折叠为技术详情；版本、哈希及渲染就绪均匹配后才允许审阅确认。缺失内容、渲染异常与版本更新均阻止旧确认。 |
| 003 | InputGroup 的 3px 焦点环与工作区 textarea 的 outline 叠加。 | 仅在助手输入区移除 textarea 自身边框和 outline，以容器的单层 1px 焦点轮廓保留键盘可见性。 |
| 004 | 全局 form input 的 width:100%、height:46px 作用于 radio，挤压标签。 | 单选控件固定 16×16px 且不收缩，标签使用剩余空间正常换行；验证单选、全部推荐、确认提交。 |
| 005 | 用户消息头没有右对齐，而消息气泡右对齐。 | 姓名和时间组右对齐；姓名可换行，时间不压缩。 |
| 006 | d5f778e5 最终为 cancelled：整轮约 24 分 26 秒；首轮模型约 13 分 8 秒达到 8192 输出额度，产生 20455 正文字符和 69430 reasoning 字符，随后续写。持续有数据并非连接无响应。旧运行/调用预算为 2147483 秒，无法有效保护。 | 已取消单次调用及整轮硬截止，保留连接无数据和数据库提交限时。超时终态持久化、取消清理后释放占用；迟到事件无效，保存前检查取消与版本，版本及完成快照原子提交。数据库失败不会无限保持运行中，停止续租后可恢复。 |

## 时间预算与运维

- 单次流式调用及整轮执行无总时长截止；首个数据和连续无网络数据的等待分别为 120 秒。持续推理不会因累计耗时中止，用户可手动停止。
- 已开始提交的事务不在中途报告取消：PostgreSQL 17 事务总限时 15 秒、语句 10 秒、锁等待 5 秒，均在获取锁前配置。连接池获取已有 5 秒限时。
- 终态持久化最多 5 秒，数据库故障不会无限占用模型。
- 修复后已确认没有活动 FSD 运行，再重启本地托管 Web/API 加载代码；未执行数据库迁移、初始化、删除历史或重跑真实模型。

## 修改入口

- 前端：`apps/web/src/features/fs-assistant-test/` 内 ConversationTimeline、AgentWorkbench、RunSteps、DecisionCard、WorkflowPanel、ChatMarkdown、SpecificationPanel、useAssistantRun；`apps/web/src/assets/elements.css`。
- 后端：`apps/api/src/abap-fsd-agent/` 内 cancellation、runs、routes、executor、repository、session-state、model-stream、errors。
- 保存事务选项：`apps/api/src/auth.mjs`、admin/context、delivery/context、item-workspace/routes 与 agent；仅助手保存显式启用限时。
- 契约：`packages/contracts/abap-fsd-agent/types.ts` 增加历史消息步骤；`.env.example` 已清理旧生成时间预算。
- 回归：assistant-deadline、assistant-save-budget、assistant-targets-timeout、assistant-reset、`tests/fs-workspace/e2e/fsd-issues.mjs`。旧 pending-items-ui 断言已同步为当前“未选择行时不显示删除”的既有行为。

## 验证

- 最终 FSD 全量串行测试：207/207 通过。
- 最终根测试串行运行：59/59 通过。
- 类型检查与生产构建通过；现有大于 500 KB 的构建产物提示仍保留。
- Edge 浏览器回归通过：默认阅读、版本与哈希绑定、缺失内容阻止确认、选项选择与提交、右对齐、进度顺序、单层焦点。

验证日志位于 `.runtime/fsd-issues-*-final.log`，截图位于 `artifacts/fsd-issues/`。浏览器在 1280px 和 1024px 两种 PC 宽度测试实际 Vue 组件与工作区全局样式，API 使用受控合成数据；后端测试使用隔离数据库。

独立复核发现并修正：终态写入失败导致内存状态挂起、历史阅读稿下载 404、保存阶段超时豁免。真实数据库锁等待测试验证了限时及事务释放。

用户验收尚未进行。建议用原开发项依次检查澄清、生成初稿、阅读和确认，以及失败后的重试。模型供应商的真实输出质量、耗时与 SAP 核验效果仍需实际业务验证。
