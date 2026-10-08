# 规格资产检查工具

读取 tests/fixtures/fs-workspace/specification 内的 JSON Schema、OpenAPI 和示例。Python 脚本来自原始设计验收，运行需要 jsonschema / openapi-spec-validator。

validate_contracts.py 会重写该夹具目录中的反例和 validation-report.json；仅在有意更新测试样本时执行并审查差异。日常一致性校验优先运行 npm run check:fs-contracts 和 npm run test:unit。

产品代码不依赖本目录。目录契约见 ../../docs/architecture/repository-contract.md。
