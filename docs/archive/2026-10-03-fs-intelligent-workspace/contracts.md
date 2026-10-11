# JSON 契约与校验规则

这些文件是设计交付的可执行契约样例，不是已经接入平台的接口实现。规范采用 JSON Schema Draft 2020-12；文件中根 $defs 自包含，所有 $ref 都能离线解析。生成脚本只是便于维护本设计包，完整 JSON 文件已随包提供，读取者无需运行生成器。

## 契约清单与权责

| 层 | 完整Schema | 合法样例 | 非法样例 |
|---|---|---|---|
| LLM | [RequirementAnalysis](../../../tests/fixtures/fs-workspace/specification/schemas/RequirementAnalysis.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/RequirementAnalysis.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/RequirementAnalysis.invalid.json) |
| LLM | [Clarification](../../../tests/fixtures/fs-workspace/specification/schemas/Clarification.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/Clarification.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/Clarification.invalid.json) |
| 领域 | [FsDocument](../../../tests/fixtures/fs-workspace/specification/schemas/FsDocument.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/FsDocument.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/FsDocument.invalid.json) |
| LLM | [ChangeSet](../../../tests/fixtures/fs-workspace/specification/schemas/ChangeSet.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/ChangeSet.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/ChangeSet.invalid.json) |
| LLM | [ReviewResult](../../../tests/fixtures/fs-workspace/specification/schemas/ReviewResult.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/ReviewResult.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/ReviewResult.invalid.json) |
| 事件 | [RunEvent](../../../tests/fixtures/fs-workspace/specification/schemas/RunEvent.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/RunEvent.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/RunEvent.invalid.json) |
| LLM | [FsProposal](../../../tests/fixtures/fs-workspace/specification/schemas/FsProposal.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/FsProposal.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/FsProposal.invalid.json) |
| LLM | [VerificationProposal](../../../tests/fixtures/fs-workspace/specification/schemas/VerificationProposal.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/VerificationProposal.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/VerificationProposal.invalid.json) |
| LLM | [OrchestratorPlan](../../../tests/fixtures/fs-workspace/specification/schemas/OrchestratorPlan.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/OrchestratorPlan.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/OrchestratorPlan.invalid.json) |
| 领域 | [RequirementRecord](../../../tests/fixtures/fs-workspace/specification/schemas/RequirementRecord.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/RequirementRecord.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/RequirementRecord.invalid.json) |
| 领域 | [DecisionRecord](../../../tests/fixtures/fs-workspace/specification/schemas/DecisionRecord.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/DecisionRecord.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/DecisionRecord.invalid.json) |
| 领域 | [EvidenceRecord](../../../tests/fixtures/fs-workspace/specification/schemas/EvidenceRecord.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/EvidenceRecord.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/EvidenceRecord.invalid.json) |
| 领域 | [ApprovalRecord](../../../tests/fixtures/fs-workspace/specification/schemas/ApprovalRecord.schema.json) | [valid](../../../tests/fixtures/fs-workspace/specification/examples/ApprovalRecord.valid.json) | [invalid](../../../tests/fixtures/fs-workspace/specification/examples/ApprovalRecord.invalid.json) |

每个schema_version固定1.0.0，Context包括workspace/session/run/document/base_document_version/context_snapshot/template/version。模型必须回显服务端注入值，服务端逐一比对；回显ID不是授权。服务器领域对象是输出/存储契约，不作为模型可写的输入DTO。

FsDocument承载版本化文档AST、测试和依赖manifest，需求/规则/决策正文在独立记录保存，避免复制后漂移。RequirementRecord.kind区分requirement与rule，content使用Proposal结构保存文本与来源；复杂业务细节放关联文档块与测试，后续可按profile演进更强类型规则表达。本文不以一个markdown字符串存储整个FS。

Proposal.classification中的source_fact是“来源陈述事实”，不代表系统验证；Issue.status也只是模型提议，服务端只有核实resolution_ref后才能把持久Issue改为resolved。ChangeSet中的decision操作仅改候选内容，不能创建确认或审批；改动已确认对象触发失效。

EvidenceRecord的collected_at、tool_receipt_id、access_scope_id、content_hash，以及FsDocument的version_number、lifecycle、verifications、created_by等均由服务端填充和派生。ApprovalRecord只能由授权审批端点创建。无法通过Schema的readOnly关键字替代字段白名单；只读字段根本不进入模型可写Schema。

## 通用类型含义

