# AI Elements Vue integration

Source: https://github.com/vuepont/ai-elements-vue/tree/86c90df1b27cfd7ca05bd7f6c312c46f89c11603

`upstream.json` records imported files and upstream SHA-256 values. Root upstream LICENSE is retained. This is source vendoring, not an npm runtime wrapper. Relevant conversation, message, input, model, attachment, plan/task, artifact, citation, tool and confirmation families are available locally; business questions use Plan plus platform form semantics, not fake tool approvals.

Platform adapters live in `src/features/agent-workbench`, the workbench shared by both assistants. No legacy switch exists. Backend SSE, authorization, item selection, revisions, file IDs and conversation persistence remain authoritative.

Local upstream patches:

- `prompt-input/PromptInput.vue`: explicit template ref assignment for vue-tsc strict unused-local checks; remove unused form ref.
- `../ui/carousel/CarouselContent.vue`: explicit template ref assignment for the same compiler compatibility.
- Import aliases converted from `@repo/*` to platform `@/*`.
- Imported source formatted with the platform's Prettier configuration; upstream hashes describe the original source, not the formatted local files.

Platform adaptations:

- PromptInput uses an inherited context: one platform draft and attachment store, explicit stop, submission gates and no automatic clearing after an entire run.
- Attachment preparing/uploading/readonly gates protect file identity and prevent sending before hashing completes.
- MessageResponse uses streaming Markdown, passive DOMPurify HTML, safe URL protocols, passive remote image descriptions, and lazy Elements CodeBlock renderers.
- Heading observation handles asynchronously mounted Markdown headings and keeps document outline navigation.
- Elements utility/theme CSS uses platform tokens, with existing CSS in the base layer; no global Tailwind Preflight reset.

Upgrades: download a reviewed commit, compare against upstream.json and reapply local patches deliberately. `scripts/vendor/vendor-ai-elements.mjs` is the initial import utility and overwrites imported source; do not rerun against local patches without reviewing the diff. Never use an unpinned all-components registry update in the working application.
