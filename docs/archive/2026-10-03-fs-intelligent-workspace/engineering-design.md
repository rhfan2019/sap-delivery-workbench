# FS 智能工作区开发详细设计

2026-10-03 · 基于现有仓库的工程决策补充。本文件确定MVP实现路径，不代表已实现。与上一版的可调初值冲突时，以本文件明确写出的MVP决策为准；SAP业务/证据/审批安全原则不变。前端见frontend-design.md，执行顺序见实施计划。

## 1 现状与复用边界

静态核对：Vue 3.5、Vue Router、TypeScript、Vite；后端Node ESM/Fastify/pg；SQL迁移；测试node:test、Fastify inject、Vue SSR。已有Tiptap与表格扩展、DOMPurify；packages/contracts目前只有.gitkeep。没有验证真实运行环境或读取.env凭证。

| 现有路径 | 应复用/扩展 | 不能假设 |
|---|---|---|
| apps/web/src/components/AppLayout.vue、assets/theme.css | 侧栏、项目壳与颜色；为深链接添加route.meta标题 | 原型另起壳可直接替换生产布局 |
| services/session.ts | 同源Cookie认证；扩展可选headers/signal，保留旧api(path,body,method)签名 | 当前ApiError已携带code/details或支持If-Match |
| services/projectContext.ts、delivery/scopedRequest.ts | 项目同步、过期响应抑制、离开编辑保护 | 深路由无需防项目切换竞态 |
| delivery/context.mjs | requireSession、项目成员/归档校验、事务与组织共享锁 | 前端角色可替代写权限检查 |
| delivery/fs.mjs | 旧版本/草稿只读兼容，工作区启用后阻止旧写接口 | 旧submit可继续绕过新审批直接ready |
| delivery/files.mjs | 旧development_file/blob导入、项目下载授权 | 5MiB base64上传已支持25MiB、隔离扫描/OCR |
| models/store.mjs resolveDefaultModel | 固定model version与credential ID | text-probe-v1证明工具/视觉/结构化能力或证据未过期 |
| models/transport.mjs、crypto.mjs | 域名白名单、DNS绑定、禁止重定向、密钥解密 | probeModel就是正式推理adapter |
| sap/store.mjs effectiveConfig、sap/resolve.mjs | 项目/个人/临时配置合成与凭据绑定 | 可将密码写入Run或ContextSnapshot |
| technical/sap-mcp.mjs connectMcp/decodeResult/queryTable | MCP连接、安全进程环境与分页处理 | 当前能力已覆盖所有元数据、签名与权限工具 |
| scripts/database/provision.mjs | 显式运行角色授权清单 | 新表建好后运行账号自然有权；新表可自动被全局测试接受 |

## 2 MVP技术选型与替代边界

1. 保持模块化单体，不新增微服务/多Agent/Redis。独立Node worker进程与API共用PostgreSQL，队列使用SELECT FOR UPDATE SKIP LOCKED、租约和fencing；用轮询拉取作业，NOTIFY仅优化唤醒，丢失通知不丢任务。
2. 文档持久格式使用现有FsDocument AST；只对单个Block提供Tiptap辅助编辑，显式AST适配器支持paragraph/table/callout与稳定ID，不将任意HTML作为事实库。首版不支持全篇自由嵌套富文本。
3. Ajv 2020 + ajv-formats作为服务端通用Schema验证器，json-schema-to-typescript生成前端类型；版本选择在执行时核依赖兼容并锁package-lock，不把本次未安装的版本写成已验证。
4. 上传采用新FS专用multipart接口（@fastify/multipart），首版仍限5MiB/文件、100页PDF，与旧能力和部署配额对齐。后续扩容需一起更新反向代理/流式处理/配额/测试；原方案25MiB是建议值，不作为首版要求。
5. 本地文件存储适配现有DELIVERY_FILES_DIR，隔离/clean/derived分区与opaque UUID键；生产要求绝对持久目录和备份。对象存储为Storage接口后续适配，不首版强制引入云服务。
6. 解析worker使用pdfjs-dist提取文本和页定位，图像/扫描页用受限OCR适配器（Tesseract离线zh/en语言包）；部署时需固定语言包和字体。先检测页覆盖，表格错列按人工核对，不用低可信OCR自动决定财务金额。隔离扫描默认fail-closed；生产ClamAV/经批准企业扫描器，开发可用显式test scanner，test结果不能作为生产放行依据。
7. 模型首版接入已有注册表中的openai_responses/openai_chat协议，固定一个经过结构化与工具能力验证的model version；其他协议返回MODEL_CAPABILITY_REQUIRED，不默默使用自由文本。SAP工具编排由服务端执行器控制，不要求模型供应商原生tool calling；若适配器使用原生工具模式则独立评测。真实API请求格式在实施时复核官方文档。
8. 事件用同源SSE，初始快照+持久事件序号重放；带Cookie、不在URL放token；API服务关闭或身份失效时浏览器主动断连。可降级分页轮询同一事件接口。
9. 导出使用一个规范化RenderModel，HTML打印预览/Playwright Chromium生成PDF、docx库生成Word；锁字体包和渲染器版本。Word版式与PDF不保证像素相同，但文本、表格、引用、版本水印必须同源一致。正式交付前实际渲染QA，不能用HTML改扩展名伪造docx。

