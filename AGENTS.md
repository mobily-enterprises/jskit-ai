# Repository Notes

## Distributed Agent Docs

- The human guide under `packages/agent-docs/site/guide/` is the source of truth.
- The VitePress site root lives under `packages/agent-docs/site/`.
- The distributed agent-docs package lives under `packages/agent-docs/`.
- Generated package outputs under these paths are build artifacts:
  - `packages/agent-docs/reference/autogen/`
  - `packages/agent-docs/guide/agent/`
- Authored workflow files under these paths are edited directly:
  - `packages/agent-docs/DISTR_AGENT.md`
  - `packages/agent-docs/workflow/`
  - `packages/agent-docs/templates/`
  - `packages/agent-docs/site/guide/`
  - `packages/agent-docs/skills/`

## Visible Change Checkpoint

Before non-trivial edits, print a short visible checkpoint for the user in this format:

- `Problem: ...`
- `Fix: ...`
- `Why this sticks: ...`
- `Not doing: ...`

Keep it compact. Do not expand this into a long multi-paragraph preamble unless the user asks for detail.

When asked to create or refresh distributed agent docs:

1. Preserve exact package ids, commands, APIs, tokens, env vars, filenames, route shapes, and architectural meaning.
2. Keep normal English. Do not invent shorthand languages, lossy abbreviations, or alternate terminology.
3. Do not invent behavior or resolve ambiguity by guessing. If the human guide is unclear, keep the uncertainty explicit.
4. Run `npm run agent-docs:build`.
5. Review generated outputs in `packages/agent-docs/` like any other tracked artifact.
