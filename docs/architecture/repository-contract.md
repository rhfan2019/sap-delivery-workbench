# 仓库目录与依赖契约

版本：1.4。日期：2026-10-12。适用范围：本仓库的源码、资源、测试、脚本、文档和部署配置。

1.4 变更：新增 audit 模块（平台审计与日志分析），承载后台“审计日志”页面的接口、助手运行评论和优化建议；助手运行数据仍归 abap-fsd-agent，audit 只通过 `abap-fsd-agent/public.mjs` 读取。优化建议由 Claude Code 按需分析后经维护脚本发布，平台不内置定时分析。见 3.2 节。

1.3 变更：依据 [FSD 设计助手方向决策](2026-10-11-fsd-assistant-direction-decision.md)，FSD 设计助手改为模型主导的智能体，在现有项目中完全重构，统一命名为 abap-fsd-agent，开发助手预留命名 abap-dev-agent。智能助手只保留一个版本：不设版本目录、版本化 API 路径或版本化表名。历史各代 FS/FSD 助手（design-assistant 的 LangGraph 链路、gem-fsd-v2、agent、旧 abap-fsd-agent 引擎即 agent-runtime、fs-workspace 功能规格工作区、开发助手后端、“FS助手测试”）及其 410 边界、契约、表与数据全部清除，不保留转发壳或停用边界；现行设计助手前端界面保留并迁入新 feature。此项为用户明确授权，替代 1.1、1.2 中关于 LangGraph 后端、`work/design/fsd/v1` 入口、agent-runtime 公开入口和“旧 unavailable 边界不变”的规定。新边界见 3.1 节；新增检查规则见第 9 节。

1.2 变更：design-assistant 可通过既有 agent-runtime/public.mjs 复用材料解析、模型文本流传输和只读历史投影；通过 item-workspace/public.mjs 获取工作稿基准及按原文档合同采用内容。不复用或恢复历史设计执行器。聊天轮次与用户可见流事件归 design-assistant，自有数据库迁移归 database/migrations，诊断事件不承载聊天正文。依赖方向及公开入口检查规则不变。

1.1 变更：授权新的 ABAP FSD LangGraph 后端归 design-assistant，旧 unavailable 边界不变；新入口为 work/design/fsd/v1。其运行资源归本模块，纯共享协议归 contracts/design-assistant。新增跨模块调用仅通过 item-workspace/public.mjs（工作区授权）、models/public.mjs（冻结模型配置及传输）、agent-runtime/public.mjs（材料解析）、sap/public.mjs（受控 SAP 连接）；依赖清单与架构检查同步登记，禁止 design-assistant 深层导入这些模块。

这是本项目选择并执行的工程约定，不宣称是所有 Web 应用的唯一标准。目标是让每个文件有唯一责任归属，让前后端、共享代码与工程工具之间的边界可检查。

## 1. 架构选择

采用 npm workspaces 管理的模块化单体：一个 Vue 浏览器应用、一个 Fastify 服务端应用，以及必要的共享契约包。保留 apps/web 和 apps/api 的通用命名，不增加微服务、框架或业务功能。

后端按业务模块组织；模块内部按需要设置 routes、service、repository 等文件，不为凑齐层次创建空目录。前端按业务 feature 组织；通用组件、页面路由和网络基础设施各自独立。

## 2. 顶层目录职责

| 目录               | 唯一职责                                                 | 禁止放入                                           |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------- |
| apps/web           | Vue 页面、交互、前端资源和构建配置                       | 数据库连接、服务端凭据、后端业务实现               |
| apps/api           | HTTP 服务、后台任务、业务模块及服务端配置                | Vue 组件、个人会话记录、临时验证产物               |
| packages/contracts | 多个消费者共享的数据结构、校验、协议和纯函数             | 数据库查询、权限决策、Agent 执行器、服务启动副作用 |
| database           | 已版本化迁移、显式初始化资料                             | 应用运行时连接配置、数据库备份和真实数据导出       |
| scripts            | 开发、构建、测试、数据库维护、导入等命令入口             | 被生产业务反向依赖的公共实现                       |
| tests              | 按测试层级分类的测试与固定样本                           | 产品运行必须读取的资源                             |
| infra              | Docker、Nginx、生产部署配置                              | 业务逻辑                                           |
| tools              | 有明确用途、说明和维护边界的独立工程工具                 | 产品运行时依赖、无入口的临时脚本                   |
| vendor             | 必需的第三方内置源码/分发包、许可与版本说明              | 自有业务代码                                       |
| docs               | 与代码版本对应的架构、规格、计划、运维与验收资料         | 产品运行时数据来源、个人助手记忆                   |
| .runtime           | 本机私有状态、附件、凭据、日志及隔离测试环境（忽略提交） | 应提交的业务源码                                   |