## 3 目录与依赖方向

下面是**目标结构**，不是已存在文件清单。只在负责该任务时创建有内容的文件，不预建全部空壳。

```text
apps/web/src/features/fs-workspace/
  views/                 FsManagementView.vue, FsWorkspaceView.vue, FsVersionsView.vue, FsReviewView.vue
  conversation/          ConversationPane.vue, Composer.vue, ClarificationCard.vue, useMessages.ts
  document/              DocumentPane.vue, FsBlockRenderer.vue, BlockEditor.vue, selection.ts
  changes/               ChangeSetReview.vue, ConflictDialog.vue, useChanges.ts
  evidence/              EvidenceDrawer.vue, AttachmentDrawer.vue, ContextDrawer.vue
  review/                ReviewPanel.vue, ExportDialog.vue
  state/                 useFsWorkspace.ts, useRunEvents.ts
  api.ts                 仅HTTP/SSE适配，不处理业务状态迁移
  fs-workspace.css        命名空间样式，复用theme变量
apps/api/src/fs-workspace/
  routes.mjs             仅注册子路由
  access.mjs             项目范围+工作区capabilities
  workspace/             routes.mjs, service.mjs, repository.mjs
  conversation/          routes.mjs, service.mjs, repository.mjs
  document/              routes.mjs, service.mjs, repository.mjs, ast.mjs
  changes/               routes.mjs, service.mjs, impact.mjs
  evidence/              routes.mjs, service.mjs, repository.mjs, sap-gateway.mjs
  attachments/           routes.mjs, storage.mjs, parser.mjs, scanner.mjs
  review/                routes.mjs, service.mjs, gates.mjs
  export/                routes.mjs, render-model.mjs, html.mjs, docx.mjs, pdf.mjs
  runs/                  routes.mjs, queue.mjs, worker.mjs, checkpoints.mjs, events.mjs, nodes.mjs
  agent/                 context.mjs, executor.mjs, validate.mjs, prompts/ (A-H版本化正文)
apps/api/src/models/     inference.mjs, capabilities.mjs (新增，复用已有store/transport/crypto)
packages/contracts/fs-workspace/
  domain/                持久化读取契约
  commands/              API写入DTO，无租户/actor/verified/approved输入
  proposals/             模型候选契约
  events/                RunEvent及进度事件
  generated/             types.ts (由Schema生成，禁止手改)
  index.mjs              Schema注册及版本常量，无数据库/浏览器依赖
scripts/                 fs-worker.mjs, generate-fs-contracts.mjs, import-legacy-fs.mjs
scripts/lib/             仅多个脚本真正共用的基础工具
database/migrations/    新增递增时间戳SQL，不重写已执行迁移
tests/fs-workspace/     unit、api、database、worker、e2e、fixtures分目录
```

依赖方向：views→feature组件/state→api→contracts；routes→access/service→repository/adapters；worker→节点service；contracts不得依赖apps。模型接入放models，SAP系统配置仍放sap，FS专属证据语义留fs-workspace/evidence。不要创建第二套auth、project、model-registry或MCP配置。

