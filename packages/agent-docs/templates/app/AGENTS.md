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

Core rules:

- Inspect the workspace before assuming a JSKIT app exists.
- Before non-trivial edits, print a short visible checkpoint using this format:
  - `Problem: ...`
  - `Fix: ...`
  - `Why this sticks: ...`
  - `Not doing: ...`
- Keep that checkpoint compact. Do not expand it into a long preamble unless the developer asks for detail.
- When a request involves JSKIT UI, routing, surfaces, CRUDs, filters, placements, live actions, or similar implementation details, scan `node_modules/@jskit-ai/agent-docs/patterns/INDEX.md` for matching keywords and read only the relevant pattern files.
- Reuse existing JSKIT helpers and runtime seams before adding new local helpers.
- A freshly scaffolded JSKIT app can still be in Stage 1. If the app was just created and platform decisions are not settled yet, continue with the initialize workflow before adding runtime packages.
- Do not treat a missing `config.tenancyMode` line or an untouched minimal scaffold as a final tenancy decision.
- Do not install tenancy-sensitive packages until Stage 1 decisions are complete and the chosen tenancy is written into `config/public.js`.
- Treat standard JSKIT package-owned workflows as the default baseline once the relevant package stack is chosen. Do not ask the developer to redesign those flows unless they want overrides, restrictions, or custom additions.
- Example: if the app is workspace-capable and uses `workspaces-core` plus `workspaces-web`, assume the standard workspace invite flow is part of the baseline package behavior.
- For baseline package setup, ask plainly for the exact local development values needed for the next install step, but only for the modules or packages that are actually selected.
- Use the real env var names or option names instead of vague requests for "credentials". Values such as `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `AUTH_SUPABASE_URL`, `AUTH_SUPABASE_PUBLISHABLE_KEY`, and `APP_PUBLIC_URL` are routine setup inputs when the relevant package stack needs them.
- For CRUD chunks, ask the developer which operations are allowed, which fields belong in the list view if one exists, and the intended look of the view and edit/new forms before generating code.
- Every user-facing screen must pass a Material Design and Vuetify quality review before the chunk is considered done.
- Do not implement app features before the blueprint has the database, surfaces, ownership model, and route/screen plan written down.
- For substantial or multi-chunk work, create or update `.jskit/WORKBOARD.md` as the per-request execution tracker.
- Break planned work into reviewable chunks before implementing. One CRUD is usually one chunk, but auth/platform setup, shell work, and cross-cutting integrations can be their own chunks.
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