根目录只保留统一入口及工具要求的配置：README、AGENTS、package.json、单一锁文件、start.cmd、stop.cmd、compose.yaml、编辑器/格式/Git 配置及测试配置。不新增 frontend/backend、src、common 等与上述结构重叠的根目录。

## 3. 应用内部边界

```text
apps/
  web/
    src/
      features/<business>/    # 业务页面、状态、API 适配与专属组件
      components/            # 真正跨业务复用的界面组件
      views/                 # 登录、首页等应用级页面
      router/                # 页面路由与导航守卫
      services/              # HTTP、会话等浏览器基础设施
      lib/                   # 无业务归属的前端纯工具
      assets/                # 样式、图片等前端资源
      types/                 # 仅前端使用的类型
  api/
    src/
      app.mjs                # 组装应用，不放业务实现
      server.mjs             # 生产 HTTP 入口
      platform/              # 认证、密码、数据库与生产配置
      modules/<business>/    # 业务模块与其自有运行资源
```

后端现有模块：admin（组织/用户/项目管理）、delivery（交付台账）、item-workspace（开发项工作区）、models（模型配置与调用）、sap（SAP 连接）、technical（技术验证）、abap-fsd-agent（FSD 设计助手，见 3.1）、audit（平台审计与日志分析，见 3.2）。开发助手实现时使用模块名 abap-dev-agent，在此之前不创建空目录。

fs-workspace 中的 FS 是 Functional Specification，不是文件系统。除 3.1 授权的设计助手重构外，URL、数据库表名和历史协议字段不因内部目录改名而改变。

### 3.1 智能助手边界（abap-fsd-agent / abap-dev-agent）

- **命名**：FSD 设计助手在后端模块、前端 feature、共享契约、提示词、API 路径和数据库表中统一使用 `abap-fsd-agent`（表名用 `abap_fsd_agent_` 前缀）；开发助手统一使用 `abap-dev-agent`。不再使用 design-assistant、fsd、fsd-agent、fs-workspace、agent-runtime 等同义名称。
- **职责**：abap-fsd-agent 是模型主导的 FSD 设计智能体，负责对话、FSD 文档及其版本、批注、模型调用编排、SAP 只读查询与文档校验。业务方法论与交付标准写在系统指令中，不写成固定流程节点或阶段状态机。
- **单一版本**：上述各处不得出现 `v1`、`v2` 等版本层级。API 入口为 `/api/projects/:projectId/development-items/:itemId/abap-fsd-agent`；开发助手预留 `/api/projects/:projectId/development-items/:itemId/abap-dev-agent`。系统指令归 `apps/api/src/modules/abap-fsd-agent/prompts/`。
- **历史清除**：以下资产全部删除，不保留 410、转发或兼容壳：design-assistant 模块（含 `unavailable.mjs`）；agent-runtime 模块（旧 abap-fsd-agent 引擎，含 `/api/admin/abap-fsd-agent` 与开发助手挂载）；fs-workspace 模块及其前端、契约；item-workspace 中的开发助手后端；“FS助手测试”菜单、页面与诊断页；`packages/contracts` 下 design-assistant、agent-runtime、fs-workspace 及空的旧 abap-fsd-agent 目录；上述各代迁移所建的表与数据（含 `fsd_checkpoint` 模式）；仅服务这些代码的测试、工具、脚本、npm 命令和部署配置。删除前按第 8 节检查引用。
- **保留的前端**：现行设计助手界面（开发项工作区设计阶段及其使用的对话、附件、决策卡片等组件）保留，迁入 `apps/web/src/features/abap-fsd-agent/` 后改接新 API；只删除仅服务“FS助手测试”和已删除后端的部分。
- **数据库**：已执行的迁移文件不改写、不删除；以新增迁移删除旧表并创建新表。旧表数据不备份（用户已明确放弃）。delivery 模块自有的 FS 台账表（`fs_draft`、`fs_version`）不属于助手，保留。
- **跨模块调用**：abap-fsd-agent 只通过 item-workspace、models、sap 的 `public.mjs` 调用其他模块，登记见 module-dependencies.json；不得深层导入。模型工具调用能力由 models 模块的公开接口提供。SAP 工具只向模型暴露预置的只读能力。
- **共享契约**：`packages/contracts/abap-fsd-agent` 只放前后端共同需要的纯协议（如对话事件、文档与批注结构）；不放执行器、提示词或模型调用。
- **日志分析**：智能助手日志分析基于新表重建，不读取已删除的表。

