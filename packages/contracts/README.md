# 共享数据契约

必需产品源码，不是缓存。

- abap-fsd-agent：FSD 设计助手前后端共用的纯协议与类型（对话事件、SSE 解析等）。

公开入口以 package.json exports 为准。前端只使用纯协议、类型入口；禁止引用 apps、scripts 或 tools。改变契约需同步消费者和测试。

完整边界见 ../../docs/architecture/repository-contract.md。
