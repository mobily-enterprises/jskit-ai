# Repository Notes

## Ownership Extractions

NO REIMPLEMENTATION FROM SCRATCH. An ownership move starts from the existing
implementation and its behavioral tests. Classify each piece before extracting:
move to the shared owner, stay in the application, or supply as a host facility.
Changes in how the code works are allowed when necessary to keep ownership
correct; identify that necessity explicitly. Preserve established process sharing,
account isolation, recovery and lifecycle guarantees. Do not build a parallel
implementation and use new tests to justify replacing the original. Keep genuine
new facilities that have no existing counterpart. Preserve a reviewable reference
and current work before corrective extraction.

The user-confirmed production implementation is the reference: it has been used,
tested and tuned over days. Smaller replacement code is not evidence of parity.
For this conversation-runtime extraction, enforce all seven requirements:

1. Inventory original functions, callers, state and tests before editing; mark
   each behavior as moving, staying application-owned, or becoming a host facility.
   Admission, checkpoints, Git, worktrees, attachment storage, renewal UX and
   Senior/Junior orchestration remain Vibe64 responsibilities.
2. Define the session-store, managed-execution, Genesis-shim and provider-selection
   cut lines. Prefer existing small facilities such as `host.execution` and
   `host.commandWrapper`. JSKIT imports no Vibe64 or Genesis; standalone defaults
   must work without them. Do not replace imports with a large callback bag.
3. Preserve Codex's shared app-server per account/runtime isolation scope.
   Conversations own threads, not one server each. Preserve independent stop,
   account/helper-token refresh, process identity, locks, socket limits, hook trust
   and recovery. Any host scope choice uses the same implementation.
4. Move Colleague onto the extracted backend through its common API. Preserve its
   conversation identity and existing storage upgrade.
5. Retain genuinely new direct-API, local-execution, file-storage, application-tool
   and storage-contract facilities that have no Vibe64 counterpart.
6. Verify the frozen baseline and WIP local Git references before extraction.
   Preserve unrelated work and staging; do not reset or publish the WIP refs.
7. Compare original and moved behavior for shared reuse, independent stop,
   account refresh, restart and recovery. Move original tests for the other cases;
   do not weaken their assertions or duplicate the full suite.

For each extraction, record the original source, destination, necessary ownership
adaptation and original test evidence before calling it complete. A new test suite
cannot replace that evidence. Discuss any material redesign before implementing it.

When moving a consumer onto shared code, move the coordination that consumer
relied on at the same time, and check every other user of the same resource.


## New File Discipline

- Create new files only when they are required by the current task, produced by documented tooling, or part of an agreed implementation, test, or documentation change.
- Before adding repo-level guardrail files, persistence files, or durable architecture records by hand, confirm the user approved that lane.
- For generated outputs, run the documented generator or build command and review the generated diff instead of hand-creating files.

## Distributed Agent Docs

- The human guide under `packages/agent-docs/site/guide/` is the source of truth.
- The VitePress site root lives under `packages/agent-docs/site/`.
- The distributed agent-docs package lives under `packages/agent-docs/`.
- Generated package outputs under these paths are build artifacts:
  - `packages/agent-docs/reference/autogen/`
  - `packages/agent-docs/guide/agent/`
  - `packages/agent-docs/site/patterns/`
  - `packages/agent-docs/skills/jskit/references/app-operations.md`
  - `packages/agent-docs/skills/jskit/references/crud-operations.md`
  - `packages/agent-docs/skills/jskit/references/material-3.md`
  - `packages/agent-docs/skills/jskit/references/ui-operations.md`
  - `packages/agent-docs/skills/jskit/references/pattern-index.md`
  - `packages/agent-docs/skills/jskit/references/existing-application-migration.md`
  - `packages/agent-docs/skills/jskit/references/patterns/`
- Authored agent documentation under these paths is edited directly:
  - `packages/agent-docs/patterns/`
  - `packages/agent-docs/templates/`
  - `packages/agent-docs/site/guide/`
  - `packages/agent-docs/skills/jskit/SKILL.md`
  - `packages/agent-docs/skills/jskit/agents/`

## Visible Change Checkpoint

Before non-trivial edits, print a short visible checkpoint for the user in this format:

- `Problem: ...`
- `Fix: ...`
- `Why this sticks: ...`
- `Not doing: ...`

Keep it compact. Do not expand this into a long multi-paragraph preamble unless the user asks for detail. Have all of them in one line.

When asked to create or refresh distributed agent docs:

1. Preserve exact package ids, commands, APIs, tokens, env vars, filenames, route shapes, and architectural meaning.
2. Keep normal English. Do not invent shorthand languages, lossy abbreviations, or alternate terminology.
3. Do not invent behavior or resolve ambiguity by guessing. If the human guide is unclear, keep the uncertainty explicit.
4. Run `npm run agent-docs:build`.
5. Review generated outputs in `packages/agent-docs/` like any other tracked artifact.

## JSKIT Patterns

- `packages/agent-docs/patterns/INDEX.md` is the keyword index for recurring JSKIT implementation heuristics and workflow traps.
- When a request involves JSKIT UI, routing, surfaces, CRUDs, filters, placements, live actions, or similar implementation details, scan the pattern index for matching keywords and read only the relevant pattern files.
- Prefer the highest-level existing JSKIT client composable that fits, especially `useCrudListScreen()`, `useCrudViewScreen()`, `useCrudAddEditScreen()`, `useCrudList()`, `useCrudView()`, `useCrudAddEdit()`, `useList()`, `useView()`, `useAddEdit()`, `useCommand()`, and `useEndpointResource()`, instead of inventing custom local request helpers or bespoke command flows.
- For collection UIs, prefer standard list elements and list runtimes over custom “submit the whole list” command patterns when the normal list/add-edit seams fit.
- When building those elements, the normal end state should be a slim `use***()` composable call plus the template, with at most one or two small local helpers. Avoid building large local orchestration layers around standard JSKIT seams.
- For generated CRUD list/view/form route screens, prefer the shared `users-web` screen composables/components before editing page-local shell chrome.
- When editing the JSON:API CRUD route/service/repository flow, read `packages/crud-core/src/server/jsonApiModule/`, `packages/crud-core/test/defineCrudJsonApiFeature.test.js`, and `packages/crud-core/test/jsonApiRepository.test.js` first. These define the contract for `Document` / `Documents` method names, forwarded options, 404 behavior, tagged JSON:API results, and transaction ownership. Application composition lives in `packages/crud-core/patterns/json-api-resource-package/`.
- Page and surface extension goes through placements. Do not invent alternate page-extension seams (custom registries, tags, injection-only hooks, provider-owned section systems) unless the user explicitly asks for a new pattern.
- Keep `AGENTS.md` short. Add recurring JSKIT heuristics to `packages/agent-docs/patterns/`, not as one-off bullets here.
