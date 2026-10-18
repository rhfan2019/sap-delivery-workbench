# 共享数据契约

必需产品源码，不是缓存。

- abap-fsd-agent：FSD 设计助手前后端共用的纯协议与类型（对话事件、SSE 解析等）。
- delivery：开发清单字段目录、选项与纯函数（表格、抽屉、校验、Excel 共用）。
- access：权限点目录、预置角色与职位（菜单、按钮、角色编辑器与服务端启动同步共用；不做权限决策）。
- projects：项目主数据的选项与纯函数（项目类型、状态、SAP 产品、模块、阶段、里程碑、健康度）。

公开入口以 package.json exports 为准。前端只使用纯协议、类型入口；禁止引用 apps、scripts 或 tools。改变契约需同步消费者和测试。

完整边界见 ../../docs/architecture/repository-contract.md。
