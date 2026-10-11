# 文档索引

本仓库保留与源码版本对应的工程文档；外部知识库可维护产品研究，但应用和测试不能依赖本机知识库路径。

- [目录与依赖契约](architecture/repository-contract.md)：新增、修改、移动、删除文件的唯一目录规范。
- [目录重构记录](architecture/refactor-record.md)：原问题、迁移清单与实际验证结果。
- [实施计划](plans/2026-10-08-repository-refactor.md)：本轮执行任务。
- [ABAP FSD 运行指南](guides/abap-fsd-backend.md)：新版本后端启动、诊断、恢复、探针与评估。
- [ABAP FSD 实施说明](specs/abap-fsd-implementation.md)：实现映射、工程证据和真实系统准入边界。
- [ABAP FSD 开发计划](plans/2026-10-08-abap-fsd-backend.md)：本次后端实施进度。
- [FSD 设计助手方案审视](architecture/2026-10-11-fsd-assistant-approach-review.md)：现行提示词、状态控制与 SAP 接入的现状、问题和待讨论方向（交接用）。
- `guides/`：当前维护与操作说明。
- `specs/`：版本化设计规格；供测试读取的机器样本已归 `tests/fixtures/fs-workspace/specification`。
- `plans/`：实施计划；历史计划不自动代表当前完成状态。
- `archive/`：历史方案、验收与旧助手停用记录，不作为现行运行配置。
- `design-options/` 与 `screenshots/`：设计参考和评审资料。

运行方法、端口、测试命令以根目录 [README](../README.md) 为入口；目录规则以契约为准，旧说明若有冲突不覆盖契约。
