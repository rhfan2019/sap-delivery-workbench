# FSD batch automation

Goal: clone basic development-item information, execute the same HTTP workflow as the UI sequentially with the default LLM, persist isolated resumable state, and analyze complete traces.

Approved design: CLI runner + shared backend recorder + offline JSON/HTML analysis. All new tooling, configuration, tests, documentation and outputs live under tools/fsd-batch. Only integration hooks and correctness fixes touch existing code. No separate model executor or prompt pipeline.

Constraints: independent item and conversation per case; no copied attachments, decisions, artifacts or approval states. Preset answers are test-only. Missing answers pause the case. Completion requires a saved final specification (not consultant final approval); draft approval is an explicitly recorded test workflow action. Structural, persistence and business-quality results remain distinct.

Implementation plan (inline execution, approved user request):
- [x] Recorder: timestamped events and model calls with full request/output, no credentials; shared diagnostics UI; atomic failure state.
- [x] Clone API: permission checked, basic field allowlist, prefix validation and idempotent clone identity.
- [x] Runner: default-model selection, isolated per-case state, write-ahead request IDs, checkpoint recovery, preset answer matching, final artifact verification.
- [x] Analyzer: step/call durations, attempts/tokens, separate success criteria, evidenced recommendations, JSON + escaped HTML + Markdown.
- [x] Tests: failure terminal regression, recorder redaction, clone idempotency/isolation, resume/no duplicate requests, answer scoping, percentile/error analysis.
- [ ] Real sequential DEV-0007 / DEV-0002 run, original-item integrity check and full report.

Review focus: unknown HTTP outcomes; runner interruption while server still active; missing preset answers; context cross-contamination; missing telemetry must not be reported as zero latency or success.

Execution ledger: repository is not a Git checkout; changes are made in place, with touched existing files backed up under this directory. No Git commit/worktree operations apply.
