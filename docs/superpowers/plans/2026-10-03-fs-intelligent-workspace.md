# FS 智能工作区实施计划

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task in the current session. Use subagent-driven-development only if the user separately authorizes that execution method. Track the checkboxes below; a checked task requires verification evidence.

**Goal:** 在现有SAP智能交付平台中实现材料→对话→结构化FS→关联修订→评审审批→发布开发依据→Word/PDF交付的持久闭环。

**Architecture:** 保持Vue/Fastify/PostgreSQL模块化单体；新增按功能组织的fs-workspace模块与独立Node worker。服务端强制身份、证据、版本、审批、幂等和任务恢复。主Agent输出候选，不直接控制权威状态。

**Tech Stack:** 当前Node ESM、Vue 3、TypeScript、Vue Router、Fastify、pg、Tiptap、node:test；按详细设计引入Ajv2020、multipart、PDF/OCR与导出适配器，锁依赖版本并做兼容测试。

**Spec:** [主设计](../specs/2026-10-03-fs-intelligent-workspace/design.md)、[前端设计](../specs/2026-10-03-fs-intelligent-workspace/frontend-design.md)、[工程详细设计](../specs/2026-10-03-fs-intelligent-workspace/engineering-design.md)、[OpenAPI](../specs/2026-10-03-fs-intelligent-workspace/api.openapi.json)、[验收清单](../specs/2026-10-03-fs-intelligent-workspace/acceptance.md)。必须同时读Spec和本计划。

## Global Constraints

- 项目根D:/Workspace/sap-delivery-workbench；SAP范围仅S/4HANA OP/PCE传统ABAP；本模块不执行清账/过账。
- 先读取适用AGENTS.md、git status与实际代码；保留用户未提交修改。本计划中的新文件是目标位置，不是假设已存在。
- 严格采用engineering-design.md目录与依赖方向；复用认证、项目上下文、模型注册、SAP配置、主题和既有开发项。不并列创建第二套系统。
- LLM只输出候选；租户、actor、真实证据、正式版本、验证和审批状态只能服务端生成。
- 实现前重新核实新增依赖及供应商当前API，记录版本；不将本地Schema通过当作真实模型集成通过。
- 首版附件5MiB/100页；所有写命令有幂等键；head变更必须If-Match；严格项目范围与不可变历史。
- 工作区、送审、基线分开；未确认/未验证的讨论稿允许保存，正式发布门禁不允许绕过。
- 前端原型演示栏、角色切换、假证据、预设成功、仅toast保存/导出都不能进入生产实现。
- 不运行生产迁移、不删除用户数据、不推送/部署/合并；完成代码和可审阅验证即可。每个任务可做独立本地提交，但仅暂存本任务文件，按环境权限执行。
- 开发完成后必须报告真实测试范围；联机连接缺失只标记集成阻断，不能用模拟结果声称正式成功。

## Review Focus

1. 输入法Enter、超长中文文本、多行表格与200%缩放，不能误发消息或遮挡关键按钮；T09/T15覆盖。
2. 项目切换与慢请求返回、SSE身份过期，不能显示前一个项目的数据；T03/T08/T09覆盖。
3. 接受修改/批准后网络断开，重试不能多建版本/审批；T05/T07/T11覆盖。
4. 原件删除/语言包缺失/长表分页，不能静默丢内容或把失败当完整导出；T06/T14覆盖。
5. 旧submit接口和后台worker身份不能绕过新门禁；T02/T07/T11覆盖。

## 执行分组与质量门

依赖顺序：T01→T02→T03；T04—T08依赖底座；T09/T10消费已定API；T11/T12打通发布与证据；T13接真实模型；T14导出；T15端到端与发布交接。不按“先写所有前端、再猜后端”分工。

切片A（T01—T05）：手工结构化FS的安全版本底座；切片B（T06—T10）：材料、任务与对话候选闭环；切片C（T11—T13）：证据与真实Agent发布门禁；切片D（T14—T15）：交付导出和验收。每片有可演示结果，但全部完成才算本次功能交付。

## T01 契约落地与测试入口

