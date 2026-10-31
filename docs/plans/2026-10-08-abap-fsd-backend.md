# ABAP FSD backend implementation plan

> 状态：历史 / 已废弃（LangGraph 版设计助手已删除），不代表当前状态；现状以[待办与问题清单](backlog.md)为准。

> Execute inline with executing-plans and test-driven-development. User explicitly authorizes continuous implementation, no commit/push. Evidence and execution ledger: `.runtime/artifacts/abap-backend-2026-10-08`.

**Goal:** Implement the report FSD workflow with durable execution, auditable recovery and executable evaluation.

**Architecture:** Extend `design-assistant` with a new versioned API; retain `unavailable.mjs` unchanged. PostgreSQL owns business facts, atomic audit/outbox and fenced commits. LangGraph PostgreSQL checkpoints contain references and reconcile against StepCommit, with immutable input and asset manifests.

**Tech Stack:** Fastify, PostgreSQL, JavaScript LangGraph, OTel/Collector/Jaeger, existing Vue workbench.

**Spec:** `D:/第二大脑/10-Projects/01. ABAP智能体(PoC)/docs`: 01 V0.13, 03/04/05 V0.2, 06/09 V0.1. Historical review is background, not the current contract.

## Constraints and decisions

- Old `/design/agent`, `/design/gem-fsd-v2` and admin ABAP endpoints stay 410. New API: `/api/projects/:projectId/development-items/:itemId/work/design/fsd/v1`.
- Reuse authorization through an explicit item-workspace public facade; models/SAP/material access through explicit public facades. Register module edges before imports.
- No restored old engine, SAP writes, destructive reset, primary database test fallback or automatic commits.
- Pending real scenario, target/client, material export authorization, confirmation rules and format remain blocked for real use; synthetic two-gate workflow can be implemented independently.
- Frozen input -> logical run/thread; complete answers -> successor run/new thread; confirmation -> original run/thread.
- Default budgets: 12/60 calls per run, 48/240 per task, 30k/120k tokens, 900/3600s active time, 80 steps, model/tool timeout 120/45s; repair 1, tool retries 2; lease 30s renewed every 10s.

## Baseline mapping

| Requirement        | Existing capability                    | Gap / implementation                            | Verification                                |
| ------------------ | -------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| Scoped commands    | item-workspace authorization           | versioned routes/service                        | unauthorized, stale and duplicate commands  |
| Recovery           | fs-workspace custom runs               | new domain ledger + LangGraph durable saver     | REC/STATE hard exits, barrier races         |
| Models / materials | models registry, agent-runtime parser  | pinned adapters + closed output contracts       | MODEL/FLOW, no LLM while collecting         |
| SAP                | technical MCP transport                | closed read-only adapter and coverage           | TOOL, real SAP-C gated                      |
| Observation        | JSON HTTP log, old diagnostics         | OTel spans, bounded export, audited diagnostics | OBS/DBG plus collector query                |
| Evaluation         | root test discovery / isolated DB      | 54-ID manifest, runner and comparison           | machine results separate from expert status |
| UI                 | AgentWorkbench and session composables | minimal versioned design connection             | typecheck/build and browser integration     |

## Review focus

1. Late workers must not write checkpoints or business facts after lease loss.
2. Authorization revoked during execution must prevent later commits/downloads.
3. Answer edits invalidate in-flight results and never mutate frozen snapshots.
4. Unknown remote completion must retain budget and never mix page generations.
5. Diagnostics must omit arbitrary provider/user text even in exception metadata.

## Tasks

- [x] 1. Record source inventory, baseline and API mapping; verify installed SDK interfaces and isolated DB. Update directory contract/dependency checker for explicit new edges, add negative checker assertions.
- [x] 2. Add closed shared schemas, pure guards, evidence/tool policy and budgets. Tests first in `tests/unit/api/design-assistant`; verify invalid outputs, answers, evidence and tool denial.
- [x] 3. Add versioned migration and `repository.mjs` (service operations remain module-local functions): input snapshots, tasks, sessions, runs, attempts, operations, reservations, artifacts, waits/decisions, audit/outbox and StepCommit. Integration tests for idempotency, CAS, audit rollback and fencing.
- [x] 4. Add `graph.mjs`, versioned prompts, model/tool adapters and `worker.mjs`: N01–N11, durable interrupts, compatibility and reconciliation. Independent process kill/restart tests plus deterministic full flow.
- [x] 5. Add observation module, Collector/Jaeger local configuration, authorized diagnostics/replay/export and progress cursor. Verify bounded failure, redaction and real exported spans.
- [x] 6. Register versioned API and worker, adapt existing design UI only. Verify auth, attachment/download scope, reset history, old 410 and browser workflow.
- [x] 7. Implement 54-ID fixtures/runner/comparison, SAP-C gated probes, startup/recovery guide and evidence matrix. Run architecture, contracts, typecheck, build, full unit/integration tests; explicitly record blocked external validation.

Each task follows failing behavioral test -> implementation -> passing test; meaningful failures remain recorded. Integration tests use only the existing isolated test environment. Verification outputs and hashes are local evidence; source and reusable tests are versioned.

## Verified delivery status

Engineering implementation and synthetic regression are recorded in docs/specs/abap-fsd-implementation.md: 341 default tests pass; final fixed set has 47 PASS and 7 external BLOCKED. Architecture retains the original .archify failure; Docker image build is blocked by registry authentication-network timeout. G2/G3 remain unaccepted. No commit, push, main database migration or publication was performed.
