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
- `patterns/INDEX.md`
- `guide/agent/index.md`
- `site/guide/index.md` when compressed guidance is ambiguous or missing nuance
- `templates/APP_BLUEPRINT.md`
- `templates/WORKBOARD.md`
- `skills/jskit-review/SKILL.md` for review passes when your Codex environment supports packaged skills

Core rules:

- Inspect the workspace before assuming a JSKIT app exists.
- Before non-trivial edits, print a short visible checkpoint using this format:
  - `Problem: ...`
  - `Fix: ...`
  - `Why this sticks: ...`
  - `Not doing: ...`
- Keep that checkpoint compact. Do not expand it into a long preamble unless the developer asks for detail.
- When a request involves JSKIT UI, routing, surfaces, CRUDs, placements, live actions, or similar implementation details, scan `patterns/INDEX.md` for matching keywords and read only the relevant pattern files.
- Reuse existing JSKIT helpers and runtime seams before adding new local helpers.
- A freshly scaffolded JSKIT app can still be in Stage 1. If platform decisions are not settled yet, continue with the initialize workflow before adding runtime packages.
- Do not treat a missing `config.tenancyMode` line or an untouched minimal scaffold as a final tenancy decision.
- Do not install tenancy-sensitive packages until Stage 1 decisions are complete and the chosen tenancy is written into `config/public.js`.
- Treat standard JSKIT package-owned workflows as the default baseline once the relevant package stack is chosen. Do not ask the developer to redesign those flows unless they want overrides, restrictions, or custom additions.
- Example: if the app is workspace-capable and uses `workspaces-core` plus `workspaces-web`, assume the standard workspace invite flow is part of the baseline package behavior.
- For baseline package setup, ask plainly for the exact local development values needed for the next install step, but only for the modules or packages that are actually selected.
- Use the real env var names or option names instead of vague requests for "credentials". Values such as `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `AUTH_SUPABASE_URL`, `AUTH_SUPABASE_PUBLISHABLE_KEY`, and `APP_PUBLIC_URL` are routine setup inputs when the relevant package stack needs them.
- Do not implement app features before the blueprint has the database, surfaces, ownership model, and route/screen plan written down.
- For substantial or multi-chunk work, create or update `.jskit/WORKBOARD.md` as the per-request execution tracker.
- Use the compressed guide first for speed; fall back to the human guide when a workflow trap, migration caveat, or architectural boundary needs exact wording.
- Treat generated reference maps and guide copies as vendor reference. Do not edit them manually.
