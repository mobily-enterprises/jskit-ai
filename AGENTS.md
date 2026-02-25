# AGENTS.md

Monorepo bootstrap router for sessions started in `jskit-ai` root.

## Scope Selection (required first)

1. Identify the target project from the prompt and intended touched paths.
2. Read only the AGENTS file for that target project.
3. Do not read AGENTS/RAILS/checklist files for non-target projects.

## Project Routing

1. If the task is for `jskit-value-app` (or paths under `apps/jskit-value-app/**`), read:
- `apps/jskit-value-app/AGENTS.md`
2. Follow that project file's read order and linked rail/checklist documents.

## Unknown or Mixed Scope

1. If project scope is unclear, ask the user which project to target before loading project rails.
2. If a task truly spans multiple projects, load only those specific projects' AGENTS files (and no others).

