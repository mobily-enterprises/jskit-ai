# Distributed Agent Guide

Read these in order:

1. `workflow/app-state.md`
2. `workflow/bootstrap.md` if the workspace is empty or no JSKIT app exists yet
3. `workflow/scoping.md`
4. `workflow/feature-delivery.md`
5. `workflow/review.md`

Use these references on demand:

- `reference/autogen/KERNEL_MAP.md`
- `reference/autogen/README.md`
- `guide/agent/index.md`
- `guide/human/index.md` when compressed guidance is ambiguous or missing nuance
- `templates/APP_BLUEPRINT.md`

Core rules:

- Inspect the workspace before assuming a JSKIT app exists.
- Reuse existing JSKIT helpers and runtime seams before adding new local helpers.
- Do not implement app features before the blueprint has the database, surfaces, ownership model, and route/screen plan written down.
- Use the compressed guide first for speed; fall back to the human guide when a workflow trap, migration caveat, or architectural boundary needs exact wording.
- Treat generated reference maps and guide copies as vendor reference. Do not edit them manually.