**Files:** Create `packages/contracts/fs-workspace/{domain,commands,proposals,events}/`具体JSON；`packages/contracts/fs-workspace/index.mjs`、`generated/types.ts`；`scripts/generate-fs-contracts.mjs`、`scripts/test-fs.mjs`；`tests/fs-workspace/unit/contracts.test.mjs`。Modify根`package.json`、`package-lock.json`。

**Interfaces:** `validateProposal(kind, value): {ok, errors}`，`validateCommand(operationId,value): {ok,errors}`由后续agent/validate封装调用；生成类型从同一JSON源导出。契约运行时文件不从docs路径加载。

- [x] 写用例`reject_authority_fields_and_missing_context`：FsProposal带lifecycle=approved必须失败；VerificationProposal带status=verified必须失败；合法样例通过；未知证据ID在结构层可通过并标记需L4。
- [x] 运行`node --test tests/fs-workspace/unit/contracts.test.mjs`，确认尚未实现时失败原因是缺能力而非测试语法错误。
- [x] 从设计Schema和OpenAPI落实运行时契约，补RuleDetail与辅助DTO；所有跨文件$ref离线解析；生成TS并禁止手改。新增`test:fs`脚本递归收集tests/fs-workspace的.test.mjs，排除e2e，避免现有根glob漏测。
- [x] 重跑上述测试；运行生成命令两次应无差异。提交前review确认没有按示例hash/ID写死实现。

## T02 数据表、权限、历史迁移

**Files:** Create下一未使用时间戳`database/migrations/*_fs-workspace-core.sql`，`apps/api/src/fs-workspace/workspace/{repository,service}.mjs`、`scripts/import-legacy-fs.mjs`、`tests/fs-workspace/database/schema.test.mjs`、`tests/fs-workspace/database/legacy.test.mjs`。Modify `scripts/db-provision.mjs`、`tests/database/schema.test.mjs`、`tests/database/runtime.test.mjs`、`apps/api/src/delivery/fs.mjs`。

**Interfaces:** `createWorkspace(db, scope, command): Workspace`；`importLegacyFs(db, scope, legacyId): {workspaceId,manifest}`；`readWorkspace(db,scope): Snapshot`。Scope只能从已认证上下文生成。

- [ ] 测试`cross_workspace_heads_rejected`、`immutable_history_not_updatable`、`legacy_import_idempotent`、`migrated_item_old_submit_denied`：跨workspace FK失败；运行账号不能UPDATE文档/审批；重复导入不增数据；新工作区启用后旧submit返回409。
- [ ] 建独立可销毁本地数据库（库名如sap_fs_test_dev），使用`.runtime/fs-tests.env`，不改主.env。执行测试前确认主机回环与库名保护；执行`node --env-file=.runtime/fs-tests.env --test tests/fs-workspace/database/schema.test.mjs tests/fs-workspace/database/legacy.test.mjs`观察初始失败。
- [ ] 按工程表结构实现DDL/索引/复合FK/append-only权限；迁移保留九章原文hash和legacy_submission；草稿/送审/基线分离；旧接口写保护必须服务端强制。
- [ ] 重跑数据库测试与现有schema/runtime测试（同隔离env），记录迁移前后计数、rollback策略；仅提交迁移和本任务文件。

## T03 项目访问、角色与HTTP错误

**Files:** Create `apps/api/src/fs-workspace/access.mjs`、`routes.mjs`、`workspace/routes.mjs`、`review/roles.mjs`、`tests/fs-workspace/api/access.test.mjs`。Modify `apps/api/src/app.mjs`、`apps/web/src/services/session.ts`。

**Interfaces:** `authorizeWorkspace(req,{write,capability}): {scope,current,workspace,capabilities}`；`registerFsWorkspaceRoutes(app,pool,organizationId,requireSession,adapters)`；向后兼容`api<T>(path,body?,method?,options?:{headers,signal})`与ApiError.code/details。

- [ ] 测试`outside_project_is_404`、`archived_project_write_denied`、`author_cannot_self_approve`、`revoked_role_rechecked`及老调用签名仍工作；错误不含SQL/凭据。
- [ ] 隔离env运行`node --env-file=.runtime/fs-tests.env --test tests/fs-workspace/api/access.test.mjs`。
- [ ] 复用deliveryContext项目权限和锁；新增项目FS角色API与capability投影；route handler只做输入与service调用；错误白名单扩展全局handler，不破坏旧message响应。
- [ ] 回归auth/admin/delivery相关用例与新增测试，查看未授权响应内容后提交。

