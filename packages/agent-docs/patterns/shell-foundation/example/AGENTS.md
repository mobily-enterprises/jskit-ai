# App Agent Instructions

Use current project context, JSKIT public APIs, and the installed JSKIT pattern
index as the source of truth for application work.

Recommended references:

- `node_modules/@jskit-ai/agent-docs/guide/agent/index.md`
- `node_modules/@jskit-ai/agent-docs/patterns/INDEX.md`

Before database, schema, CRUD, repository, or persistence work, inspect the
relevant package-owned pattern from
`node_modules/@jskit-ai/agent-docs/reference/autogen/PATTERN_INDEX.md`.

Copied pattern source is ordinary application source. Do not add generator
provenance, receipts, completion ledgers, or tooling-operation history. Keep
changes scoped to the user request and verify runtime behavior directly.