职责优先于行数。单文件超过约300行或出现多种变更原因时检查拆分，不机械按行数拆一行包装；不向app.mjs、DeliveryView.vue、FsEditor.vue继续堆完整工作区实现。不创建misc/utils/helpers万能目录。生成物/截图/测试夹具不得混入src；原型保留docs，不能作为正式实现入口。目录改变须更新实现计划与文档链接。

## 4 数据模型与并发约束

新增表统一schema app、uuid主键；租户内实体带organization_id/project_id/workspace_id，非全局配置表必须复合FK到(fs_workspace的同范围唯一键)。所有时间timestamptz UTC，前端按用户时区显示。工作区并发令牌row_version与HTTP列表sequence使用十进制字符串传输。现有v1.0 FsDocument/RunEvent Schema中的revision/sequence仍为整数，序列化必须检查Number.isSafeInteger并限制≤9007199254740991，不能静默截断；SSE id为十进制字符串。后续若需超出此范围，显式升级契约。模型候选revision不能直接充当数据库并发令牌。

| 表 | 主要列与约束 | 索引/可变性 |
|---|---|---|
| fs_workspace | item_id FK、fs_number、profile、template_version_id、draft_head/review_head/baseline_head可空、row_version bigint、active、legacy_source_id | UNIQUE(item_id) WHERE active；heads复合FK限定同工作区；头指针可变 |
| fs_template_version | organization_id、template_key、version、schema_version、slots jsonb、ruleset/renderer版本、hash | UNIQUE(org,key,version)；发布后不可改 |
| fs_session | workspace_id、title、created_by、archived_at | (workspace,created_at,id)游标分页 |
| fs_message | session_id、seq bigint、client_message_id uuid、role、body、source_selection jsonb、created_by/time | UNIQUE(session,seq)、UNIQUE(session,client_message_id)；不可覆盖 |
| fs_attachment | workspace_id、client_upload_id、source_file_id可空、blob_key、hash、size、mime、scan_status、created_by/time | UNIQUE(workspace,client_upload_id)；原blob不可变，状态投影可变 |
| fs_parse_result | attachment_id、parser_version、revision、state、regions/coverage/warnings jsonb、hash | UNIQUE(attachment,parser_version,revision)；不可变 |
| fs_evidence | source_kind/source_id/source_revision、locator、conclusion、target_binding、scope、hash、receipt_id、expires_at、limitations、created_by/time | source与授权范围复合校验；不可变、撤销另记事件 |
| fs_entity | stable_id、kind(requirement/rule/decision/issue/verification)、head_revision | 稳定身份，UNIQUE(workspace,stable_id) |
| fs_entity_revision | entity_id、revision、payload jsonb、content_hash、created_by/time | UNIQUE(entity,revision)；不可变；schema按kind校验 |
| fs_dependency | source_entity/source_revision、target_entity/target_revision、relation(supports/depends_on/implements/tests) | 全部限定同项目、复合FK到revision；索引target用于反向传播 |
| fs_confirmation | subject_id/revision/hash、action(confirm/reject/invalidate)、supersedes_id、actor_id、context_snapshot_id、created_at | append-only；有效状态从最新合法链投影，不能UPDATE旧确认 |
| fs_document_revision | workspace_id、seq bigint、formal_number可空、parent_id、template_version_id、ast jsonb、entity_manifest/evidence_manifest、content_hash、created_by/time、origin_run_id | UNIQUE(workspace,seq)、UNIQUE(workspace,formal_number) WHERE NOT NULL；不可变 |
| fs_change_set | workspace_id、base_revision_id、proposal jsonb、hash、status(proposed/accepted/rejected/stale)、result_revision_id | 内容不可变，状态及结果原子更新；不能重用已接受集 |
| fs_context_snapshot | version_manifest jsonb、message范围、config_versions、input_hash、token/coverage | 不含凭证；不可变 |
| fs_run | session_id、input_snapshot_id、principal_user/session_id、intent、status、node_id、attempt、lease_owner/until、fencing bigint、cancel_epoch、next_attempt_at、budget_json | 索引(status,next_attempt_at)；一工作区一个active写任务；只读解析独立作业 |
| fs_run_checkpoint | run_id、node_id、attempt、input_hash、output_refs、fencing、created_at | UNIQUE(run,node,attempt,input_hash)；不可变 |
| fs_run_event | run_id、sequence bigint、event_id uuid、payload jsonb、created_at | UNIQUE(run,sequence)、UNIQUE(event_id)；append-only；兼作SSE outbox |
| fs_command_receipt | workspace_id、actor_id、action、key uuid、request_hash、status/result jsonb、created_at | UNIQUE(workspace,actor,action,key)；与副作用同事务 |
| fs_review | document_revision_id/hash、ruleset/evidence_manifest_hash、kind(rule/ai/human)、findings/coverage jsonb、actor_id、created_at | append-only；AI与人工来源不可互换 |
| fs_review_request | document_revision_id、state(open/returned/approved/closed)、policy_version、created_by/time | 唯一活动送审版本/工作区，review_head指向其文档 |
| fs_approval | review_request_id、document/hash、manifest_hash、policy_version、role、actor、action、reason、created_at | append-only；相同角色可有新决议，用最新有效决定；禁止作者自批政策 |
| fs_project_role | project_id/user_id、role(business_approver/technical_reviewer/publisher)、enabled | 复合FK到项目成员；仅项目内管理员配置 |
| fs_export | doc_revision、format、manifest_hash、status、blob_key/hash、requested_by/time | UNIQUE(workspace,doc,format,manifest_hash)；下载重新鉴权 |
| fs_publication | workspace_id、document_revision_id、previous_id、actor/time、action(publish/withdraw) | append-only；baseline_head是投影；只有发布事务改development_item.stage |

