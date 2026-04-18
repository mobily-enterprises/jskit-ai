# Distributed Agent Guide

Read these in order:

1. `workflow/app-state.md`
2. `workflow/bootstrap.md` if the workspace is empty or no JSKIT app exists yet
3. `workflow/scoping.md`
4. `workflow/workboard.md`
5. `workflow/feature-delivery.md`
6. `workflow/review.md`

Use these references on demand:

- `reference/autogen/KERNEL_MAP.md`
- `reference/autogen/README.md`
- `guide/agent/index.md`
- `guide/human/index.md` when compressed guidance is ambiguous or missing nuance
- `templates/APP_BLUEPRINT.md`
- `templates/WORKBOARD.md`
- `skills/jskit-review/SKILL.md` for review passes when your Codex environment supports packaged skills

Core rules:

- Inspect the workspace before assuming a JSKIT app exists.
- Reuse existing JSKIT helpers and runtime seams before adding new local helpers.
- A freshly scaffolded JSKIT app can still be in Stage 1. If platform decisions are not settled yet, continue with the initialize workflow before adding runtime packages.
- Do not treat a missing `config.tenancyMode` line or an untouched minimal scaffold as a final tenancy decision.
- Do not install tenancy-sensitive packages until Stage 1 decisions are complete and the chosen tenancy is written into `config/public.js`.
- Do not implement app features before the blueprint has the database, surfaces, ownership model, and route/screen plan written down.
- For substantial or multi-chunk work, create or update `.jskit/WORKBOARD.md` as the per-request execution tracker.
- Use the compressed guide first for speed; fall back to the human guide when a workflow trap, migration caveat, or architectural boundary needs exact wording.
- Treat generated reference maps and guide copies as vendor reference. Do not edit them manually.
