<!-- Generated from `packages/agent-docs/site/guide/framework/application-operations.md` by `npm run agent-docs:build`. -->

# Application operations

## Initial browser loading

Adopt the foundation's accessible HTML skeleton, inline styles, Reload link and
startup-error message; package updates do not rewrite existing app HTML. Follow
its cold-browser proof at compact, medium and expanded widths: delay JavaScript,
check loading feedback, then release it and check app mount, including production
builds. Compression belongs to hosting, not Genesis.

## Establish a new application

Start with Git and a clear product request. Consult current source and project
docs; ask for missing product decisions before writing source. Do not run a
JSKIT questionnaire or create a temporary scaffold app.

Read the [bundled source pattern index](pattern-index.md). When the optional standalone
JSKIT Agent Skill is installed, its pattern index contains the same
version-matched pattern documents and examples. Do not install a runtime
package only to read its documentation.

For a browser product, inspect one foundation:

- `app/shell-foundation` for the normal adaptive application shell
- `app/minimal-foundation` when the product deliberately does not need that
  shell yet

Inspect the complete pattern before copying. Copy or author the useful files
directly into the existing project. Preserve `.git` plus all unrelated project
and agent context. Resolve every real destination collision explicitly.
Rename the concrete example application in ordinary source and metadata.
Retain the foundation's npm workspace declaration. App-local packages use
their own exact versions in dependency declarations; do not replace them with
`file:` links.

The copied files immediately belong to the application. Do not add pattern
receipts, generator provenance, completion ledgers, or hidden operation state.

## Install and compose capabilities

Plan capabilities using the catalogue and package-owned patterns: required
packages, configuration, resources and APIs. Install one planned dependency
closure of explicitly selected top-level packages in a single npm invocation:

```bash
npm install --save-exact @jskit-ai/<selected-package>@latest [...]
```

Review the resulting `package.json` and lockfile as ordinary source changes.
The installed package graph supplies runtime providers, migrations, patterns,
and public APIs directly; no JSKIT synchronization or mutation command follows
the npm installation.

Do not add auth, users, workspaces, console, sample data, databases, or AI
capabilities unless the product choice requires them.

## Author database-backed CRUD

Use a chosen database pattern plus a package-owned CRUD resource pattern. The
normal order is:

1. confirm the product resource, ownership, operations, and fields
2. author a migration as normal application source
3. author the shared resource contract through `resource-crud-core`
4. use framework APIs for standard repository/service/action/route mechanics
5. author product-specific screens from the relevant UI pattern
6. run migrations and direct verification

The database connection and schema are runtime evidence, not a questionnaire
that owns source generation. Never patch fields into generated ASTs and never
mark a resource valid because a generator once wrote it.

## Verify current state

Run verification against source, package graph, migrations, and runtime
behavior. Runtime startup owns the capability/provider graph, loadability,
ids, environment, and configuration. Builds own client imports; migration
status and disposable rebuilds own schema state. App lint, tests, audit,
browser checks, and CI own security, runtimes, and behavior.

There is no supported `jskit doctor` command. Old CLI authoring-history
warnings do not describe AI-first apps. Diagnose current contracts; never add
metadata to satisfy an old tool.