稳定业务实体内容/文档revision与状态投影分开：FsDocument.lifecycle由review/publication投影生成，不通过UPDATE不可变AST修改。review_head固定送审文档，draft_head可前进；baseline_head只发布/撤销时变。迁移时先建工作区和revision表，再用ALTER添加头指针复合FK解决循环；禁止因循环省略所有跨工作区保护。

版本命名：工作草稿rN使用seq，保存版本/送审时分配formal_number产生Vn快照；同一内容可以多个revision但每条来源可追溯。正式号在工作区行锁下分配，不用无锁MAX+1。LLM FsProposal没有正式号；领域FsDocument.version_number对未编号草稿序列化为0，正式版本为正整数。

数据库运行角色：不可变表只GRANT SELECT/INSERT；状态表SELECT/INSERT/UPDATE；如使用追加审计表，不能授予UPDATE/DELETE。现有schema.test精确表清单需更新，runtime.test增加不可变表写保护。SQL迁移不执行生产破坏性down，保留前滚修复与备份恢复方案。

## 5 API与事件协议

完整机器可读路由契约见api.openapi.json；这是新增API的设计，不代表服务已部署。基路径B=`/api/projects/{projectId}/development-items/{id}/fs-workspace`，后端参数id复用deliveryContext.item。Header Idempotency-Key为UUID，写工作区头需If-Match:`"ws:<uuid>:<rowVersion>"`。缺少前置条件428，版本冲突409，权限不足403（项目/资源不可见统一404），未通过门禁422，未认证401，超限413，不可用能力409。

成功输出固定{data,meta:{request_id,workspace_revision}}，列表data={items,nextCursor}；错误{code,message,details,request_id}，details为受限对象不含SQL/凭证。现有全局errorHandler保留旧message兼容，新FS错误使用注册的code白名单，不把任意error.details透传。command收据端点允许前端查询超时写结果。

### 5.1 DTO明确区分

模型与新增HTTP统一使用snake_case，外层meta使用request_id/workspace_revision；现有模块camelCase不改。适配层命名映射集中api.ts/serializer，不在组件各自转换。

每个写命令只包含用户意图及版本引用。租户、审批人、审计时间、verified、正式号均不能由请求体传入。服务端authorizes→schema→IDs→semantics→事务复核。新实体tmpID只能在ChangeSet局部作用域，事务先建完整映射再重写引用。

### 5.2 重要操作语义