### 3.2 平台审计与日志分析（audit）

- **职责**：后台“审计日志”页面：助手运行日志（统计、筛选、单轮下钻）、操作审计（`app.audit_event`）、对助手运行的评论、优化建议的展示。仅企业管理员可用。
- **数据归属**：评论与优化建议表归 audit（`app.audit_` 前缀）。助手运行的轮次、消息、工具调用仍归 abap-fsd-agent，audit 只通过 `abap-fsd-agent/public.mjs` 读取，不直接查询其表。
- **优化建议**：由 Claude Code 在用户要求时，用 `scripts/maintenance/export-assistant-logs.mjs` 导出日志与评论、分析后，用 `scripts/maintenance/publish-proposal.mjs` 发布到页面。平台不调用模型生成建议，也不设定时任务。
- **跨模块调用**：audit → abap-fsd-agent（`public.mjs`）、audit → admin（管理员授权），登记见 module-dependencies.json。

认证和连接配置属于 platform；只供一个业务使用的提示词、模板和资源放该业务模块内。禁止为单一消费者新增 packages/agents。开发助手主提示词归 item-workspace/prompts。

同一模块允许相对路径。模块间只依赖明确的公开入口；本轮先消除应用/包/工具之间的越界，现有业务模块间调用在依赖清单中显式登记，不能借重命名声称业务解耦已经完成。新增跨业务深层导入须先调整公开接口与契约。

## 4. 依赖方向与包接口

允许：web → contracts；api → contracts；api/modules → api/platform；scripts → api 的工具用公开 exports / contracts；tests → 被测应用、契约和工具；独立 tools → contracts，以及 API 显式导出的离线诊断接口。后者只消费后端能力，后端不得反向依赖工具。

禁止：web → api、scripts、Node 专用 contracts 入口；api → web、scripts、tests、docs、tools；contracts → 应用或工程目录；产品代码 → 测试 fixture / 文档 / 本地输出。共享包不得循环依赖。

apps/api、apps/web、packages/contracts 各自声明直接依赖。根 package.json 仅维护编排与工程工具；根锁文件统一锁定版本。vendor/abap-adt 为第三方独立分发包，保留其上游锁文件。

跨 workspace 的源码 import 必须使用 @sap-delivery-workbench/contracts 或 @sap-delivery-workbench/api 的显式 exports，禁止 ../../../../packages 等物理深层导入。相对文件 URL 可以用于模块自有资源和受管理的数据路径；跨包读取 Schema 使用导出的资源子路径和 import.meta.resolve。

contracts 区分 Node 校验入口与浏览器可用的纯函数/类型入口。前端不得导入读取文件系统的 Node 校验模块。types.ts 是生成类型，不手工修改；Schema/registry 是生成来源。契约版本 v1 是数据兼容性版本，不等于旧设计引擎版本。

## 5. 测试归属

统一保留根 tests，避免同时出现应用 tests 与根 tests 两套归属：

- tests/unit/api：不需要真实数据库的后端行为。
- tests/unit/web：前端模型、组件、Vite 加载行为。
- tests/unit/contracts：数据契约校验与生成一致性。
- tests/unit/tooling：目录检查器、配置与工程工具行为。
- tests/integration/api：需要真实 PostgreSQL 的 API / worker 行为。
- tests/integration/database：迁移、权限和表结构。
- tests/e2e：浏览器访问完整应用；夹具放 tests/fixtures。

测试按实际依赖分类，不以原文件夹名称判断层级。测试发现必须递归；每个测试文件只能属于一个默认测试分组，禁止移动后不再运行。外部 SAP/模型真实调用和浏览器 E2E 使用显式命令，不在默认单元测试中产生付费调用。

