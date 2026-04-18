# Repository Notes

## Distributed Agent Docs

- The human guide under `docs/guide/` is the source of truth.
- The distributed agent-docs package lives under `packages/agent-docs/`.
- Generated package outputs under these paths are build artifacts:
  - `packages/agent-docs/reference/autogen/`
  - `packages/agent-docs/guide/human/`
  - `packages/agent-docs/guide/agent/`
- Authored workflow files under these paths are edited directly:
  - `packages/agent-docs/DISTR_AGENT.md`
  - `packages/agent-docs/workflow/`
  - `packages/agent-docs/templates/`

When asked to create or refresh distributed agent docs:

1. Preserve exact package ids, commands, APIs, tokens, env vars, filenames, route shapes, and architectural meaning.
2. Keep normal English. Do not invent shorthand languages, lossy abbreviations, or alternate terminology.
3. Do not invent behavior or resolve ambiguity by guessing. If the human guide is unclear, keep the uncertainty explicit.
4. Run `npm run agent-docs:build`.
5. Review generated outputs in `packages/agent-docs/` like any other tracked artifact.
