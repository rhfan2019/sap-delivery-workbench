# ABAP FSD 后端运行与排障

> 历史文档：所述功能已在 2026-10-11 的 abap-fsd-agent 重构中删除，见[方向决策](../architecture/2026-10-11-fsd-assistant-direction-decision.md)。不代表当前可用功能。

本指南对应新的 `work/design/fsd/v1` 后端。旧 `/design/agent`、`/design/gem-fsd-v2` 和旧管理接口继续返回 410。不得用旧设计入口测试新后端。当前工程验证使用合成材料；真实 SAP 和业务验收需要另行登记。

2026-10-09 原聊天适配：正式设计页继续使用原 AgentWorkbench，模板与样式保留，仅调整请求入口和连接恢复逻辑。`work/design/fsd/v1/chat` 提供会话、运行、SSE、附件、澄清、审批、历史、日志及 Markdown。原页面浏览器测试使用真实 API、隔离 PostgreSQL 和可控合成供应商，验证流式增量先于完成、活跃流刷新后不重复调用、多轮、停止、附件及两次确认。它不证明真实模型或 SAP 的业务正确性。

聊天的每个 UI 回合有独立连续事件序号；SSE 支持 `after`/`Last-Event-ID`，只补收已持久化文本。普通问答执行 LangGraph CHAT 节点，系统提示词及配置冻结入运行资产；聊天正文不写审计/遥测。页面离开仅断开订阅，点击停止才取消运行。初稿审批不自动生成终稿，仍由原界面的“生成正式版”触发。

历史设计会话可继续查阅；继续发送时创建新后端会话并承接最近用户要求摘录，不启动旧引擎。附件软移除保留历史字节。新八章节成果通过原工作稿备注编辑器采用，保留现有结构化字段与备注，不凭空转换旧结构化 Schema；采用严格校验生成时的工作稿版本。旧成果维持原结构化采用行为。

本次增加迁移 `1791546400000_design-assistant-chat.sql`，部署前随 `npm run db:migrate` 执行；隔离测试已应用，生产数据库需按正常发布流程迁移。模型资料出域仍需 `FSD_REAL_INPUT_APPROVED=true`，真实设计还需原 SAP 能力清单及交付门。不会自动开启这些门。

## 启动与数据边界

根目录安装依赖后，部署负责人使用拥有迁移权限的配置执行：

```powershell
npm ci
npm run db:migrate
npm run fsd:checkpoint:setup
npm run fsd:observability
$env:FSD_OTLP_URL='http://127.0.0.1:4318/v1/traces'
npm run dev
```

`db:migrate` 和 `fsd:checkpoint:setup` 使用 `.env` 指定的数据库，是部署操作，不是测试命令。本次开发只在 `.runtime/fs-tests.env` 对应的隔离测试库应用迁移和 saver 初始化，没有对主数据库执行这些命令。已有 `npm start` 启动链包含业务迁移；首次使用新后端仍需完成 saver setup。运行账号只需已有业务表授权和 `fsd_checkpoint` schema 的读写授权，不用数据库 owner。

`npm run dev` 已启动 API、原 FS worker 和新设计 worker。独立部署使用现有 API 入口及 `npm run fsd:worker`，不要误以为仅 `npm run serve` 会启动 worker。多 worker 的写入由 PostgreSQL task 锁、generation 和租约控制。

浏览器进入“开发清单 → 开发项 → 设计”使用原 Agent 对话界面。新后端的独立测试界面默认“合成工程验证”；逐题保存不调用模型，提交完整批次创建 successor run。方案与 FSD 分别确认，确认精确绑定版本和范围。重置结束当前执行并保留历史，任务历史可重新选择。下载 DOCX/JSON 不重新调用模型。该测试界面只由 E2E 的本地 Vite fixture 挂载，不是正式产品页面。

## 配置

| 键                           | 含义                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `FSD_OTLP_URL`               | OTLP HTTP traces 地址；本地 `http://127.0.0.1:4318/v1/traces`                                                |
| `FSD_REAL_INPUT_APPROVED`    | 只有明确资料出域许可后配置 `true`，才能创建 REAL 任务                                                        |
| `FSD_TARGET_MANIFEST`        | 本机受控 SAP 目标登记 JSON 路径，不提交账号、口令或真实材料                                                  |
| `FSD_SAP_MODE`               | 设为 `off` 时不接入 SAP：不登记目标、不调用工具，系统结论全部作为待核实推断进入 FSD 未决项（PoC 跑通流程用） |
| `FSD_REAL_DELIVERY_APPROVED` | 两确认门、交付格式与业务准入明确后才允许真实交付                                                             |
| 现有模型/SAP 配置            | 复用管理界面的版本化模型及凭据、组织/项目 SAP 连接；不另设明文密钥                                           |