- GET B不创建对象，无工作区返回data.workspace=null并给legacy摘要；POST B幂等建一个活动工作区并迁移指定旧FS快照。
- POST sessions/{sessionId}/messages写message+run+queued事件在一个事务完成；正在有写Run时run排队，不改变旧snapshot。相同client_message_id不同内容409。
- GET events?after=序号是SSE；返回id:sequence、event:type、data:RunEvent。每15秒heartbeat不落业务事件；每60秒及每批事件校验访问状态。断线重连使用Last-Event-ID，显式after仅首次使用，取二者最大合法值且不超过已知尾序号。
- GET snapshot提供当前heads、capabilities、messages游标、active_runs及每run最新序号。SSE至少一次送达，客户端只应用seq大于已应用值；发现缺口先补查，不把乱序完成当当前结果。事件保留30天初值，过期游标409 EVENT_CURSOR_EXPIRED，重新snapshot。
- POST changes/{changeId}/accept输入accepted_group_ids。服务端校验选择是依赖闭包的并集；不接受单条缺依赖操作；同一事务实体/文档修订、失效、head、收据、事件。新增Issue可保持讨论稿，但正式门禁必须失败。
- POST confirmations绑定subject_revision/hash及snapshot。自由文字“确认”先转具体候选卡，不能作为审批端点代理。
- POST reviews允许早期审阅，返回gate可否批准；review级错误阻止送审，release级错误允许审阅但不能批准。审批人与作者职责分离由project policy固定；技术/业务角色都必须通过。
- POST publications只有publisher可调用；MVP配置business approver可同时publisher，但不自动授予。新版本发布时检查精确review、最新证据和两角色决定，在工作区锁内写publication/更新baseline/开发项ready。
- 所有导出GET下载实时检查项目与用户权限，历史替代基线必须标注状态；原件和导出blob不能通过静态文件服务直接公开。

## 6 核心算法与可实现边界

### 6.1 变更影响闭包

图的边表示A depends_on B（A依赖B）。修改集合S先包含变化实体；反向遍历依赖边求所有依赖者闭包C，以visited防环并设工作区最大节点预算；按entity.kind分类到章节/测试/确认/评审/技术验证。先用确定性图得到最低影响集，再让AI提出遗漏依赖，新增依赖亦需Schema/引用检查。模型不得删除确定性影响。若图覆盖不足或预算耗尽，新增review阻断Issue，不能报告全部已检查。

业务对象、颗粒度、生命周期变化→重新需求分析；规则/金额/权限变化→失效相关业务确认、评审和受影响技术验证；纯排版仅新文档评审，不失效不变实体确认。审批绑定整文档，任何新版本都不得自动继承旧审批。

### 6.2 证据判定

网关生成不可伪造的工具回执ID和原始结果hash，保存目标绑定、调用类型、覆盖与限制。引用校验必须命中同授权workspace/项目的现存receipt/locator；source text只证明来源陈述。Verification.status按request scope分开：object_exists、signature、business_applicability、runtime_authorization、transaction_behavior，不允许一个“对象存在”验证项覆盖所有结论。业务适用性由技术评审证据/受控测试记录判定，AI只能提出interpretation。

缺失、不可读、不存在、结果不完整分开。现queryTable把not-found与不可检索合并时，新adapter只能返回unreadable/ambiguous_not_found，并建验证缺口，不能宣称不存在。只读工具白名单由服务端工具注册表映射；工具名/SQL/URL/命令不能从材料直接决定。

### 6.3 原子保存与幂等

写事务顺序固定：组织成员共享advisory锁→项目/工作区行锁→重新鉴权与归档检查→命令收据查重→If-Match→fencing/cancel_epoch→引用与业务门禁→插入所有不可变记录→更新heads/状态→追加事件与收据→提交。外部模型/SAP调用不在持有SQL锁的事务内。相同幂等键同请求hash回原收据；不同hash409。客户端超时先GET commands/{key}?action=...，只有not-found且原请求已确定未提交才能同键重试。

### 6.4 运行器与恢复

lease30s、每10s续租（可调初值）；抢占递增fencing，写入时校验当前token。只有独立节点输入输出hash一致才复用CP。用户关闭浏览器不取消；用户会话过期/角色撤销，下一节点或提交前暂停waiting_user，记录AUTH_RECONFIRM_REQUIRED；恢复必须重新认证且授权，换新principal session并记录审计，不重用失效会话。

