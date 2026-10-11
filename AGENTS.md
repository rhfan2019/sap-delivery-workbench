# 项目协作约束

任何新增、移动、重命名、删除文件或改变模块依赖前，必须先阅读并遵守
[目录与依赖契约](docs/architecture/repository-contract.md)。该文件是本仓库目录归属的唯一规范。

- 先确定责任模块，再确定目录；禁止新增没有明确职责的根目录、通用杂物包或第二套同义结构。
- 跨 workspace 使用 package.json 的公开 exports；后端不得依赖 scripts，前端不得依赖后端源码。
- 删除前检查代码导入、运行时资源、测试、构建、部署和文档入口。不能把提示词、Schema、类型或附件当缓存。
- 变更目录必须同步修改引用、测试发现、npm 命令、Docker COPY 和目录导航；不得留下旧路径转发壳。
- 提交前运行 npm run check:architecture，并完成契约规定的相关验证；失败必须如实报告。
- 需要改变规则时，先修改契约及对应检查规则，再迁移消费者。不得临时绕过检查器。
- FSD 设计助手按[方向决策](docs/architecture/2026-10-11-fsd-assistant-direction-decision.md)完全重构：只保留一个版本，历史设计助手各代（含 410 边界、旧表与数据）按契约 3.1 清除，不恢复旧设计引擎。其他模块的目录整理仍不授权删除历史数据或改变公开 API。
- 本机 .env、.runtime 中的凭据与附件、数据库卷和用户备份受保护，不做批量清理。

2026-10-08 的重构记录见 docs/architecture/refactor-record.md；执行计划见 docs/plans/2026-10-08-repository-refactor.md。