## T04 文档AST、模板与结构校验

**Files:** Create `apps/api/src/fs-workspace/document/{ast,repository,service,routes}.mjs`、`export/render-model.mjs`、`tests/fs-workspace/unit/ast.test.mjs`、`tests/fs-workspace/api/document.test.mjs`。

**Interfaces:** `validateDocument(ast,template,manifest): Finding[]`；`toRenderModel(document,template): RenderModel`；`snapshotVersion(db,scope,input): Head`；`getDocument(db,scope,id): FsDocument`。

- [ ] 测试`table_shape_must_match_columns`、`required_template_slots_present`、`duplicate_stable_id_rejected`、`template_upgrade_does_not_change_old_version`；草稿pending块允许，但正式门禁失败。
- [ ] 运行`node --test tests/fs-workspace/unit/ast.test.mjs`与隔离env的document API测试，确认红灯。
- [ ] 实现五章template slots、语义块、测试引用；RenderModel纯函数同时供前端/导出使用；保存版本在工作区锁下分配formal_number，不能无锁MAX+1。
- [ ] 相同文档/模板重复编译内容hash一致；历史模板不变；测试通过后提交。

## T05 变更集、依赖图、确认与并发

**Files:** Create `apps/api/src/fs-workspace/changes/{routes,service,impact}.mjs`、`document/confirmations.mjs`、`tests/fs-workspace/unit/impact.test.mjs`、`tests/fs-workspace/api/changes.test.mjs`。

**Interfaces:** `computeImpact(graph,changedIds): Impact[]`；`acceptChange(db,scope,command,expectedHead,idempotency): Workspace`；`confirmSubject(db,scope,command,expectedHead): Confirmation`；`rebaseChange(scope,changeId,newBase): Run`。

- [ ] 测试`reverse_dependency_closure_with_cycle`、`reject_partial_atomic_group`、`invalidates_confirmation_and_review`、`same_key_same_result`、`same_key_new_body_conflicts`、`stale_subject_confirmation_denied`；领域合法性与Schema形状分开断言。
- [ ] 运行unit impact和隔离changes API测试。
- [ ] 实现确定性反向依赖闭包、临时ID映射、前值hash检查、If-Match、同事务失效/head/receipt/event。旧审批只留历史，新版不得引用旧通过记录。人工编辑生成同一ChangeSet，恢复为新revision。
- [ ] 两并发连接同时接受同base：恰好一个成功一个409；超时后按原key查原结果；测试通过后提交。

## T06 附件隔离、解析与来源证据

**Files:** Create `apps/api/src/fs-workspace/attachments/{routes,storage,parser,scanner}.mjs`、`evidence/{repository,service,routes}.mjs`、`tests/fs-workspace/api/attachments.test.mjs`、`tests/fs-workspace/worker/parser.test.mjs`、fixtures合成PDF/PNG；Modify部署依赖配置及package。

**Interfaces:** `storeQuarantined(stream,{maxBytes,scope,uploadId}): Attachment`；`scanAttachment(id): ScanResult`；`parseAttachment(id,{regions,parserVersion}): ParseResult`；`createSourceEvidence(db,scope,parse): Evidence[]`。

- [ ] 测试精确5MiB通过/5MiB+1拒绝、扩展名与magic不符、同uploadId重放、跨项目不泄露去重、缺页/错列保留coverage、扫描器不可用fail-closed、缺语言包明确失败。
- [ ] 隔离env运行attachments/parser测试，夹具只用合成内容。
- [ ] 流式multipart、opaque键、隔离扫描、页/区域CP、OCR适配、旧development_file只读关联；原件永不覆写。新增依赖不写进业务组件；扫描/OCR运行在受限进程。
- [ ] 验证失败不会把残缺结果标complete，不将文件内容打印日志；清理只限测试本次创建的路径；通过后提交。

## T07 持久任务执行与身份恢复

