# Elements assistant integration

> 状态：历史 / 已废弃（已执行；之后的设计助手已重构为 abap-fsd-agent），不代表当前状态；现状以[待办与问题清单](backlog.md)为准。

Goal: Replace the assistant presentation system with upstream AI Elements Vue, without a legacy switch; preserve development-item integration and verify the full flow.

Architecture: Vendor relevant upstream Elements components at 86c90df1b27cfd7ca05bd7f6c312c46f89c11603 with their shadcn primitives. Keep useAssistantRun and server contracts authoritative. Platform adapters own attachments, submission eligibility, business questions, artifact revision and item events.

Execution: inline, authorized by the user's explicit request to implement immediately. Existing workspace has no Git repository; work in place without creating a misleading worktree or commit.

- [x] Import traceable components and configure isolated theme/utilities.
- [x] Add regression tests for composer state, drafts, IME, item context and artifact integration.
- [x] Replace conversation, composer/model picker, Markdown, attachments, decisions, steps and artifact presentation.
- [x] Run typecheck/build, FS unit and isolated integration tests, browser desktop/mobile scenarios.
- [x] Review changes and record test evidence and remaining limitations. See `docs/archive/elements-integration-acceptance.md`.

Review focus: asynchronous submission must not erase the next draft; readonly item controls must not mutate; stop must cancel the existing run; attachments must keep remote identity; streaming Markdown must not permit active HTML or unsafe URLs.

No legacy UI flag. No new backend protocol. No fabricated tool approvals, token metrics or citations. All existing project/item/stage selection and openArtifact/artifact/conversation/busy/filesChanged events stay intact.

Review ledger: independent read-only reviewer found asynchronous Markdown heading/outline timing and attachment preparation/send races. Browser regressions reproduced both (logs in artifacts/fs-workspace/elements-regression-red.log and elements-attachment-red.log). Fixed using heading observation and pending attachment batch gating; the complete eight-scenario browser suite subsequently passed. Full item API/database/browser smoke passed nine checks. Model/SAP suppliers are local fixtures, not live calls.
