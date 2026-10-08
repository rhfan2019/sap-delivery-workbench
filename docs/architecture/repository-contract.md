# 仓库目录与依赖契约

版本：1.0。日期：2026-10-08。适用范围：本仓库的源码、资源、测试、脚本、文档和部署配置。

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
      worker.mjs             # 独立后台任务入口
      platform/              # 认证、密码、数据库与生产配置
      modules/<business>/    # 业务模块与其自有运行资源
```

后端现有模块：admin（组织/用户/项目管理）、delivery（交付台账）、item-workspace（开发项工作区）、fs-workspace（功能规格工作区）、agent-runtime（开发助手和历史读取共享运行支持）、models（模型配置与调用）、sap（SAP 连接）、technical（技术验证）、design-assistant（已停用接口边界）。

fs-workspace 中的 FS 是 Functional Specification，不是文件系统。agent-runtime 不代表重新启用旧设计助手。URL、数据库表名和历史协议字段不因内部目录改名而改变。

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

scripts/dev：本地联合启动、受管进程控制；scripts/database：迁移、配置、初始化；scripts/contracts：类型生成；scripts/testing：测试发现、隔离环境和测试服务；scripts/maintenance：显式数据导入；scripts/vendor：第三方准备；scripts/checks：架构验证。按现有需要创建，不创建空目录。

生产服务/worker 入口归 apps/api/src。scripts 可以编排应用，应用不能导入 scripts/lib。平台数据库/生产配置应由 api 的公开工具接口复用；只用于导入的解析工具留 maintenance。

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

重构完成条件：架构检查通过；生成契约一致；类型检查与生产构建通过；单元与隔离集成测试通过；start.cmd 启动后 /home 与 /api/health 可访问；停用设计接口保持 410；Docker 构建路径与 npm workspace 一致；迁移清单可追溯。受外部条件影响未验证的项目必须明确标记，不得宣称已验证。

契约变更必须更新版本、原因和检查器。AGENTS.md 要求后续所有目录/依赖变更先读本文件。自动检查与代码评审共同执行本契约；文档本身不等于已经具备自动约束。
