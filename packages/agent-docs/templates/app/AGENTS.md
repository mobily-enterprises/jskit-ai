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
per suite invocation. Keep `BROWSER_TEST_DB_NAME` distinct from disposable
`TEST_DB_NAME` and prove that disposable cleanup preserves browser migrations.
Require repeat-start regression proof; do not rebuild the
database or production frontend for each focused browser check.

Keep verification output small. Run the relevant cases together, save complete
stdout/stderr to local artifacts, and preserve the exit status. Report counts,
duration, failed case names and artifact paths; read only actionable failure
excerpts. Do not dump full JSON/TAP reports, passing assertions, request logs or
traces into agent context. Wait on the existing run instead of restarting it or
repeatedly printing unchanged output. Keep startup and cleanup errors visible.
For browser evidence, use existing automated cases, targeted locators and
meaningful visual checkpoints. Avoid a full DOM snapshot or screenshot after
every action; retain the required viewport, identity and security checks.

Pages never start with a page header, title block, welcome heading, or other
standalone heading copy. Start with the useful content and actions. If the user
wants a heading, they will ask for or add one.

Copied pattern source is ordinary application source. Do not add generator
provenance, receipts, completion ledgers, or tooling-operation history. Keep
changes scoped to the user request and verify runtime behavior directly.