**Files:** Create `apps/api/src/fs-workspace/runs/{queue,worker,checkpoints,nodes,routes}.mjs`、`scripts/fs-worker.mjs`、`tests/fs-workspace/worker/recovery.test.mjs`；Modify `scripts/components.mjs`及实际部署启动入口（先阅读，不假定文件格式）。

**Interfaces:** `enqueueRun(db,scope,input): Run`；`claimRun(workerId): Lease|null`；`runOne(lease,adapters): Promise<void>`；`commitNode(lease,inputHash,outputRefs): Checkpoint`；`cancelRun(scope,id): Run`。

- [ ] 测试worker在外部查询后/DB提交前/提交后崩溃、租约过期旧worker写拒绝、取消先/提交先两顺序、principal session失效暂停、恢复不重建版本。
- [ ] 运行隔离`node --env-file=.runtime/fs-tests.env --test tests/fs-workspace/worker/recovery.test.mjs`。
- [ ] SKIP LOCKED、30s租约/10s续租、递增fencing、CP复用、预算重试；外部调用不持SQL锁；身份/归档提交时重新检查；临时密码不落CP；worker可注入fake adapters但production禁止fake。
- [ ] 故障注入断言一个命令最多一个正式副作用，验证进程优雅退出/重启恢复后提交。

## T08 会话、消息、快照与SSE

**Files:** Create `apps/api/src/fs-workspace/conversation/{routes,service,repository}.mjs`、`runs/events.mjs`、`agent/context.mjs`、`tests/fs-workspace/api/events.test.mjs`、`tests/fs-workspace/unit/context.test.mjs`。

**Interfaces:** `appendMessageAndRun(db,scope,sessionId,input): {message,run}`；`buildContext(scope,request,budget): ContextSnapshot`；`readRunEvents(scope,runId,after): RunEvent[]`。

- [ ] 测试重复client_message_id不同内容409、运行中新消息保留但不改旧快照、关键规则不能被摘要裁剪、越权检索前过滤、SSE重复/缺口/过期游标、成员撤销断连。
- [ ] 分别运行unit context和隔离events测试。
- [ ] 实现消息游标、快照manifest、相关依赖装载、15s heartbeat/60s鉴权、snapshot后重放；不要把全部历史和附件塞给模型；SSE不直接流式写AST。
- [ ] 断线后不新增Run，最后seq恢复、JSON整数安全检查通过后提交。

## T09 前端路由、管理与对话骨架

**Files:** Create前端`features/fs-workspace/views/{FsManagementView,FsWorkspaceView}.vue`、`state/{useFsWorkspace,useRunEvents}.ts`、`conversation/{ConversationPane,Composer,ClarificationCard}.vue`、`conversation/useMessages.ts`、`api.ts`、`fs-workspace.css`；Modify router/index.ts、AppLayout.vue、DeliveryView.vue；Create `tests/fs-workspace/unit/ui-state.test.mjs`、`tests/fs-workspace/e2e/workspace.spec.ts`。

**Interfaces:** `useFsWorkspace(scope): {snapshot,loading,error,refresh,capabilities}`；`useRunEvents(scope,runId): {status,lastSequence,disconnect}`；组件Props/事件按frontend-design.md。

- [ ] 写慢A项目响应晚于B项目、unmount断SSE、readonly禁用、输入法Enter不发送、发送失败保留文本、首次空态/解析状态测试；e2e仅对隔离测试环境。
- [ ] 运行`node --test tests/fs-workspace/unit/ui-state.test.mjs`；安装与锁定Playwright测试依赖归本任务，后续`npx playwright test --config tests/fs-workspace/e2e/playwright.config.ts`。
- [ ] 复用既有壳/主题/projectContext/认证；路由绑定项目ID；正式移除演示栏，数据只来自API，不抄原型单一state和setTimeout成功。
- [ ] 390/1024/1440截图、键盘导航和输入法测试通过；typecheck/build通过后提交。

## T10 文档预览、选区修改与差异交互

**Files:** Create前端`document/{DocumentPane,FsBlockRenderer,BlockEditor}.vue`、`document/selection.ts`、`changes/{ChangeSetReview,ConflictDialog}.vue`、`changes/useChanges.ts`、`views/FsVersionsView.vue`、`evidence/{EvidenceDrawer,AttachmentDrawer,ContextDrawer}.vue`；Create `tests/fs-workspace/unit/selection.test.mjs`、`tests/fs-workspace/e2e/changes.spec.ts`。

