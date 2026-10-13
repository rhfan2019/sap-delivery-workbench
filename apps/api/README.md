# 服务端应用

Fastify 应用，公开工具接口见 package.json 的 exports。

- src/app.mjs 负责组装，src/server.mjs 为生产入口。
- src/platform 负责认证、密码、数据库、生产配置。
- src/modules 按业务归属，每个模块拥有自己的路由、服务、查询与资源。
- abap-fsd-agent 是 FSD 设计助手（已重构，批量测试与优化中）；audit 承载后台审计日志与助手运行评论；item-workspace 只提供开发项工作区的访问上下文。
- 应用不得依赖 scripts/tools/tests/docs。跨 workspace 使用包 exports。内部存量跨业务依赖在 docs/architecture/module-dependencies.json 登记。

在仓库根目录 npm run dev 或 start.cmd 联合启动。规则见 ../../docs/architecture/repository-contract.md。
