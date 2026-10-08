# 批处理辅助库（保留范围）

旧设计助手的批量生成 CLI 已停用，本目录没有可运行的 fsd-batch.cmd；不能按历史报告恢复该流程。

保留 HTTP 客户端、批次策略、持久化与离线报告辅助库。产品使用的 recorder/analyzer 已归后端 agent-runtime/diagnostics，复制接口已归后端 delivery。本工具通过后端公开诊断 exports 读取能力，后端不再依赖 tools。

测试位于 tests/unit/tooling/fsd-batch；历史克隆集成脚本位于 tests/e2e/fsd-batch。所有本机输出应指定到 .runtime/artifacts/fsd-batch。旧 runs/backups 已原样归档到 .runtime/archive；生产轨迹位于 .runtime/agent-traces。

历史方案与报告不表示当前功能可用。目录规则见 ../../docs/architecture/repository-contract.md。