**Interfaces:** `selectionFromRange(documentVersion,block,range): Selection`；`acceptGroups(changeId,groups,etag): Workspace`；`renderBlock(RenderBlock)`不执行不可信HTML。

- [ ] 测试emoji/中文UTF-16选区一致、旧选区hash拒绝、段落变更不抹人工编辑、依赖组不可部分接受、恢复历史不继承审批、drawer关闭焦点回原按钮。
- [ ] 运行selection单元测试与changes e2e，先确认失败点。
- [ ] 渲染AST/表格/引用；Tiptap只编辑块，经适配器生成ManualEdit；差异依据稳定ID；冲突展示三方并调用rebase endpoint，不能本地覆盖服务器。
- [ ] 测试通过，长表与200%缩放无遮挡；无v-html泄漏后提交。

## T11 评审、批准、发布与旧接口门禁

**Files:** Create `apps/api/src/fs-workspace/review/{routes,service,gates}.mjs`；Modify `apps/api/src/fs-workspace/review/roles.mjs`；Create 前端`views/FsReviewView.vue`与`review/ReviewPanel.vue`；Create `tests/fs-workspace/api/review.test.mjs`、`tests/fs-workspace/e2e/review.spec.ts`。

**Interfaces:** `evaluateReleaseGates(document,manifest,policy): Gate[]`；`submitReview(scope,command): ReviewRequest`；`recordApproval(scope,command): ReviewRequest`；`publishBaseline(scope,command): Workspace`。

- [ ] 测试release缺口可早期review但批准422；作者不能自批；技术/业务两角色且精确hash；批准V4不改变V3基线；publish才替代；重复批准/publish不重复事件；旧submit409。
- [ ] 隔离env运行review API测试并运行review e2e。
- [ ] 规则/AI/人工Review来源分开；权限与内容/manifest/政策版本复核；角色后台真实配置，不能以前端下拉模拟。批准与发布独立，withdraw保留历史。
- [ ] 查development_item.stage只有发布路径变化，越权和重复提交测试通过后提交。

## T12 SAP证据网关与技术适用性

**Files:** Create `apps/api/src/fs-workspace/evidence/sap-gateway.mjs`、`evidence/assessment.mjs`、`tests/fs-workspace/worker/sap-evidence.test.mjs`；按需要小范围扩展technical/sap-mcp.mjs，不改SAP写能力。

**Interfaces:** `verifySapClaim(scope,request,{budget,signal}): ToolReceipt`；`assessVerification(scope,command): Verification`，复用effectiveConfig与connectMcp。

- [ ] 测试系统不匹配不换系统、403不盲重试、对象不可读不当不存在、分页不完整不通过、SU24不等于运行时授权、伪receipt/跨项目receipt拒绝。
- [ ] 使用fake只读工具返回做worker测试；真实联机测试单独标记，不默认查询生产。
- [ ] 元数据/签名/权限提案分别白名单adapter，回执由服务端生成；固定target binding、scope、complete、limits；技术assessments权限受控，缺原始证据不能直接supported→verified。
- [ ] 有目标测试系统时做最小只读真实取证；无系统时报告明确阻断，但离线安全用例必须完成。不得伪造联机成功。

## T13 主Agent阶段执行与真实模型适配

**Files:** Create `apps/api/src/models/{inference,capabilities}.mjs`、`apps/api/src/fs-workspace/agent/{executor,validate}.mjs`、`agent/prompts/`版本化A-H；Create `tests/fs-workspace/unit/llm-output.test.mjs`、`tests/fs-workspace/worker/agent.test.mjs`；Modify models/store.mjs按需扩展能力有效期检查。

**Interfaces:** `inferStructured({modelVersion,credentialRef,schema,input,signal}): ProviderResult`；`executeStage(stage,context,adapters): Proposal`；`validateCandidate(context,proposal): ValidationResult`。

