# App Agent Instructions

Use this file as the app-facing instruction entrypoint.

Read these workflow files in order:

1. `node_modules/@jskit-ai/agent-docs/workflow/app-state.md`
2. `node_modules/@jskit-ai/agent-docs/workflow/bootstrap.md` if the workspace is empty or no JSKIT app exists yet
3. `node_modules/@jskit-ai/agent-docs/workflow/scoping.md`
4. `node_modules/@jskit-ai/agent-docs/workflow/workboard.md`
5. `node_modules/@jskit-ai/agent-docs/workflow/feature-delivery.md`
6. `node_modules/@jskit-ai/agent-docs/workflow/review.md`

Use these references on demand:

- `node_modules/@jskit-ai/agent-docs/reference/autogen/KERNEL_MAP.md`
- `node_modules/@jskit-ai/agent-docs/reference/autogen/README.md`
- `node_modules/@jskit-ai/agent-docs/patterns/INDEX.md`
- `node_modules/@jskit-ai/agent-docs/guide/agent/index.md`
- `node_modules/@jskit-ai/agent-docs/site/guide/index.md` when compressed guidance is ambiguous or missing nuance
- `node_modules/@jskit-ai/agent-docs/templates/APP_BLUEPRINT.md`
- `node_modules/@jskit-ai/agent-docs/templates/WORKBOARD.md`
- `node_modules/@jskit-ai/agent-docs/skills/jskit-review/SKILL.md` for review passes when your Codex environment supports packaged skills

## Mandatory Start Gate

Before any non-trivial change:

1. Read this file and the workflow files above in the current turn. Do not rely on memory alone.
2. If the task involves JSKIT UI, routing, surfaces, CRUDs, filters, placements, live actions, or similar implementation details, scan `node_modules/@jskit-ai/agent-docs/patterns/INDEX.md` and read the relevant pattern files before editing.
3. For substantial or multi-chunk work, create or update `.jskit/WORKBOARD.md` before editing.
4. Before editing, print a compact read receipt with:
   - `Read receipt: ...`
   - `Active chunk: ...`
   - `Generator decision: ...` with the exact `jskit` command to run, or the exact generator/placement discovery commands checked and why no generator applies
   - `Relevant patterns: ...`
   - `Active rules from docs: ...`
5. When files need to be created, prefer `jskit generate ...` over creating them from scratch, even if the generated output will need follow-up adaptation. For a new non-CRUD route page or menu-linked screen, default to `jskit generate ui-generator page ...`. If not using a generator, say why.
6. Do not edit code until the read receipt is printed and the workboard step is complete when it applies.

## Mandatory Done Gate

Before calling a chunk done, report:

- `Deslop review: ...`
- `JSKIT review: ...`
- `Material/Vuetify review: ...`
- `Playwright: ...` for any chunk that adds or changes user-facing UI
- `Verification: ...`
- `Files changed: ...`
- `Commands run: ...`
- `Remaining unverified: ...`

If a feature spans more than one chunk, repeat those passes on the whole changeset after the final chunk.

Core rules:

- Inspect the workspace before assuming a JSKIT app exists.
- Before non-trivial edits, print a short visible checkpoint using this format:
  - `Problem: ...`
  - `Fix: ...`
  - `Why this sticks: ...`
  - `Not doing: ...`
