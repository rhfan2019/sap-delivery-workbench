# 智能助手本机运行与观察

设计助手（`abap-fsd-agent`）与开发助手（`abap-dev-agent`）开发、测试时共用的操作说明。各工作线的交接文档只链接本文，不再各抄一份。启动、端口、检查命令以根目录 [README](../../README.md) 为准。

## 1. 启动、停止与重启

- 启动 / 停止：双击 `start.cmd` / `stop.cmd`，或 `npm start` / `npm stop`。启动器逐项确认数据库、API、前端页面与代理都可用后才提示成功；开机后首次启动较慢（可能一分钟左右）。日志在 `.runtime/web.log`。
- **API 不热更新**：改后端代码或提示词（`prompts/`）后要重启才生效；前端改动由 Vite 热更新。
- **重启前确认没有运行中的轮次**：重启会打断正在运行的对话。先查 `app.abap_fsd_agent_turn`、`app.abap_dev_agent_turn` 中 `status='running'` 的记录；有则先问用户。
- 页面某些入口点了没反应、控制台出现 `504 (Outdated Optimize Dep)` 或 `Failed to fetch dynamically imported module`：开发服务的依赖打包缓存被替换了，重启服务即可。测试已用单独的缓存（`node_modules/.vite-test`，BUG-008）；另起 Vite 时不要用开发服务的缓存目录。
- 内置浏览器预览：`.claude/launch.json` 的 `dev` 配置只连接已运行的 5173，不另起进程；`.claude` 目录不入库（契约 1.11）。

## 2. 登录

- 账号取 `.env` 的 `TEST_USER_NAME` / `TEST_USER_PASS`（本地管理员）。不要把密码写进聊天。
- 在内置浏览器里，页面内调用最可靠（表单输入曾失败）：
  `fetch('/api/login', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({loginName, password})})`
- 会话空闲 30 分钟失效（只有 API 请求会续期）；不同浏览器各有一套 cookie。遇到 401 重新登录即可。登录页显示“服务暂不可用”时是 `/api/session` 请求失败，先查服务是否在运行。

## 3. 观察一轮运行

一轮通常 1～6 分钟。等待时用 Monitor 的 until 循环查轮次 `status` 不再是 `running`，不要短间隔轮询。

- **审计页**（只有设计助手，开发助手接入见待办 FEAT-004）：`/settings/audit`，每轮详情含对话、工具调用与文档比对；也可调用 `/api/audit/runs/:turnId`。
- **直接查库**（两个助手都适用，最快）：在 scratchpad 写 Node 脚本，用 `createRequire('file:///D:/Workspace/sap-delivery-workbench/apps/api/package.json')('pg')` 与 `apps/api/src/platform/database.mjs` 的 `databaseConfig({ runtime: true })` 连库，以 `node --env-file=.env` 运行。表前缀 `app.abap_fsd_agent_` / `app.abap_dev_agent_`：
  - `turn`：`status`、`stop_reason`、`usage`、`error`
  - `tool_call`：`name`、`status`、`result_summary`、`arguments`
  - `message`：`payload ? 'questions'` 取出题，`role='assistant'` 取回复
  - `version`：开发助手的 `source`、`length(plan)`、`length(code)`、`comparison`
- 发消息与读结果也可在页面内 `fetch` 调用 `/api/projects/:projectId/development-items/:itemId/<助手>/sessions/...`。服务重启或 Vite 刷新会中断页面脚本，发之前确认页面稳定。

## 4. 模型与代理

- 模型由组织配置，用户会随时切换；对话输入框可按消息选择。**测试前读取并记录当前模型名，不要写死。**
- 不能直连境外模型接口时，设置 `LLM_PROXY_URL`；探测模型要走应用自己的传输层（`models/chat.mjs` 的 `streamChat`，代理在 `models/transport.mjs`），它会读取代理配置。
- 可选环境变量（见 `.env.example`）：`ABAP_FSD_AGENT_THINKING=off` / `ABAP_DEV_AGENT_THINKING=off`（关闭深度思考）、`*_MAX_OUTPUT_TOKENS`（单次回复上限）、`*_FILES_DIR`（附件目录，生产须为绝对路径）。

## 5. 测试项目与 SAP

- 项目“虚拟测试项目”：`701457cc-8594-4c8f-9a90-befe93f0067a`。各工作线的测试开发项与对话见其交接文档。
- SAP：DEV 与 QAS 目前是同一套 SELF-S4H-2020（S4CORE 105 · SAP_BASIS 755，client 100），项目里已保存凭据，只读访问直接可用；框架类 `YCL_FRH_REPORT` 等和范例程序 `YDEMO_FRH_0021` 都在该系统中。
- **不要往用户自己的对话里发测试消息**，测试一律新建对话。

## 6. 审计与优化建议流程（用户手动触发）

1. 用户在审计页每轮详情里写评论。
2. 用户说“分析审计日志”时：`npm run audit:export -- --since <日期>`（输出到 `.runtime/artifacts/assistant-logs/`）。
3. 结合导出材料与代码写建议方案（Markdown），用 `npm run audit:publish -- <文件> --title "<标题>" --since <日期> --source <导出的 JSON>` 发布到“优化建议”标签。
4. 平台不调用模型生成建议，没有定时任务。
