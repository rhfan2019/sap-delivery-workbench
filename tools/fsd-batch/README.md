# 批量 FSD 回归测试

本目录包含命令行执行器、公共结构化日志模块、离线分析器和测试。不启动第二套生成服务，不直接调用 LLM，不复制业务生成逻辑。执行器调用与开发项设计页面相同的 HTTP 接口。

## 使用

先正常启动工作台。创建配置（参考 `configs/acceptance.json`），填写项目 UUID、原开发项编号、每项独立的预置答案。通过环境变量提供登录信息，不放入配置或命令行参数：

```powershell
$env:FSD_BATCH_LOGIN = '你的账号'
$env:FSD_BATCH_PASSWORD = '你的密码'
tools\fsd-batch\fsd-batch.cmd run --config tools/fsd-batch/configs/my-cases.json --out tools/fsd-batch/runs/my-batch
tools\fsd-batch\fsd-batch.cmd resume --out tools/fsd-batch/runs/my-batch
tools\fsd-batch\fsd-batch.cmd analyze --out tools/fsd-batch/runs/my-batch
```

也可将现有会话 Cookie 字符串保存在权限受控的本地文件，设置 `FSD_BATCH_COOKIE_FILE` 为路径。Cookie/密码不会写入报告。生产环境只使用正常登录流程；工具没有免认证服务端接口。

失败后明确重试：`resume --out ... --retry-failed`。缺少答案后修改配置并执行 `resume --out ... --config ...`。推荐精确 `question` 匹配；`pattern` 是显式配置的正则，多个规则同时命中时暂停，不取第一个。回答可以是 `text` 或精确 `optionLabel`，不会自动选择模型推荐项。

`approveTestDraft: true` 仅允许对隔离测试副本执行初稿确认，以进入与页面一致的细化、核验、质量审查流程。最终保存到 `final_review` 即完成测试，不代替顾问最终签认；业务质量默认记录为未评估。预置答案是测试假设，不是生产项目确认。

退出码：0 全部最终保存；2 有失败/待回答项；1 执行器或网络异常。HTML 报告不需要 Web 服务，可直接打开。

## 隔离与复制

- 同一批次统一使用 Asia/Shanghai 的 `YYMMDD-HHMMSS-` 前缀。新项保留原编号后缀。
- 仅复制名称、模块、类型、变更性质、优先级、需求描述及格式、验收标准。
- 不复制附件、工作稿、审批、历史会话、历史答案、负责人、开发结果、备注。测试副本负责人设为执行账号，项目及其系统配置沿用。
- 每项独立开发项、会话、请求编号、答案集合及日志子目录。初次请求 `messages=[]`，不传 `handoffFrom`。
- 所有生成都通过公共 `/work/design/agent/runs`；公共前端、校验、核验与保存逻辑同时受益于日志改造。

## 恢复边界

复制请求与生成请求均先写入本地状态。未知响应先按请求 ID 查询服务端回执；不因网络响应丢失盲目新建请求。复制 API 幂等，已经完成的测试项自动跳过。批次锁阻止同一目录并发运行。

恢复保留有效的已保存版本、会话及已回答问题。服务端断开流时可能取消尚在生成的调用，这种调用从该轮重新执行，不能从任意 token 恢复。服务进程重启后等待旧运行租约恢复终态，再明确重试。若上一运行是否结束尚不确定，执行器停止整个批次，避免同时运行下一项。

## 日志与报告

- `runs/telemetry/<runId>.jsonl`：公共后端时间戳事件、模型请求上下文、输出增量、完成结果/错误、步骤事件；不记录提供方私有思维链，只记录推理 token/字符统计。
- `<批次>/state.json`：恢复检查点；`config.json`：本次配置。
- `<批次>/<原编号>/`：原项快照、每轮请求、回答匹配、运行快照、轨迹、最终 JSON 与 `说明书.md`。
- `report.json`、`report.md`、`report.html`：独立统计运行完成、结构通过、版本保存、最终成果、业务质量，含每步与模型调用耗时及证据驱动建议。
- 步骤耗时包含子模型调用，不能直接相加。缺失耗时显示未知，未执行步骤不算成功。p50/p95 按有完整起止时间的运行计算，小样本不代表稳定性能。
- 完整日志包含业务需求和 SAP 元数据，只在具备运行访问权限的接口读取；本地报告仍需按项目权限保存。`runs/`、本地配置与备份不纳入源码。

可通过 `FSD_TRACE_DIR` 指定持久化日志根目录；多实例部署应使用共享持久卷或替换为集中式存储，不能依赖临时容器文件系统。

## 验证

```powershell
node --test tools/fsd-batch/tests/*.test.mjs
node --env-file=.runtime/fs-tests.env --test tools/fsd-batch/tests/clone.integration.mjs
node --test tests/fs-workspace/unit/assistant-*.test.mjs
npm run typecheck
npm run build
```

集成测试强制使用现有隔离测试数据库，禁止指向业务库。真实 DEV-0007 / DEV-0002 验收只对副本生成文档，SAP 调用沿用系统现有只读核验，不执行审批、转单或其他业务写入。