目标登记包含 organization_id、project_id、target_ref、system_id、client、environment（DEV/QAS）、deployment_version、data_egress_approved、allowed_urls、capabilities。能力条目必须覆盖 SAP-C01..07，具备真实 PASS 证据；NOT_APPLICABLE 必须有 reason 和 approved_by。空能力清单不准入。固定配置查询只接受服务器审核的 SELECT 模板，拒绝自由 SQL、写工具及外部 URL。

预算固定在 run 的 assets 中：run 模型/工具 40/60、task 160/240、Token 400k/1.6M（FSD 按章节组分批生成，一次方案约 6 次调用、FSD 编制约 5 次，另加审查修订；原 12 次/30k 不足以完成一次完整生成。为 PoC 临时值，见实现问题与修改日志）、活动时间 1800/7200 秒、run 图步数 80、模型绝对超时 300 秒、单次输出 16k Token、工具 45 秒、格式修复 1 次、工具重读最多 2 次。UNKNOWN 保留预留；实际 Token 回报会校正预留。租约 30 秒、续租 10 秒；崩溃接管计费至旧租约截止，离线等待不继续累积。

低于默认硬上限的试验预算耗尽后，可向 commands 提交 `reopen_budget`，携当前 revision、新 request_id、非空 reason/condition 和正整数 increments（例如 `{ "run_model_calls": 5 }`）。必须处于 WAITING/BUDGET；总限额不得超过上面的已验证默认值。授权单独保存 actor/时间/已有用量，原 assets 不变，用量不清零，继续原 run/thread。该命令不授权无限追加或突破默认硬上限。

当前 graph 为 `fsd-3`，模型输出 schema 为 2。升级前资产不能静默恢复，将进入 COMPATIBILITY。标准功能候选、混合范围、现状梳理先进入固定方向题；结束不产生 successor 或成果，继续冻结选择；后续补充/范围变更清除旧方向选择。字段/规则/场景可使用稳定 `field-*`、`rule-*`、`scenario-*` ID，依赖保存双方版本；遗漏受影响对象会以 `DEPENDENCY_REVIEW_REQUIRED` 暂停整笔提交。

## SAP 能力探针

`npm run fsd:sap:probe` 默认不联网，保存 SAP-C01..07 的阻塞清单。复制 `infra/fsd-probe.example.json` 到本机受控位置，填写批准人/时间、精确目标 origin/client、只读代表对象及所需属性，用 `FSD_PROBE_PLAN` 指定路径。仅在批准后使用 `npm run fsd:sap:probe -- --execute`；探针读取本地 SAP_URL/SAP_CLIENT/SAP_USER/SAP_PASSWORD，目标 origin/client 必须匹配。每能力最多 8 个精确只读样本，不接受写工具或自由 SQL，记录摘要/hash/覆盖和结构化失败，不导出业务正文。

读请求成功仅是观察结果，探针不会自动修改准入清单或标记能力 PASS。认证拒绝、证书、账号交叉隔离、分页 TTL、超时远端结果及完整依赖仍需目标环境配对试验和责任人审查。批准的 `FSD_TARGET_MANIFEST` 中，每个 PASS 条目必须有 approved_by、相对 evidence_ref 和文件原文 SHA-256；对应 JSON 需包含 capability_id、target_ref、system_id、client、deployment_version、status=PASS、approved_by、observed_at。适配器校验文件 hash 与目标绑定；管理者仍对真实证据内容及审批负责。证据路径不得逃出 manifest 所在目录。探针结果目录为 `.runtime/artifacts/abap-backend-2026-10-08/sap-probes`。

## 质量问题放行

内容检查不合格不再中断运行：按 `apps/api/src/modules/design-assistant/quality.mjs` 的 `QUALITY_POLICY` 记录一条 `quality.issue` 事件（check、severity、node_id、详情），流程继续，由用户在对话中补充修正，事后按日志复核。

| check              | 何时出现                               | 默认处理                                                                                     |
| ------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| TOOL_REJECTED      | 查询计划中有白名单外的对象或不合法参数 | 放行：去掉这些查询；一条也不剩时直接编写 FSD                                                 |
| QUERY_FAILED       | SAP 读取失败或不完整                   | 放行：模型按已有证据决定，缺失部分在 FSD 中标“推断”                                          |
| NO_PROGRESS        | 查询轮次用完或重复同样的查询           | 放行：直接编写 FSD                                                                           |
| STALE_EVIDENCE     | 保存草稿或交付时没有仍有效的 SAP 证据  | 放行                                                                                         |
| DOCUMENT_INVALID   | 合并后的文档仍不符合内容模型           | 放行：剔除不合格的最小条目，汇总为未决事项 `ISS-QC-REMOVED`（阻断=否）；文档骨架损坏时仍中断 |
| REVIEW_NOT_APPLIED | 针对审查意见的修订没有改动正文         | 放行                                                                                         |
| BLOCKING_ISSUES    | 交付时仍有“阻断=是”的未决事项          | 阻断（DELIVERY_BLOCKED）                                                                     |

