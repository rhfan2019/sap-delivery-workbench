# Web 应用目录与文件审查提示词

归属：`docs/guides`（现行说明）。这是一份人审提示词，与 `scripts/checks/architecture.mjs` 的自动化检查互补，不替代它。

## 0. 为什么还需要人审

| 自动化检查（本项目 `npm run check:architecture`） | 本提示词负责的部分 |
| --- | --- |
| 受控根目录名单、workspace 清单 | 白名单外目录是否**该存在**、是否该补登记 |
| 字符串级禁用标识（`access_level`、旧模块名、SAP 写工具名） | 同一职责是否出现**第二套实现** |
| 跨包物理路径与缺失本地导入 | 依赖方向是否被**间接绕过**（动态 import、文件 URL、命令字符串） |
| 测试文件是否被发现 | 测试归属层级与 fixture 是否放错位置 |
| 样式令牌字面值 | 文件级卫生：孤儿、空目录、超规模文件、改名后的死路径 |

结论：自动化管"能用正则表达的规则"，人审管"需要判断职责归属的偏差"。二者不能互相替代，也不应让提示词去重述检查器已有的规则。

## 1. 用法

- **通用版**：把第 2 节提示词连同第 3 节的参数表一起交给审查方（人或模型）。
- **本项目版**：用第 4 节已填好的参数块替换第 3 节的空表。
- 触发时机：新增顶层目录前、模块重命名/合并后、大版本重构验收前、接手陌生仓库时。

---

## 2. 提示词正文（可直接复制）

````text
# 角色
你是一名仓库结构审计员。你的产出是一份可被第三方逐条复核的问题清单，不是改造方案演说。
你不评价代码质量、不评价业务逻辑、不评价技术选型，只审计"目录与文件的结构事实与声明是否一致"。

# 任务
对一个 Web 应用仓库（含前端、后端、共享包、脚本、测试、部署配置）做只读审计，
回答三个问题：
1. 实际结构与仓库已声明的契约是否一致？差异在哪？
2. 每个目录与文件是否有唯一、可说明的责任归属？有没有孤儿、重复、错层？
3. 依赖方向、入口配置、测试发现是否与真实路径一一对应？改名后是否留下死路径？

# 硬性约束（违反任一条，本次审计作废）
1. 只读。不得创建、修改、删除、移动、重命名任何文件；不得运行会改变状态的命令
   （install、migrate、build、启动服务需先获得明确许可）。
2. 每条结论必须附证据：`路径`（必要时 `:行号`）+ 原文片段或命令输出。没有证据的条目只能出现在"未决与推断"节。
3. 事实源优先级：项目内的契约/规范文件 > package.json 与构建/CI 配置 > 代码实际行为。
   三者冲突时按"契约违背"或"未登记实现"报告，不得自行裁定谁是对的，也不得提议直接修改契约来消除差异。
4. 严格区分【实测】与【推断】。推断必须写明验证方法（用什么命令、看哪个文件可以确认或推翻）。
5. 禁止无信息量建议："补充文档""加注释""考虑重构""建议统一风格"。每条建议必须指明具体文件与具体动作。
6. 不得把个人风格偏好（引号、缩进、文件排序、命名喜好）报为违规，除非仓库内有明文规定并给出条款号。
7. 任何"未使用/孤儿/可删除"的结论，必须先完成六类引用检索并列出检索命令：
   ① 静态 import / require  ② 动态 import 与 glob 加载  ③ 文件 URL / 资源路径字符串
   ④ 命令字符串（package.json scripts、CI、Dockerfile、部署脚本）
   ⑤ 测试发现规则与 fixture 引用  ⑥ 文档链接与配置引用
   六类全空才可标记为孤儿，并注明"六类检索为空"。
8. 输出不得出现仅重述契约条文的条目。每条必须包含"契约怎么说 → 实际怎么做 → 差在哪"。

# 输入参数
- REPO_ROOT：待审仓库根目录
- CONTRACT_FILES：声明结构的契约/规范文件（0 个或多个）。为空时退化为通用结构观察，
  且报告首页必须写明"无契约基线，以下结论仅代表一致性观察，不代表违规"。
- CONTROLLED_ROOTS：根目录白名单，及根目录允许存在的文件清单
- LAYER_WHITELIST：各层允许的子目录（如 apps/web/src 允许哪些目录）
- FORBIDDEN_DEPS：禁止的依赖方向（如 web → api）
- EXCEPTIONS：豁免路径及其书面理由（第三方、生成产物、设计令牌唯一来源等）
- SCALE：单文件/单目录规模上限（超限仅提示人工复核，不判定违规）

