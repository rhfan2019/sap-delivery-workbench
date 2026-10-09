# ABAP FSD 实施与证据说明

版本 0.3，2026-10-09。依据外部设计 01 V0.13、03/04/05 V0.2、06/09 V0.1。这里记录实际实现及限制，不改写历史评审结论。

2026-10-09 更新：此前误替换的 AgentWorkbench 已恢复。本次在原组件的数据层完成 `/fsd/v1/chat` 适配；下文 2026-10-08 工程验证保留为历史证据，最新原页面验收见本文末尾。旧接口仍保持 410。

## 实现归属与状态

新后端归 `apps/api/src/modules/design-assistant`，新增公开 facade 跨模块访问授权、模型、材料和 SAP；共享封闭输出协议归 `packages/contracts/design-assistant`。迁移 `1791460000000_design-assistant-v1.sql` 保存 task/run/request/event/commit/operation/attempt/attachment；官方 PostgreSQL saver 使用独立 `fsd_checkpoint` schema。业务事务与 checkpoint 事务不是原子整体，恢复依靠幂等 StepCommit 和操作记录。

业务阶段与节点：接收 N01、分析 N02、证据与核实 N03–N06、方案 N07–N09、FSD 修订 N07–N09（cycle=1）、等待 N10、交付 N11。模型没有直接提交/发布权，输出 Schema、版本、证据、预算及确认由代码检查。对象支持八章 section 及稳定 field/rule/scenario 身份；applyObjectChanges 在提交前构建完整候选，保存依赖两端版本及用途，拒绝未知引用、版本冲突和遗漏的受影响对象。历史 artifact 保留原内容。合成回归验证版本与事务闭包，真实规则的语义完整性仍属于专家验收。

正式设计页保留原 AgentWorkbench；FsdWorkbench 仅作为隔离工程测试界面，后续不得用它替换聊天入口。没有恢复旧引擎，旧 410 有 API 回归。原有用户 `.gitignore` 修改及 GemFsdV2 删除保留，未提交、推送或发布。

## 证据矩阵索引

| 需求/案例                         | 实现符号                                                                  | 可执行验证                                       | 证据位置/限制                                                                        |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| REC-01/02/04/05                   | worker.executeRun、repository.stepCommit/guard、checkpointer.durableSaver | crash、concurrency、checkpointer 集成测试        | 强杀独立子进程、实际 PostgreSQL、原 run/thread 保持、generation 拒绝迟到写           |
| REC-06、MODEL-01/02/03、REC-07/08 | graph.call/N03/N04、assets.compatible                                     | faults 集成测试                                  | UNKNOWN 新代读取、绝对超时、有限格式修复、语义循环、资产不兼容、checkpoint 失败/领先 |
| STATE-01/03/04/06、MODEL-04/05    | repository.command/reserve/settle/chargeActive                            | storage/concurrency/flow                         | request 幂等、barrier、暂停先后、确认绑定、崩溃活动时间补计                          |
| OBS-03/04/05/06/07/08             | telemetry.safeAttributes/safeError/BoundedExporter、repository.event      | telemetry、api、concurrency、observation、faults | 独立重试 Span、取消来源、UNKNOWN、异常脱敏、有界导出、审计回滚、授权撤销             |
| FLOW-01/02/03                     | graph、model、routes、FsdWorkbench                                        | flow、policy、workbench 浏览器测试               | 附件正文进入冻结快照、收题零模型、两确认、合成成果；不等同业务质量 PASS              |
| TOOL-01/03/04/05/06               | policy.validateTool/validateEvidence、sap.collectPages                    | policy/tools/faults                              | 只读白名单、闭合参数、来源/版本/覆盖、分页代际；真实 TOOL-08 阻塞                    |
| DBG、EVAL                         | routes.diagnostics/replay、evaluate-fsd                                   | api、evaluation runner、browser                  | 固定 54 ID、逐例状态/摘要/hash、单 Prompt 合成比较；业务参考未冻结                   |

