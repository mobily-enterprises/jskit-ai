# App Agent Instructions

Use this file as the app-facing instruction entrypoint.

Read these workflow files in order:

1. `node_modules/@jskit-ai/agent-docs/workflow/app-state.md`
2. `node_modules/@jskit-ai/agent-docs/workflow/bootstrap.md` if the workspace is empty or no JSKIT app exists yet
3. `node_modules/@jskit-ai/agent-docs/workflow/scoping.md`
4. `node_modules/@jskit-ai/agent-docs/workflow/feature-delivery.md`
5. `node_modules/@jskit-ai/agent-docs/workflow/review.md`

Use these references on demand:

- `node_modules/@jskit-ai/agent-docs/reference/autogen/KERNEL_MAP.md`
- `node_modules/@jskit-ai/agent-docs/reference/autogen/README.md`
- `node_modules/@jskit-ai/agent-docs/guide/agent/index.md`
- `node_modules/@jskit-ai/agent-docs/guide/human/index.md` when compressed guidance is ambiguous or missing nuance
- `node_modules/@jskit-ai/agent-docs/templates/APP_BLUEPRINT.md`

Core rules:

- Inspect the workspace before assuming a JSKIT app exists.
- Reuse existing JSKIT helpers and runtime seams before adding new local helpers.
- Do not implement app features before the blueprint has the database, surfaces, ownership model, and route/screen plan written down.
- Use the compressed guide first for speed; fall back to the human guide when a workflow trap, migration caveat, or architectural boundary needs exact wording.
- Treat generated reference maps and guide copies as vendor reference. Do not edit them manually.

If dependencies are not installed yet:

- install dependencies so `node_modules/@jskit-ai/agent-docs/` exists
- inspect the workspace before assuming a JSKIT app already exists
- if the workspace is empty and the user wants a new app, start with the initialize workflow at a high level first