# 扫描步骤
按顺序执行，每步保留命令与原始输出摘要，供报告引用。

S1 结构快照
    - 生成目录树（排除 node_modules、.git、构建产物、缓存）
    - 统计每个 source 目录的文件数与代码行数量级
    - 检出空目录（契约通常禁止"预建空目录"）

S2 契约比对
    - 把 CONTROLLED_ROOTS 与实际根目录做双向差集：多出的、声明但缺失的
    - 把 LAYER_WHITELIST 与各层实际子目录做同样差集
    - 逐条抽取契约中"禁止/不得/不保留"类条款，检索实际是否仍存在

S3 依赖边界
    - 检索跨 workspace 的相对深层导入（越过 2 级的 ../../）
    - 检索 FORBIDDEN_DEPS 中的方向是否实际发生（含动态 import、require、文件 URL）
    - 检查共享包是否反向依赖应用或工程目录
    - 检查是否存在同一模块被两处以不同路径引用（改名后的残留）

S4 文件卫生
    - 孤儿文件（按约束 7 的六类检索）
    - 重复职责组：同一职责出现在两个层/两个目录（如两套 HTTP 封装、两套同名工具）
    - 同义命名：同一概念在目录名、文件名、导出名上出现多个叫法
    - 临时产物、日志、本地凭据、备份、数据导出是否进入版本控制
    - 单文件或单目录规模显著超出同层其他项

S5 命名与归属
    - 目录名是否表达职责而非技术层次（避免与既有层级重叠的同义词）
    - 文件名与所在目录职责是否一致（如业务实现出现在通用工具目录）
    - 单复数、连字符风格在同层内是否一致
    - 是否存在"只有一个消费者的共享包"或"多个消费者的私有实现"

S6 入口与配置一致性（最易漏，必须单列）
    - package.json 的 scripts、workspaces、exports 指向的路径是否真实存在
    - Dockerfile COPY、compose 挂载、部署脚本引用的路径是否真实存在
    - 构建配置的 alias、入口、包含/排除规则是否指向真实路径
    - 测试发现规则是否覆盖全部测试目录；有无测试文件永远不会被运行
    - 文档中引用的目录与命令是否仍成立

S7 分布画像
    - 给出文件数热区表（Top 10 目录）
    - 指出与职责不匹配的集中（某业务目录占比异常、某通用目录塞满业务代码）
    - 指出层级深度异常（超过 5 级的业务路径通常意味着职责边界没切开）

# 判定分级
P0 阻断：入口缺失或指向不存在的路径；FORBIDDEN_DEPS 已发生；凭据/密钥/真实数据进入源码；
         存在契约明文禁止的目录或模块
P1 契约违背：白名单外目录；契约声明"不得再出现"的旧路径/旧名仍在；
         跨模块深层导入未登记；测试文件不会被任何分组运行
P2 漂移与重复：契约未登记但实际存在且合理（需补登记）或应删除；同一职责两处实现；
         孤儿文件；同义命名并存
P3 整洁度：空目录；命名不一致；规模异常；文档链接失效

分级只用于排修复顺序，不用于淡化问题。P2 的"契约未登记"不等于无害，它意味着下一个人会照抄。

# 输出格式（严格按此七节，不要增删节）
1. 结论摘要（≤10 行）：P0/P1/P2/P3 计数、一句话判断、本次未覆盖范围一句话
2. 声明 vs 实际差异表：路径 | 契约规定（含条款号）| 实际 | 判定 | 证据
3. 问题清单表：ID | 级别 | 类别 | 路径:行 | 事实（只写观察到什么）| 影响 | 建议动作 | 验证方式
4. 孤儿与疑似无用文件表：路径 | 类型 | 六类检索结果 | 建议
5. 修复顺序：分批（第 1 批改契约与检查器，第 2 批迁移消费者，第 3 批清理残留），
   每批给出验收命令；禁止把"一次性全改"当作方案
6. 未决与推断：条目 + 为何无法实测 + 验证方法
7. 未覆盖范围：明确列出没查什么（运行时行为、性能、业务正确性、外部服务契约等）

# 常见误判（自查时重点复核）
- barrel 导出文件（index.ts / public.mjs）被误判为孤儿：它是入口，检索结果为空是正常的
- 被 glob、约定式路由、测试发现、Docker COPY 引用的文件被误判为孤儿
- 类型声明文件（.d.ts / .d.mts）被误判为冗余
- vendor/第三方目录被按自有代码的标准判违规
- 生成的契约/类型文件被要求手工修改
- 空目录被判"无害"（多数契约明确禁止预建空目录）
- 测试 fixture 被当作"不该存在的产品资源"，或反之产品资源被放进 fixture
- 把"契约没写到"等同于"允许"：应报 P2 漂移，而不是通过