可复制命令见 [运行指南](../guides/abap-fsd-backend.md)。完整逐例要求保留在 evaluation.json。验证产物在 `.runtime/artifacts/abap-backend-2026-10-08`，含 baseline 与 candidate 清单、数据库/构建/架构日志、浏览器截图及 Jaeger 原始响应。

## 准入结论的边界

- G0：真实 PostgreSQL saver、独立进程强杀、fencing、审计回滚、OTel→Collector→Jaeger、恢复诊断已具备工程运行证据；最终结果以本页验收记录及固定实验为准。
- G1：合成垂直流程、浏览器两门交付及工程故障闭环已跑通；47 个可独立工程案例已有完整注册断言，另 1 个真实 SAP 工程案例属于 G2 阻塞。不能将合成成果质量解释为真实业务设计质量。
- G2：BLOCKED，缺明确目标系统/client、SAP-C01..07 实际证据、账号权限和资料出域许可；适配器代码存在不代表真实接入验证完成。
- G3：BLOCKED，缺真实业务模块/样本、冻结模型与专家 ReferenceSpec、三次逐例审查及基线。合成数据不能证明业务 PoC 通过。

验证限制：矩阵中的 run/Trace 引用按串行测试文件归集，具体案例通过断言名称/行号定位，尚不是每条断言独占的 run 标签；指标为进程/任务观测，未验收多实例全局聚合；非法模型原文不进入诊断包，固定重放仅能复用实际已保存的结果，缺记录明确拒绝；检查点损坏验证覆盖已登记的缺失/领先/pending write 情形，不宣称穷尽所有损坏组合。生产观测升级与真实业务语义由后续准入验证，当前不做生产就绪承诺。

新增只读 `fsd:sap:probe` 入口与示例计划，默认输出七项 BLOCKED；显式执行需批准的目标与环境，每次读绝对 45 秒、全部物理调用含分页最多 60 次、总截止 900 秒，超时迟到连接关闭。探针保存脱敏观察，不自动批准能力；真实 SAP 的拒绝/TTL/跨账号与服务端结果仍须目标环境证据。运行时 PASS 记录须校验证据文件 hash 与部署、目标、client、责任人绑定。

当前资产 graph=fsd-3、output schema=2；旧资产进入 COMPATIBILITY。新增范围方向固定题、显式有界预算追加、跨项目诊断拒绝审计、分页失败进度保留、版本未知补采，分别有 FLOW-07、MODEL-06、DBG-04、TOOL-04/06 回归。

近期增补：固定重放使用原运行保存的模型/工具输出；BUSY/429 使用有限退避并计累计预算；标题/公式增量、反向审查必须回写正文、撤回/结束/缺证据阻断已有回归。真实进程强杀覆盖确认提交后尚未派发，确认与成果不重复。分页续读逐页预留、结算并记录 result.page 子 Span。恢复入口校验 StepCommit 快照/版本并记录 LEDGER_VALIDATED，避免保存器复用 pending writes 时缺失对账事件。

架构检查当前存在开发前已有失败 `Unregistered root entry: .archify`。本实现保留该目录，没有删除资料或放宽检查器来取得通过。

## 本轮最终验证记录

证据根目录：`.runtime/artifacts/abap-backend-2026-10-08`。

