# 服务端应用

Fastify 应用，公开工具接口见 package.json 的 exports。

- src/app.mjs 负责组装，src/server.mjs 为生产入口，src/worker.mjs 为独立 FS worker。
- src/platform 负责认证、密码、数据库、生产配置。
- src/modules 按业务归属，每个模块拥有自己的路由、服务、查询与资源。
- agent-runtime 是开发助手和历史读取共用的运行支持；design-assistant 只保留已停用接口边界。
- 应用不得依赖 scripts/tools/tests/docs。跨 workspace 使用包 exports。内部存量跨业务依赖在 docs/architecture/module-dependencies.json 登记。

在仓库根目录 npm run dev 或 start.cmd 联合启动。规则见 ../../docs/architecture/repository-contract.md。
