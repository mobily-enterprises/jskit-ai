# Repository Notes

These notes cover working on JSKIT's own repository. How JSKIT applications are
built is in the guide (`packages/agent-docs/site/guide/`): link to it instead of
repeating it here.

## Git, releases and publishing

- Work on a branch (`feat/<topic>` or `fix/<topic>`) and commit there; a
  behaviour fix usually lands as a `Red:` commit (the failing test), then a
  `Green:` commit (the fix). The branch reaches `main` through a merge commit.
  Never force-push, and never rewrite a commit already pushed.
- Release and publish to npm (`npm run release`, `npm run npm-publish`,
  `npm run release:prepare`) only when the person asks. README's Publishing
  section says what each one does.

## Tests

- `npm run verify` is what CI's verify job runs after `npm ci` and the audit:
  lint, the repository checks, every package's tests, then the SQLite run.
  README's Common commands names the database settings data tests need (without
  `TEST_DB_NAME` a data test fails; it never skips), and the PostgreSQL and
  browser runs.
- One package: `npm test -w packages/<name>` runs its `test` script,
  `jskit test`, which runs its files in parallel within the machine's test
  budget ([test files run in parallel](packages/agent-docs/site/guide/framework/typed-features.md#test-files-run-in-parallel)).
- One file: `npx jskit test <file>` in the package's directory.

## Ownership extractions

Moving code from an application or a host into a JSKIT package follows the
Ownership Extractions requirements in public Vibe64's `AGENTS.md`, which owns
them.

## New files

- Create a file only when the task needs it, documented tooling produces it, or
  it is part of an agreed implementation, test or documentation change.
- Before adding a repository-level guardrail file, a persistence file or a
  durable architecture record by hand, confirm the person approved it.

## Distributed agent docs

- The human guide, `packages/agent-docs/site/guide/` (in the VitePress site,
  `packages/agent-docs/site/`), is the source of truth. Under
  `packages/agent-docs/`, edit `site/guide/`, `heuristics/`, `patterns/`,
  `skills/jskit/SKILL.md` and `skills/jskit/agents/` directly.
- `npm run agent-docs:build` writes the rest of what the package ships, the
  paths `scripts/agent-docs-outputs.mjs` declares (`reference/autogen/`,
  `guide/agent/`, `site/patterns/` and `skills/jskit/references/`), and
  `npm run catalog:build` writes `tooling/jskit-catalog/catalog/packages.json`.
  Never edit those by hand: run the build, review its diff like any tracked
  file, and commit it with its source. `npm run generated:check` fails on a
  stale one.
- When writing them, keep exact package ids, commands, APIs, tokens, env vars,
  filenames, route shapes and architectural meaning. Write normal English, with
  no shorthand, lossy abbreviations or new terms. Never invent behaviour or
  settle an ambiguity by guessing: where the guide is unclear, say so.

## Visible change checkpoint

Before a non-trivial edit, print the person one compact line:
`Problem: ... Fix: ... Why this sticks: ... Not doing: ...`. Expand it only
when asked.

## JSKIT patterns

- Server code (a feature, provider, action, service, repository, route, error
  or test) follows `packages/agent-docs/site/guide/framework/typed-features.md`,
  and client code `client-features.md` beside it. `npm run lint` checks their
  rules with `@jskit-ai/config-eslint`, and each finding links its section. A
  new rule goes into its guide and, when a machine can see it, that plugin,
  with a passing and a failing fixture.
- For UI, routing, surfaces, CRUDs, filters, placements, live actions and
  similar work, match the request against the keywords in
  `packages/agent-docs/heuristics/INDEX.md` and read only the files it names.
  A recurring heuristic goes into one of those files, never as a bullet here.
