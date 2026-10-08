# 共享数据契约

必需产品源码，不是缓存，也不是可删除的旧助手执行器。

- fs-workspace：功能规格工作区的 JSON Schema、运行时校验及生成类型。
- agent-runtime：助手通信和历史 FSD 文档格式、纯 Markdown 格式化。fsd/v1 表示历史文档格式，不代表恢复旧设计引擎。
- item-workspace：设计/开发文档结构校验与格式化。

公开入口以 package.json exports 为准。前端只使用纯协议、类型或 JSON Schema 入口；读取文件系统的校验模块只能由 Node 消费。禁止引用 apps、scripts 或 tools。

生成 FS TypeScript 类型：根目录 npm run generate:fs；检查同步：npm run check:fs-contracts。改变契约需同步消费者和测试，不手工修改 generated/types.ts。

完整边界见 ../../docs/architecture/repository-contract.md。
