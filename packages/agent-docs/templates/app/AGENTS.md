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
- `node_modules/@jskit-ai/agent-docs/guide/agent/index.md`
- `node_modules/@jskit-ai/agent-docs/guide/human/index.md` when compressed guidance is ambiguous or missing nuance
- `node_modules/@jskit-ai/agent-docs/templates/APP_BLUEPRINT.md`
- `node_modules/@jskit-ai/agent-docs/templates/WORKBOARD.md`
- `node_modules/@jskit-ai/agent-docs/skills/jskit-review/SKILL.md` for review passes when your Codex environment supports packaged skills

Core rules:

- Inspect the workspace before assuming a JSKIT app exists.
- Reuse existing JSKIT helpers and runtime seams before adding new local helpers.
- A freshly scaffolded JSKIT app can still be in Stage 1. If the app was just created and platform decisions are not settled yet, continue with the initialize workflow before adding runtime packages.
- Do not treat a missing `config.tenancyMode` line or an untouched minimal scaffold as a final tenancy decision.
- Do not install tenancy-sensitive packages until Stage 1 decisions are complete and the chosen tenancy is written into `config/public.js`.
- Do not implement app features before the blueprint has the database, surfaces, ownership model, and route/screen plan written down.
- For substantial or multi-chunk work, create or update `.jskit/WORKBOARD.md` as the per-request execution tracker.
- Break planned work into reviewable chunks before implementing. One CRUD is usually one chunk, but auth/platform setup, shell work, and cross-cutting integrations can be their own chunks.
- Do not move to the next chunk until the current chunk has passed implementation, deslop review, JSKIT best-practices review, and verification.
- If a feature spans more than one chunk, run a final whole-changeset deslop pass, JSKIT pass, and verification pass after the last chunk.
- Prefer a fresh review agent for chunk and whole-changeset review when the runtime supports delegation.
- Have that fresh review agent use the packaged `jskit-review` skill when it is available to the runtime.
- If delegation or skills are unavailable, follow `workflow/review.md` manually in the current agent.
- Use the compressed guide first for speed; fall back to the human guide when a workflow trap, migration caveat, or architectural boundary needs exact wording.
- Treat generated reference maps and guide copies as vendor reference. Do not edit them manually.

If dependencies are not installed yet:

- install dependencies so `node_modules/@jskit-ai/agent-docs/` exists
- inspect the workspace before assuming a JSKIT app already exists
- if the workspace is empty and the user wants a new app, start with the initialize workflow at a high level first