- [ ] 测试拒绝/截断在JSON解析前、required/null约束、预算和429退避、结构修复不能补金额/证据、上下文注入不扩工具、模型切换固定契约、expired capability拒绝。
- [ ] node unit与worker测试先红后绿；读取官方API文档再写适配器，不直接把probeModel拷贝成生产推理。
- [ ] 复用resolveDefaultModel/加密credential和HTTPS保护；新增结构化能力探测，不只text。实施A主提示+阶段配置，模型输出候选送五级校验，不暴露领域状态写接口。
- [ ] 在经批准模型配置上运行合成非敏感集成请求，记录真实返回；若密钥/能力缺失标待配置，不以模拟完成假称联调通过；通过后提交。

## T14 Word/PDF导出与内容一致性

**Files:** Create `apps/api/src/fs-workspace/export/{routes,html,docx,pdf}.mjs`、前端`review/ExportDialog.vue`、`tests/fs-workspace/worker/export.test.mjs`、fixtures长表/中文字体文档；扩展部署字体与渲染浏览器配置。

**Interfaces:** `renderHtml(model,manifest): string`；`renderDocx(model,manifest): Buffer`；`renderPdf(model,manifest): Buffer`；`createExport(scope,command): Export`。

- [ ] 测试固定版本而非latest、未批准水印、长表跨页、中文字体、附件失效、渲染失败不发布blob、重复manifest复用、下载权限撤销。
- [ ] 隔离env运行export worker测试；实际生成可打开docx/pdf而非扩展名伪装。
- [ ] 三适配器共享RenderModel；禁止导出服务加载任意外网URL；输出文件hash/content manifest匹配后原子ready。
- [ ] 逐页渲染检查截断和缺字，提取文本/表格核对；记录截图与错误，修复后提交。

## T15 端到端、性能基线与交接

**Files:** Create `tests/fs-workspace/e2e/end-to-end.spec.ts`、`tests/fs-workspace/fixtures/{clearing,report,interface}.json`、`docs/fs-workspace-operations.md`；更新本实施计划检查状态、README/启动文档，保存测试证据到artifacts/fs-workspace/（不把敏感业务数据入库）。

**Interfaces:** 只消费已实现API和UI，不通过直写数据库伪造业务成功；测试夹具建库和身份初始化可独立受控。

- [ ] 覆盖acceptance.md A01—A40；至少三条完整路径：清账讨论稿阻断、报表真实发布/导出、接口多轮变更/恢复。金标与模型自评分开。
- [ ] 执行`npm run test:fs`（使用隔离env配置的脚本）、e2e、`npm run typecheck`、`npm run build`；现有回归在同隔离数据库配置下运行。格式检查只格式化本任务文件，避免全仓格式化覆盖用户工作。
- [ ] 断进程/丢响应/权限撤销/并发故障演练；记录失败率与耗时，预算初值不是SLA。梳理部署scanner/OCR/字体/model/SAP前置条件、配置示例和备份恢复操作。
- [ ] 全部硬门禁通过才标开发完成；未有真实SAP/模型环境则明确列出哪些集成未验证，不能把整项目写成已上线。交付最终文件清单、目录解释、验证命令结果、已知风险与启动方式。

## 计划审查与状态记录要求

每项完成更新checkbox，并记录`任务ID → 代码文件 → 测试命令 → 实际结果 → 对应验收ID`。中途遇到API或目录冲突，先更新契约/工程设计与受影响任务，不让文档和代码分叉。技术常规选择由执行AI处理；只有改变产品范围、授权边界、数据迁移风险或真实上线行为时才需要用户决定。

2026-10-03 最新实施检查点：T01基础完成并修正生成类型缺陷；T02—T14已有不同程度的真实实现，但未满足完整任务完成条件，不勾选整项。已落地人工编辑/候选接受/历史版本、附件隔离与解析任务、租约与恢复/SSE、早期评审与发布拒绝门禁、结构化模型适配和能力探测、真实Word/PDF导出。前端已连接编辑、实时任务、上传。T12的FS SAP闭环、T13阶段编排、正向完整审批发布及T15三条端到端主路径仍需完成。最新代码/命令/失败修复/结果见 [实施证据](../../../artifacts/fs-workspace/implementation-ledger.md)，启动和真实集成限制见 [运行记录](../../fs-workspace-operations.md)。设计检查不算产品完成。