- Context固定一次运行所见版本；base_document_version=null仅用于无文档初次分析，不能解释为绕过并发控制。
- Link至少包含真实evidence_id、来源locator、被支持的具体conclusion。locator可为消息字符区间、PDF页/块、表格单元格、图片bbox或工具JSON Pointer；服务端核实在来源范围内。
- Target包含system_id、client、release。未选系统可以在候选请求使用unknown占位，但正式验证禁止；候选名字null表示尚未确定，不能据此调用通配查询。
- Verification分离status与applicability，verified须有合法证据、checked_at、有效系统和supported适用性（或按照明确验证类型仅确认的scope）；其status只说明scope所描述结论，不证明scope之外内容。not_applicable必须有理由与授权审阅。
- Confirmation固定subject ID/revision/hash、actor/time；模型Schema不包含该对象。更新主体必须检验确认是否仍有效。
- Section稳定ID与模板slot分开，改标题不改ID；Block支持paragraph/table/callout。table必须有列，所有row.cells长度等于columns长度；paragraph/callout要求text，columns/rows为空，由领域校验器实现。
- Test有明确前置条件、步骤、预期和需求/规则/章节引用，不能用标题列表代替验收。
- ChangeSet.Operation使用受限实体类型和类型化value联合；不是任意JSON Patch。模型不能指定tenant、actor、approval、head或原始SQL路径。
- RunEvent.sequence是同一Run内单调递增服务端序号；event_id全局唯一，事件发生时间由服务端生成。progress可为null，未测量时不伪造百分比。事件payload仅传授权后的结果引用，不塞完整敏感材料。

## 服务端补充契约

下列辅助对象属于持久工作流协议；此处完整列出必须字段，实施时从同一契约源生成DTO，不能让模型构造这些权威对象。

| 对象 | 必需字段与约束 |
|---|---|
| UploadReceipt | attachment_id、workspace_id、client_upload_id、blob_version、sha256、media_type、size_bytes、scan_state、created_at；服务端生成，拒绝未放行文件进入解析 |
| ParseResult | id、attachment_id/revision、parser_version、state(complete/partial/failed)、regions[{id,locator,text,confidence,table_shape}]、unread_regions、warnings、created_at；原文件不可变 |
| ContextSnapshot | id、project_policy_version、target_binding、template/schema/prompt/ruleset/model_config版本、document_head、entity_manifest[{id,revision,hash}]、evidence_manifest、retrieval_scope、input_message_ids、token_budget、omitted_regions、created_at |
| RunCheckpoint | id、run_id、node_id、attempt、input_hash、output_refs、idempotency_receipts、fencing_token、cancel_epoch、config_versions、last_event_sequence、created_at |
| AcceptChange（v1.1 HTTP） | base_document_version、accepted_group_ids；workspace/change_set由路径定位，Idempotency-Key与If-Match在header；不再接收旧表中的workspace_id、expected_head_revision、accepted_atomic_group_ids |
| Confirm（v1.1 HTTP） | subject_id、subject_revision、subject_hash、context_snapshot_id、choice_id、decision_text；expected_workspace_revision由If-Match表达，身份从认证解析 |
| ExportManifest | id、document_version_id、content_hash、template_version、renderer_version、font_pack_version、format、render_model_hash、evidence_manifest_hash、watermark_policy、created_by、created_at |

这些表是辅助接口规范，六个要求的主Schema及额外七个Schema已提供完整机器可解析定义。上线前必须将辅助对象也实现为代码生成的严格DTO，不把表格当作运行时校验器。

### 2026-10-03 实施同步

运行时单一来源为 `packages/contracts/fs-workspace/` 的 JSON Schema；生成类型为该目录 `generated/types.ts`，通过 `npm run generate:fs` 生成、`npm run check:fs-contracts` 检查。设计包 Schema 为同步镜像，由 `tests/unit/contracts/fs-workspace/contract-sync.test.mjs` 核对，运行时不读取 docs。

已补充 UploadReceipt、RunCheckpoint、ExportManifest 的严格 Schema、合成合法/非法示例和 OpenAPI 引用。角色列表新增 FsProjectRoleAssignment.revision，供角色写命令的 expected_revision 使用。multipart 文件流仍须经过 T06 的流式边界，JSON Schema 校验不能代替扫描、文件大小与 magic 检查。L3 通过不代表 L4 引用或 L5 门禁通过。

## 五级校验与错误处理

| 级别 | 输入与检查 | 错误示例 | 处理 |
|---|---|---|---|
| L1传输 | HTTP/SDK完成、refusal、incomplete、请求ID、内容类型 | 429、截断、安全拒绝 | 按运行策略处理，不进入业务JSON解析 |
| L2解析 | UTF-8、单JSON对象、禁止重复key、NaN/Infinity、长度深度限制 | 同一字段出现两次 | 完整响应可尝试一次安全修复 |
| L3Schema | 必需项、类型、枚举、额外字段、$ref解析 | FsProposal多出lifecycle=approved | 拒绝候选并记录JSON Pointer |
| L4引用与权限 | 全部ID、版本、ACL、locator、工具回执、临时ID映射 | 伪ev999，真实但其他项目ev1 | 不允许结构修复绕过，回取授权上下文 |
| L5语义与交付 | 模板槽、表格形状、依赖、币种守恒、确认/验证、审批与并发 | 已确认容差改动但测试未更新 | 讨论稿缺口或阻断；不能发布 |

L5与事务提交时的版本检查不可只在模型返回时执行，否则检查后到提交间存在竞争。所有校验结果带候选hash、规则集版本、时间和执行者类型。发现“暂未检查”不能转换为pass。