- Keep that checkpoint compact. Do not expand it into a long preamble unless the developer asks for detail.
- Reuse existing JSKIT helpers and runtime seams before adding new local helpers.
- A freshly scaffolded JSKIT app can still be in Stage 1. If the app was just created and platform decisions are not settled yet, continue with the initialize workflow before adding runtime packages.
- Do not treat a missing `config.tenancyMode` line or an untouched minimal scaffold as a final tenancy decision.
- Do not install tenancy-sensitive packages until Stage 1 decisions are complete and the chosen tenancy is written into `config/public.js`.
- Treat standard JSKIT package-owned workflows as the default baseline once the relevant package stack is chosen. Do not ask the developer to redesign those flows unless they want overrides, restrictions, or custom additions.
- Example: if the app is workspace-capable and uses `workspaces-core` plus `workspaces-web`, assume the standard workspace invite flow is part of the baseline package behavior.
- For baseline package setup, ask plainly for the exact local development values needed for the next install step, but only for the modules or packages that are actually selected.
- Use the real env var names or option names instead of vague requests for "credentials". Values such as `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `AUTH_SUPABASE_URL`, `AUTH_SUPABASE_PUBLISHABLE_KEY`, and `APP_PUBLIC_URL` are routine setup inputs when the relevant package stack needs them.
- For CRUD chunks, creating the server CRUD with `jskit generate crud-server-generator scaffold ...` is the crucial first step even if no CRUD UI will be created yet.
- Unless a table is already owned by a JSKIT baseline package or is an explicit narrow exception recorded in `.jskit/table-ownership.json`, every persisted app-owned table must have its own server CRUD package created first with `jskit generate crud-server-generator scaffold ...`, even if no CRUD UI will ever exist.
- Treat that as a hard invariant, not a style preference. If a persisted app-owned table does not have generated CRUD ownership, `jskit doctor` is expected to fail.
- For a CRUD table that `crud-server-generator` will own, do not hand-write a separate migration. Create the real table directly in the database first, then scaffold the server CRUD so JSKIT can install and manage the CRUD migration scaffold itself.
- Do not generate CRUD UI or hand-build CRUD routes before the server CRUD package and shared resource file exist.
- `feature-server-generator` is for workflows, orchestration, and other non-CRUD server features. Do not use it as the starting point for ordinary persisted entity tables.
- Keep direct knex minimal and exceptional. Outside generated CRUD packages and explicit weird-custom feature lanes, app-owned runtime code should use internal `json-rest-api` seams instead of talking to knex directly.
- For CRUD chunks, ask the developer which operations are allowed, which fields belong in the list view if one exists, and the intended look of the view and edit/new forms before generating code.
- Every user-facing screen must pass a Material Design and Vuetify quality review before the chunk is considered done.
- Any chunk that adds or changes user-facing UI must include a Playwright check that exercises the changed behavior before the chunk is considered done.
- Record that Playwright run with `jskit app verify-ui --command "<playwright command>" --feature "<label>" --auth-mode <mode>` so `jskit doctor` can verify the receipt. For local pre-merge review, normally follow it with `jskit doctor --against <base-ref>`. Advanced CI setups may also use `--against <base-ref>`, but that is app-specific.
- If the UI flow requires login, use the app's development-only auth bypass or session bootstrap path instead of a live external auth login flow.
- In JSKIT apps using the standard auth stack, that means enabling the dev auth bypass in development and using `POST /api/dev-auth/login-as` during Playwright setup.
- If authenticated UI work has no usable local auth bootstrap path yet, treat that as a testability gap and call it out before the chunk can be considered complete.
- Do not implement app features before the blueprint has the database, surfaces, ownership model, and route/screen plan written down.
- Plan implementation work as vertical slices. Each chunk should deliver a user-visible or end-to-end outcome that the developer can recognize in the app or behavior, not just an isolated layer change.
- Do not churn `.jskit/APP_BLUEPRINT.md` for a small placeholder page or route stub that fits an existing route family unless the durable route/surface plan actually changed. Track request-level movement in `.jskit/WORKBOARD.md` instead.
- Break planned work into reviewable chunks before implementing. One CRUD is usually one chunk, but auth/platform setup, shell work, and cross-cutting integrations can be their own chunks.
- Avoid horizontal chunk plans like "all migrations first", "all routes next", or "all UI last" unless platform setup truly forces that order. Prefer slices the developer can inspect as real progress.
- Do not move to the next chunk until the current chunk has passed implementation, deslop review, JSKIT best-practices review, Material Design/Vuetify review, and verification.
- If a feature spans more than one chunk, run a final whole-changeset deslop pass, JSKIT pass, Material Design/Vuetify pass, and verification pass after the last chunk.
- Prefer a fresh review agent for chunk and whole-changeset review when the runtime supports delegation.
- Have that fresh review agent use the packaged `jskit-review` skill when it is available to the runtime.
- If delegation or skills are unavailable, follow `workflow/review.md` manually in the current agent.
- Use the compressed guide first for speed; fall back to the human guide when a workflow trap, migration caveat, or architectural boundary needs exact wording.
- Treat generated reference maps and guide copies as vendor reference. Do not edit them manually.

If dependencies are not installed yet:

- install dependencies so `node_modules/@jskit-ai/agent-docs/` exists
- inspect the workspace before assuming a JSKIT app already exists
- if the workspace is empty and the user wants a new app, start with the initialize workflow at a high level first
