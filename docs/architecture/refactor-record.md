# 2026-10-08 目录审计与重构记录

> 状态：历史记录（2026-10-08）。文中的 410 边界已按[目录与依赖契约](repository-contract.md) 1.3 与 3.1 清除；现行目录规则以契约为准。

## 初始事实

审计基线提交：1306091。Git 跟踪文件计数：web 391、api 114、packages 1（仅 .gitkeep）、database 23、scripts 26、tests 106、docs 177、infra 8、tools 20、vendor 81。

- API app.mjs 反向导入 scripts/lib/database.mjs。
- 仅 apps/web 注册为 workspace；API 与契约没有自己的依赖清单与公开 exports。
- apps/api/src、apps/web/src 大量跨层相对引用 packages/contracts。
- packages/contracts 中三个仍有消费者的契约目录缺失，startup-import 测试报 ERR_MODULE_NOT_FOUND。
- 开发助手仍读取已缺失的 packages/agents/item-development/v1/system.md。
- 前端、后端、数据库和工程测试混在 tests 根目录；部分 FS 单元测试相对路径少一级。
- 测试从 docs/superpowers/specs 读取机器可读样本，文档移动会破坏测试。
- README 把实际必需 contracts 写成预留，并链接已移除的旧设计提示词。
- 根目录 artifacts/outputs/runs/artifacts_to_be_deleted 与 .runtime 同时承载本机产物。

## 保留的能力边界

依据当时的路由与 [design-assistant-cleanup.md](../archive/design-assistant-cleanup.md)：旧设计生成接口维持 410；开发助手、历史读取、独立 FS 工作区、模型和 SAP 配置保留。恢复数据契约不等于恢复旧设计引擎。

## 方案选择

保留 apps/packages 的单仓结构，补全包边界、模块归属和自动检查。未选择仅重命名 frontend/backend（不能解决依赖问题），也未选择拆微服务（无当前需求且增加部署成本）。

## 执行记录

- 已先落盘目录契约与 AGENTS 入口，后续按实施计划执行。
- 主工作区内实施；用户指定副本只读，所有误删恢复来自该副本；主 .env、数据库卷及附件存储位置保持。
- 验证结果在实际执行后补充，不以计划代替结果。

## 最终结构与约束

- apps/web 是 Vue 前端，apps/api 是 Fastify 后端；packages/contracts 是双方共享的协议。三个 workspace 独立声明依赖和公开 exports。
- 后端运行入口、数据库配置、诊断实现和业务资源归后端；scripts 只承担工程命令。移除产品对 scripts/tools/docs 的反向依赖。
- 后端业务统一归 modules，平台能力归 platform；测试统一归 unit、integration、e2e，固定样本归 fixtures。
- 恢复清单记录 85 个文件的备份来源与 SHA-256；迁移清单记录 385 条顺序迁移及迁移前哈希，同一文件可能多次迁移，不能把条数当最终文件数。
- 历史产物归 .runtime/archive/pre-refactor，个人助手记忆归 .runtime/archive/assistant-memory；未删除主数据库、附件、.env 或用户备份。
- 修复原 runs/ 忽略规则误覆盖后端业务源码的问题，生成目录忽略规则限定根路径。
- AGENTS.md 指向唯一目录契约；check:architecture 接入 check 和本地启动，检查越界导入、资源存在、包入口、源码误忽略和测试遗漏，并有违规反例测试。
- 既有业务模块交叉依赖在 module-dependencies.json 登记并限制新增。本轮完成应用/包/工具边界整理，不宣称所有业务模块已经解耦。

## 测试迁移中发现的问题

原测试发现遗漏了部分嵌套测试和 clone 集成测试。补全发现后，依据当前产品行为修正旧断言：设计生成维持单次尝试，开发提示词匹配当前指令，创建会话使用开发接口，跨阶段测试使用真正不同阶段，数据库表清单补齐已有迁移。没有恢复已停用设计执行器或增加业务重试。

独立 FS 编辑测试使用仅测试环境提供的 Vite 页面挂载现有组件，连接真实隔离 API/数据库；生产旧 URL 的跳转行为另行验证。保留输入法、附件、编辑、导出、移动布局等断言。迁移引起的下载文件名分隔符变化已修正。

## 验收与限制

- 最终 npm run check 通过：架构检查、契约生成一致性、TypeScript 检查、Vite 生产构建。
- 最终 npm test：252 通过，0 失败、0 跳过；npm run test:e2e：Node 浏览器测试 2 通过，Playwright 12 通过。最终格式整理后再次运行架构检查及工程约束测试，10 项通过。
- start.cmd 已实际启动。最终 HTTP 验证：/home 为 200，/api/health 为 200，旧设计接口 /api/admin/abap-fsd-agent/conversations 为 410。浏览器访问 /home 按预期进入登录页，无 JavaScript 错误。
- 验收日志：.runtime/refactor-final-check.log、.runtime/refactor-final-tests.log、.runtime/refactor-final-e2e.log；登录页截图：.runtime/artifacts/refactor-login.png。
- Dockerfile 已同步 workspace 清单和运行入口；实际镜像构建被 Docker Hub 获取 node:24-bookworm-slim 的 OAuth 网络超时阻断，未完成镜像运行验证。日志：.runtime/refactor-docker-build.log。
- 构建存在 Vite 大块体积提示；不影响构建，但本轮没有进行前端分包优化。
- 没有自动提交或推送。目录移动在未暂存 Git 状态下可能显示为旧文件删除、新文件未跟踪，提交时必须纳入新增路径。