## 非法与有害样例

所有*.invalid.json添加unexpected_authority="approved"，预期L3 additionalProperties失败。validate_contracts.py另测试以下具体场景：缺required、根数组、错误枚举、在FsProposal注入lifecycle、在VerificationProposal注入status、在Clarification注入审批主体。语法层采用截断JSON和重复键样例。

有些输入Schema应当通过，但业务必须拒绝，不能为展示安全性而谎称Schema能发现它们：

| 修改合法样例的方法 | Schema结果 | 预期领域结果 |
|---|---|---|
| 将evidence_id改为ev-does-not-exist | 通过 | L4 REF_NOT_FOUND |
| 引用真实但另一项目的证据ID | 通过 | L4 ACCESS_DENIED，不泄露证据名称 |
| Context.base_document_version改为旧版 | 通过 | 提交时409 VERSION_CONFLICT |
| ChangeSet target_id=rule-1但value.id=rule-2 | 通过 | L5 TARGET_VALUE_MISMATCH |
| remove仍带非null value | 通过 | L5 INVALID_OPERATION_VALUE |
| FsDocument.lifecycle=approved却approval_refs=[] | 通过 | L5 APPROVAL_REQUIRED；且模型根本不能写此DTO |
| 相同引用ID但conclusion说了来源未包含的结论 | 通过 | L5 EVIDENCE_UNSUPPORTED，经证据审查识别 |
| 表格有2列、某行3格 | 通过 | L5 TABLE_SHAPE_MISMATCH |
| USD与CNY直接相加 | 可通过 | L5 CURRENCY_BOUNDARY，需要领域规则/样本测试 |

## OpenAI Structured Outputs适配

2026-10-03访问官方文档核实：根必须object，不能根anyOf；每个对象需additionalProperties:false，所有properties均列入required；语义可选项采用null联合且仍required。当前文档允许嵌套anyOf和$defs/$ref，但每个分支须符合支持子集。当前公布上限为总计5000个对象属性、嵌套10层、属性名/定义名/枚举/const字符串总长120000字符、总枚举值1000；单一枚举超过250个字符串值时有15000字符限制。这些是服务文档限制，不是本产品设计目标。

当前文档不支持allOf/not/dependentRequired/dependentSchemas/if/then/else，微调模型还有限制。通用JSON Schema的可用关键词不等于模型端可用关键词。本包*.openai.json仅提供七种LLM候选契约，移除元schema/id并把const转成单值enum，保留required/null/additionalProperties规则。不把领域FsDocument或RunEvent拿去作为模型写输出。

调用时使用所选API对应的strict结构化输出配置；适配器仍先检查拒绝、incomplete和传输错误。没有进行真实模型API联调，因此本地验证通过只能证明Schema与样例一致，不证明某账户/模型实际接受全部Schema。发布模型配置前运行最小请求与复杂fixture的集成测试，失败不得降级成未经校验的markdown。

## 运行校验

需要Python和jsonschema包；推荐独立临时环境，不修改产品依赖。

```text
python validate_contracts.py
```

本次执行使用临时目录中的jsonschema，运行结果记录见validation-report.json。脚本测试契约与样例、供应商结构约束、明显权威字段注入和示例领域拒绝规则；它是设计包的可执行规格，不是平台已有安全实现的证明。完整业务验收仍按acceptance.md在未来实现中执行。

## 状态、操作与ID语义补充

同一Run的queued/running/waiting_user/waiting_evidence可接收取消；queued与waiting可直接提交取消栅栏转cancelled，running先cancel_requested。failed/completed/cancelled不再执行取消写，返回已有终态。resume创建新的attempt与租约但保持可查询的原Run历史；输入或配置变更时必须新Run。

事件与状态由服务端映射：run.queued→queued，run.started/progress通常→running，run.waiting→waiting_user或waiting_evidence，run.failed→failed，run.cancelled→cancelled，run.completed→completed。artifact.proposed可以在running或waiting_user发出，不能推断已保存；baseline.published必须有真实发布收据和权限投影。Schema不使用供应商不兼容的if/then强行表达这些关系，由事件生产器和领域校验器强制。

每个原子操作组可包含新增Issue和VerificationRequest。accept后服务端先为所有tmp: ID分配正式ID，再在同一事务重写所有引用；未定义临时引用、重复定义、跨ChangeSet临时引用均拒绝。对象被引用的永久ID和revision由ContextSnapshot manifest解析；值类型与entity_type不一致、target_id与value.id不一致、remove仍被未删除对象引用都必须拒绝。

所有样例使用合成ID与fixture-hash，仅为Schema形状演示；没有把它们当作真实工具证据、签名或可发布清账FS。生产hash采用标准规范化编码后的SHA-256；采用哪个规范化算法须固定版本，禁止不同客户端各算一种。并发版本不得只依赖内容hash（两个版本可能内容相同），同时检查不可变version ID与head revision。