worker用服务账号连DB，但不能因此绕过业务principal。长期无人任务不能延长原用户session的有效性。临时SAP密码只在内存短期使用，不放CP；恢复时需重新输入则waiting_evidence。新Run固定model config/prompt/schema/template版本。credential撤销即停止后续调用。

流式输出只有对话可暂存临时片段；完整JSON通过校验后才发布artifact.proposed。工作区head由明确接受修改/保存驱动，不能由供应商流式token更新。所有重试预算按主方案初值，查询总量含工具内部分页和批量子查询。

### 6.5 结构与语义检查清单

类型化Rule在v1.1的HTTP领域扩展包括applicability、input_refs、output_refs、algorithm_summary、authorization_refs、exception_refs、test_refs、currency/unit_policy、confirmation_subject；不是首版通用规则执行引擎。至少确定性实现：表格shape、ID唯一/存在/同项目、模板slot必需性、每核心规则有正常/异常测试、操作type与value对应、目标hash/version、确认对象一致、approved需要合法审批、证据scope/过期、金额样例使用decimal.js且按币种单位分组。不把这些规则留给一段AI评语。

新增强类型Rule契约及辅助DTO见api.openapi.json components；模型侧原v1.0提议由服务端补全这些结构前，不能标作完整开发候选。只把required字段补空字符串不能通过核心规则门禁；源缺口必须形成Issue。

## 7 导出、迁移与发布

RenderModel由AST纯函数编译，使用明确段落/表/引用/测试顺序，先计算规范化内容hash，再送HTML、docx、PDF适配器。字体字体包版本在manifest中；导出worker只访问本地受信模板与授权blob，不加载任意URL。模板升级创建新version，不修改历史renderer manifest。导出包完成后比对段落/表格单元格/引用计数及hash，再原子标ready。

旧FS迁移：先只读导入旧draft/versions及submitted pointer，保存legacy source id/hash；九章映射五章，异常无法归属保留pending；原审批记录缺失时标legacy_submission，不生成Approval。迁移完成且checksum一致后设置项目/工作区feature flag；旧PATCH/versions/submit对该item返回409 FS_WORKSPACE_ENABLED。尚未迁移项继续旧流程，双流程不能写同一item。历史ready不得被迁移自动取消；旧基线以legacy来源保留，后续新版本走新门禁。

回滚：关闭新入口但不重新启用已迁移项旧写口，保留只读访问及数据；用前滚修复恢复服务，不能把新结构强行压回九段文本造成损失。上线前备份恢复演练包含DB与blob快照。

## 8 工程完成判定

### 2026-10-03 实施澄清

- 新增 `fs_project_command_receipt`：角色配置可早于工作区创建，原 workspace 级命令收据不能承载此操作。该表以 organization/project/actor/action/key 唯一，保留 request_hash/result，与角色更新和 audit_event 同事务；运行账号仅 SELECT/INSERT。
- 角色列表返回用户角色绑定的 revision；未配置成员初始 revision 为 `0`，移除角色保留禁用行和递增版本。OpenAPI 与生成类型同步此字段。
- `fs_run_checkpoint` 增加辅助契约要求的 idempotency_receipts、cancel_epoch、config_versions、last_event_sequence。尚未启用 worker；表和 DTO 不代表恢复逻辑已实现。
- 历史导入逻辑单独位于 `workspace/legacy.mjs`，避免 service 混合章节转换；迁移保留 source JSON、legacy-json-v1/sha256、版本号、legacy_submission 来源，不创建新审批。import CLI 通过认证 API 执行，不直接以数据库 owner 绕过项目权限。
- 本地目录没有 `.git`，无法提供提交或原有未提交修改清单。仅在当前目录增量实施，不初始化 Git、不建其他聊天或代理。

没有“按钮能点就完成”。必须可用真实持久化API走完整链，演示数据仅限测试；无连接时缺口可见且审批阻断。数据库并发/跨项目/旧接口绕过/超时重放测试必须通过；UI在390/1024/1440与200%缩放检查；Word/PDF实际生成并验内容。生产扫描器/OCR语言包/字体/供应商协议未配置时显示可恢复配置缺口，不能伪装成功。