集成测试必须使用隔离测试库，不回退到主 .env。迁移已有测试时保留业务断言，不通过删除断言或跳过测试获得通过。

## 6. 工程脚本与文档

scripts/dev：本地联合启动、受管进程控制；scripts/database：迁移、配置、初始化；scripts/testing：测试发现、隔离环境和测试服务；scripts/maintenance：显式数据导入；scripts/vendor：第三方准备；scripts/checks：架构验证。按现有需要创建，不创建空目录。

生产服务入口归 apps/api/src；需要独立后台进程时，入口同样放在 apps/api/src。scripts 可以编排应用，应用不能导入 scripts/lib。平台数据库/生产配置应由 api 的公开工具接口复用；只用于导入的解析工具留 maintenance。

docs/architecture 放唯一架构契约与审计；docs/specs 放版本化设计规格；docs/plans 放实施计划；docs/guides 放现行说明；docs/archive 放历史报告。文档按内容归类，不按生成它的 AI 工具名称归类。测试需要的 JSON/Schema 示例迁入 tests/fixtures，不能继续依赖 docs 的布局。

历史说明不改写成现行事实；在入口标记历史状态。当前 README 必须能指出真实运行入口、目录、命令和已停用能力。个人工具记忆不是产品资料，归本机忽略区。

## 7. 本机资料与迁移安全

新生成的验证证据统一写 .runtime/artifacts；临时下载写 .runtime/cache。历史 artifacts、outputs、runs、artifacts_to_be_deleted 先登记后归入 .runtime/archive，不能根据名字永久删除。

.runtime 不是可整目录清空的缓存：它还包含附件、初始凭据和进程状态。数据库卷、.env、已有附件路径默认保持。涉及存储路径变更必须单独迁移并验证数据完整性。

本次误删恢复来源固定为用户指定的 D:\Workspace\sap-delivery-workbench - 副本 (2)。仅恢复当前依赖的契约和开发提示词；保留来源/目标/哈希清单，不覆盖当前已存在文件，不恢复旧设计执行器或规则包。

## 8. 新增、修改和删除流程

1. 确定文件属于应用、共享契约、工具、测试、文档还是本机数据；再选择所属业务。
2. 检查相同职责是否已有位置；优先扩展已有模块，不复制第二套实现。
3. 变更跨包接口时同步更新 exports、消费者和契约测试。
4. 移动/删除前检查 import、动态加载、文件 URL、命令字符串、Docker COPY、测试发现和文档链接。
5. 在同一变更中完成消费者迁移，不保留旧路径转发壳、重复资源或临时 alias。
6. 如需新增顶层目录或改变依赖方向，先修改本契约及检查规则，再实施。

## 9. 可执行验收

npm run check:architecture 必须检查：受控根目录、workspace 清单、跨应用违规依赖、应用反向导入 scripts、contracts 反向依赖、跨包物理路径、缺失本地导入、前端 Node 校验入口，以及测试文件是否被发现。检查器自身必须有违规反例测试。

1.3 新增检查（与历史助手清除在同一变更中启用，因为清除完成前现有代码必然违反）：abap-fsd-agent 的后端模块、前端 feature、共享契约与提示词目录中不得出现版本目录段（`/v<数字>/`）；`apps`、`packages`、`scripts`、`tools`、`infra` 中不得出现已清除的模块目录（design-assistant、agent-runtime、fs-workspace、fs-assistant-test），现行源码不得引用历史助手标识（`fsd_v1_`、`/work/design/fsd`、`gem-fsd-v2`、`work/design/agent`、`/api/admin/abap-fsd-agent`、`DESIGN_ASSISTANT_REMOVED`、`fsd_checkpoint`），已执行的历史迁移文件除外。前端可用契约清单随契约导出同步更新。

重构完成条件：架构检查通过；生成契约一致；类型检查与生产构建通过；单元与隔离集成测试通过；start.cmd 启动后 /home 与 /api/health 可访问；停用设计接口保持 410；Docker 构建路径与 npm workspace 一致；迁移清单可追溯。受外部条件影响未验证的项目必须明确标记，不得宣称已验证。

契约变更必须更新版本、原因和检查器。AGENTS.md 要求后续所有目录/依赖变更先读本文件。自动检查与代码评审共同执行本契约；文档本身不等于已经具备自动约束。