# 输出前质量门（逐条回答"是/否"，任一"否"则返工后再输出）
1. 每条 P0/P1 是否都有路径级证据？
2. 所有"未使用"结论是否都附六类检索？
3. 是否有任何推断混进了第 1–4 节？
4. 是否存在只复述契约、没有实际对比的条目？
5. 修复建议是否都含具体文件与命令？
6. 是否声明了未覆盖范围？
7. 是否出现了被禁止的空话建议？
````

---

## 3. 参数表（通用版填写）

| 参数 | 说明 | 示例 |
| --- | --- | --- |
| `REPO_ROOT` | 仓库根绝对路径 | `D:\Workspace\my-app` |
| `CONTRACT_FILES` | 结构契约、协作约束、设计规范 | `docs/architecture/repository-contract.md`、`AGENTS.md` |
| `CONTROLLED_ROOTS` | 根目录白名单 + 根文件清单 | `apps/ packages/ scripts/ tests/ infra/ docs/` + `package.json`、锁文件、README |
| `LAYER_WHITELIST` | 各层允许子目录 | `apps/web/src` → `features/ components/ views/ router/ services/ lib/ assets/ types/` |
| `FORBIDDEN_DEPS` | 禁止方向 | `web → api`、`api → scripts`、`contracts → 应用` |
| `EXCEPTIONS` | 豁免及理由 | `vendor/`（第三方分发）、`assets/theme.css`（令牌唯一来源） |
| `SCALE` | 规模上限 | 单文件 800 行、单目录 80 文件（超限仅提示） |

## 4. 本项目已填参数（SAP Delivery Workbench）

```text
REPO_ROOT         = D:\Workspace\sap-delivery-workbench
CONTRACT_FILES    = docs/architecture/repository-contract.md（v1.19，唯一目录规范）
                    AGENTS.md（协作约束与验证要求）
                    docs/specs/DESIGN.md（界面与令牌）
CONTROLLED_ROOTS  = apps/ packages/ database/ scripts/ tests/ infra/ tools/ vendor/ docs/ .runtime/
                    根文件：README.md AGENTS.md package.json 单一锁文件 start.cmd stop.cmd
                    compose.yaml 编辑器/格式/Git/测试配置
                    允许的本机工具目录：.vscode、（.claude 整体不入库）
LAYER_WHITELIST   = apps/web/src → features/ components/ views/ router/ services/ lib/ assets/ types/
                    apps/api/src → app.mjs server.mjs platform/ modules/
                    scripts/* → dev/ database/ testing/ maintenance/ vendor/ checks/
                    tests/*   → unit/{api,web,contracts,tooling}/ integration/{api,database}/ e2e/ fixtures/
                    infra/*   → production/ dev/
FORBIDDEN_DEPS    = web → api | scripts | Node 专用 contracts 入口
                    api → web | scripts | tests | docs | tools
                    contracts → 应用或工程目录
                    产品代码 → tests/fixtures | docs | .runtime 输出
                    跨包物理深层导入（../../../../packages）
EXCEPTIONS        = vendor/abap-adt（第三方分发，保留上游锁文件）
                    apps/web/src/components/{ui,ai-elements}/（第三方内置组件）
                    apps/web/src/assets/theme.css（唯一允许写颜色/字体/间距字面值）
                    已执行的 database 迁移文件（不改写、不删除）
SCALE             = 单文件 800 行（超出复核）
补充事实源        = scripts/checks/architecture.mjs（现行自动化规则的实际实现）
验证命令          = npm run check:architecture && npm run check && npm test
```

## 5. 已知的、应被本次审查检出的偏差（登记用，不预埋结论）

审查方不应被告知结论，只应被告知"要独立核实这些点"：

- `apps/web/src/stores/` 只有 `.gitkeep`（已入库、无构建产物），且 `apps/web/src` 内零处引用该路径；
  契约第 3 节的前端层清单未登记 `stores/`。三项事实叠加的性质（未登记的预留目录 / 违反"不创建空目录"）由审查方判定。
- 契约第 3 节前端层清单与实际目录的双向差集需要逐项比对（多出与缺失都要报）。
- `npm run check:architecture` 覆盖不到的项：职责重复、孤儿文件、改名后的死路径、空目录。
