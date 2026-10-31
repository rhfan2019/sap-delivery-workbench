# Assistant feedback execution ledger

> 状态：历史 / 已废弃（所述旧设计助手已清除），不代表当前状态；现状以[待办与问题清单](backlog.md)为准。

Approved scope: runs/20261005-212831-647 运行测试实例报告.MD, plus user correction: reset removes BOTH design/development conversations, drafts and artifacts. Preserve development-item master data only. No legacy switch.

Ruling: workspace has no Git repository; edit in place, no fabricated worktree/commit. Execute inline using executing-plans and TDD; final fresh-context reviewer.

Ruling: reset is a user-invoked destructive feature, not an instruction to erase the current test example now. Test deletion in isolated fixtures. Keep audit metadata, remove business conversation/output data. Require permissions for both stages; serialized reset/run admission and stale-session rejection prevent resurrection.

Pre-flight interfaces: reset shares run admission with create and workspace locks with save; output conversion shares renderer with downloads; facts feed every model subcall; stage cards consume persisted terminal state and live events.

- [x] Regression cases and execution/reset contracts
- [x] Item reset (server and both-stage browser state)
- [x] Log diagnostics and visible run information
- [x] Expert prompts, grounded decisions and protocol/convert fixes
- [x] Structured output, MD renderer and stage guidance
- [x] Full tests, independent review and report update

Review ledger: independent reviewer found legacy content remained, older artifact won over newer JSON, development diagnostics stayed queued; then identified legacy message/run FK ordering and non-report development outputMode mismatch. Fixed all with regressions. Forward SQL repair deletes messages before runs. Final read-only reviewer confirmed both final fixes, no further blocking findings in reviewed scope.

Ruling: legacy contents are part of reset, not merely hidden. Narrow database procedure removes scoped legacy records without giving runtime broad DELETE grants on immutable tables. Basic development-item metadata and audit events remain. All destructive verification uses isolated fixtures, not the user's development item.

Verification: 172 FS tests + 53 platform tests, 8 Playwright scenarios, 11 full workspace checks; production build/typecheck passed with known chunk warnings. Real model shadow test: initial two calls failed output contracts; user explicitly authorized two more calls, which passed natural-language/ready JSON contracts. No live SAP calls or business writes. Model still suggests unverified technical candidates; do not claim SAP correctness.

Legacy compatibility: read-only inspection of reported conversation recovers four numbered natural-language answers from snapshots, without rewriting them. Report updated with exact evidence links.