| 检查                                                     | 实际结果                                          | 证据                                                          |
| -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `npm test`                                               | 341/341 PASS，0 skip                              | full-tests-v4.log                                             |
| 固定 54 案例 baseline-v4 / candidate-final               | 均 47 PASS、0 FAIL、7 BLOCKED、0 NOT_RUN          | evaluations 下对应 experiment.json                            |
| 浏览器双确认/导出、实际 Jaeger 因果链、失败诊断/受控继续 | PASS，固定集内重新执行                            | candidate-final 内 workbench.mjs.assets、diagnosis.mjs.assets |
| `npm run check:fs-contracts`                             | PASS                                              | contracts-v3.log                                              |
| `npm run typecheck`、`npm run build`                     | PASS；构建有现有 chunk 大小警告                   | typecheck-v3.log、build-v3.log                                |
| `npm run check:architecture`                             | FAIL，仅原有 `.archify` 根目录未登记              | architecture-v4.log、baseline-architecture.log                |
| Docker runtime 镜像构建                                  | BLOCKED，Docker Hub auth 连接超时，未进入应用构建 | docker-build.log                                              |
| SAP-C01..07                                              | BLOCKED，无批准目标与真实能力证据；未联网         | sap-probes/*.json                                             |

最终基线为 `evaluations/baseline-v4-3e8eacb1-77cb-4e77-a4b3-5406d7258619`，候选为 `evaluations/candidate-final-2c5e2ffa-2080-42a2-8302-37d77e62c677`。两者固定集 hash 一致；候选仅补强评估结果文字与断言定位，源码清单准确记录差异。此对比验证回归稳定性，不声称 Prompt 质量或真实费用改善。早期 baseline-v3 与全量测试并发，不作为最终 run 引用依据；保留历史记录。

候选 `evidence-matrix.json` 是统一 54 案例矩阵，`source-manifest.json` 记录源码及测试 hash；`delivery-index.json`、`changes-manifest.json` 与 `key-changes.diff` 位于证据根目录。主数据库未迁移；只在隔离测试库执行迁移与 saver 初始化。未提交、推送或发布。

G0/G1 的本机合成工程验证具备上述证据；仓库架构检查仍非全绿，Docker 部署尚未验证。G2/G3 不通过：需要真实业务场景/参考、冻结模型、目标 SAP/client/只读账号、资料出域授权及专家审查。不得将 47 工程 PASS 合并表述为真实系统或业务 PoC 验收通过。

## 依赖与公开接口依据

实际锁定 LangGraph 1.4.21、PostgreSQL saver 1.0.6、OTel API 1.9.0、sdk-trace-base/resources 2.8.0、OTLP exporter 0.223.0、Collector 0.137.0、Jaeger 1.76.0。saver.setup/getTuple/putWrites、sync durability 和 interrupt/resume 的实际行为由集成测试验证。

官方资料： [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[OpenTelemetry JS instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/)、[Jaeger 1.76 deployment](https://www.jaegertracing.io/docs/1.76/deployment/)。请求时间、HTTP 状态与内容 hash 存于 official-sources.json；官方文档本身不替代本仓库的运行证据。Jaeger v1 EOL 和现有 MCP SDK npm audit 高危项仍需后续升级回归，未自动 force 升级。


## 2026-10-09 原 Agent 对话适配验收

最新证据目录：`.runtime/artifacts/langgraph-chat-2026-10-09`，哈希索引 `acceptance.json`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 全部单元和隔离集成 | 363/363 PASS | regression-final.log |
| 架构、生成契约、类型、构建 | PASS（构建保留既有大 chunk 提示） | check-final.log |
| 原 AgentWorkbench 浏览器 | 7 项 PASS，无替代挂载页 | original-chat-result.json / browser-final.log |
| 原模板/样式 | 15 文件 PASS，仅允许 base 数据绑定变化 | ui-template-style-verification.json |
| 真实强杀与恢复 | CHAT 两个持久边界 PASS，不重复模型/文本/历史 | chat-recovery.test.mjs |
| 真实配置与流协议适配 | PASS，使用加密模型配置及可控供应商传输 | chat-configured-model.test.mjs |

浏览器覆盖首段早于完成、流中刷新后仍仅一次模型调用、两轮上下文、停止后迟到文本拒绝及恢复、实际附件上传且进入冻结材料、澄清与初稿审批、显式终稿生成与终稿审批。

成果兼容决策：新八章节正文经原备注编辑器采用，原结构化字段/备注保留；不把自由文本猜测转换为旧 Schema。采用使用生成时工作稿基准 CAS。审批后材料变化会撤销批准、取消并 fence 旧运行，再生成新快照和审阅。

迁移仅在隔离库验证；本轮未发布或迁移生产库。真实供应商、SAP 及专家质量验收未执行，既有出域和交付门保留。此前失败日志和附件协议错误截图保留，最终结果以带 final 的日志与验收索引为准。
