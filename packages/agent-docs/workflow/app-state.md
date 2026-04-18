# App State Gate

Before planning, scaffolding, or implementing, classify the workspace into one of these states:

- `empty`
- `non_jskit_repo`
- `partial_jskit_app`
- `jskit_app`

Use these markers for a real JSKIT app:

- `package.json`
- `config/public.js`
- `src/main.js`
- `packages/main/package.descriptor.mjs`
- `.jskit/lock.json`

State handling:

- `empty`
  - Start the initialize workflow.
  - Ask only high-level questions first: app goal, tenancy shape, database engine, auth provider, optional assistant/realtime needs.
  - Do not jump straight into detailed feature implementation.
- `non_jskit_repo`
  - Ask whether the JSKIT app should live here or in a new subdirectory.
  - Do not overwrite unrelated project files.
- `partial_jskit_app`
  - Explain which scaffold markers are missing.
  - Recover or finish the scaffold instead of re-initializing from scratch.
- `jskit_app`
  - If this is a fresh minimal scaffold and Stage 1 platform decisions are not settled yet, continue with the initialize workflow first.
  - Otherwise continue with scoping or feature delivery.

This state gate is intentionally strict. The agent must inspect first and only then choose initialize, recover, or extend.
