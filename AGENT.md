# AGENT.md

This file is intentionally minimal.
It defines read order and precedence only.
All technical rules live in `RAILS.md` and `LLM_CHECKLIST.md`.

## Mandatory read first

- Read root `RAILS.md` and root `LLM_CHECKLIST.md` before making changes.
- Root `RAILS.md` + root `LLM_CHECKLIST.md` are immutable baseline rails/checklists for this repository.
- If touching `apps/jskit-value-app/**`, also read:
  - `apps/jskit-value-app/RAILS.md`
  - `apps/jskit-value-app/LLM_CHECKLIST.md` (when present)
- Precedence order is:
  - user instruction
  - `apps/jskit-value-app/RAILS.md` (for app-local changes)
  - root `RAILS.md`
  - app-local checklist (if present)
  - root `LLM_CHECKLIST.md`
  - `AGENT.md`

## Duplication policy

- Do not add project architecture/pattern rules to `AGENT.md` when they already exist in `RAILS.md`.
- Add or update technical rules in:
  - root `RAILS.md` for baseline rules
  - `apps/jskit-value-app/RAILS.md` for app-local overlays
  - corresponding checklist files for execution gates
