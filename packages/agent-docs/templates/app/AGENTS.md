# App Agent Instructions

Use current project context, JSKIT public APIs, and the official framework
documentation as the source of truth for application work.

Framework references:

- `https://mobily-enterprises.github.io/jskit-ai/guide/`
- `https://mobily-enterprises.github.io/jskit-ai/patterns/`

Before implementation, read the narrow relevant source pattern completely. If
its owner package is installed, prefer that version-matched package-owned copy.
Do not install an unrelated runtime package only to read documentation.

Before adding or changing browser-test setup, read `patterns/ui-testing.md` in
this package. Routine tests reuse the isolated schema and prepare fixtures once
per suite invocation. Require repeat-start regression proof; do not rebuild the
database or production frontend for each focused browser check.

Pages never start with a page header, title block, welcome heading, or other
standalone heading copy. Start with the useful content and actions. If the user
wants a heading, they will ask for or add one.

Copied pattern source is ordinary application source. Do not add generator
provenance, receipts, completion ledgers, or tooling-operation history. Keep
changes scoped to the user request and verify runtime behavior directly.