权限、租约、版本冲突、检查点、只读防护和方案/FSD 的人工确认不在此列，始终中断或等待。

## Trace 与诊断

本机 [Jaeger](http://127.0.0.1:16686) 只绑定 loopback；生产/内网访问需要上层鉴权和网络限制。服务名 `abap-fsd`，按诊断中的 attempt.trace_id 查找 Trace。父子 Span 表示同步调用，恢复 attempt 通过 link 关联上一 Trace。SAP 内部调用树不在本系统覆盖范围。

Collector 限制内存 128 MiB；应用导出队列最多 1000，超时 2 秒、有限重试；失败/掉数在诊断 observation 中显示。Jaeger Badger volume 保留 14 天，不清理业务库或检查点。配置使用锁定的 Jaeger 1.76.0 进行本机验证；该版本启动明确报告 v1 已 EOL，不能据此宣称生产观测平台已就绪，生产引入前须迁移受支持版本并重跑观测验收。

界面“运行诊断/诊断包”对应：

```text
GET /api/projects/{project}/development-items/{item}/work/design/fsd/v1/tasks/{task}/diagnostics
GET .../tasks/{task}/events?after={持久事件游标}
GET .../tasks/{task}/stream
```

诊断不含原需求、附件正文、凭据、模型正文或隐藏推理。先检查 run.error、wait_reason 和节点时间线，再看固定 input_snapshot_id、Prompt hash、thread、checkpoint 和 business.commit。Trace 不可用时仍以 PostgreSQL 审计与提交账本为依据，诊断明确标示 Trace 缺失。

修复环境后，携当前 revision 和新 UUID request_id 向 `POST .../commands` 提交 `recover`；用户暂停用 `resume`。OPEN 澄清/确认门仍须回答或确认，recover 不越门。资产不兼容保持 COMPATIBILITY，不修改旧 Prompt 假装兼容。授权撤销保持 AUTHORIZATION 等待，不能自动继续。取消、结束后的 run 不可恢复为交付。

`POST .../replay` 接收新 UUID request_id：创建隔离任务、run/thread，冻结原 snapshot/assets、引用已记录模型及工具输出，禁止真实调用和正式发布。缺失记录会报告 REPLAY_DATA_MISSING；它不能重建未被保存的非法输出或隐藏推理。DBG-03 回归已验证失败运行隔离重放、零真实调用和原运行不变，逐次结果以评估清单为准。

`GET .../tasks/{task}/runs/{run}/context` 提供经任务授权且记录访问审计的冻结原文；诊断包仅保存引用。崩溃接管后的旧 attempt 标记为 ABANDONED/LEASE_EXPIRED，新 attempt 保持原 run/thread 并关联旧 Trace。恢复入口校验提交账本，即使 LangGraph 复用 pending writes 而不重入节点，也记录 `recovery.reconciled`；`LEDGER_VALIDATED` 与节点复用的 `SKIP_APPLIED` 含义不同。

## 测试和比较

```powershell
npm run test:setup
npm test
npm run check:architecture
npm run check:fs-contracts
npm run typecheck
npm run build
npm run fsd:observability
npm run test:fsd:ui
npm run eval:fsd -- --label baseline
npm run eval:fsd -- --label candidate --baseline .runtime/artifacts/abap-backend-2026-10-08/evaluations/<baseline目录>/experiment.json
```

测试只使用隔离库，真实模型/SAP 不进入默认测试。浏览器测试产生界面截图、诊断包、实际 Jaeger 返回和结果文件。固定清单位于 `tests/fixtures/design-assistant/evaluation.json`，6 个业务输入/参考模板在 `business.json`；runner 不把部分断言通过折算为整个设计案例通过。对比记录配置/hash、逐例状态和测试耗时；模型质量、Token、成本未实测时是 null，不宣称提效。

评估应串行运行，不与全量数据库测试并发，以免 test-file 时间窗收集到其他测试的 run 引用。每次保存 case-spec、source-manifest、evidence-matrix 和 experiment；矩阵含设计章节、实现符号/行号、具体断言位置、命令与数据库关联。run 引用粒度为测试文件，不能冒充单断言独占的 run。DBG-02 另有固定输入/证据、单 Prompt 变量的合成 Token/延迟/错误比较；专家质量和费用未知仍为 null。

独立进程强杀、并发屏障、UNKNOWN 读取代际、授权撤销、格式修复、循环停止、检查点失败见 `tests/integration/api/design-assistant`。当前验收进度及已知差距见 [实施与证据说明](abap-fsd-implementation.md)。禁止清空 `.runtime`、主数据库卷或用户附件来修复测试。
