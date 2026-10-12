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

## Implement before investigating internals

Use the relevant public API contract and one matching example to build the
smallest working slice, then verify its observable result. When the documented
contract answers the task, stop reading and implement it. Do not trace framework
or dependency internals to confirm documented options, routing, package
discovery, transport, or lifecycle behaviour before trying that API.

Implementation source is for a concrete failure or an API question the guide
and example cannot answer. Name that failure or question before investigating,
inspect only the relevant owner, and return to implementation and verification
as soon as it is resolved. Do not tour a dependency tree for confidence. This
applies to all features and dependencies, not only CRUD screens.

## Discover files before reading them

Discover the file, then read it. Do not infer its location from a convention.
Use paths identified in the current tree, installed metadata, or the relevant
example. When inspecting an unfamiliar package, list its files with
`rg --files <observed-package-directory>` and select the relevant paths from
that inventory before reading or searching source. Do not try guessed source
directories. An import subpath is an `exports` alias, not necessarily a physical
path; resolve it through the installed `package.json#exports` or
`import.meta.resolve()` when following an import.

This applies to every package and task, including third-party dependencies.
Use a documented option directly when it already answers the question; source
inspection is a fallback for a concrete unresolved fact.

## Install and compose capabilities

Install selected capabilities together at the exact versions in the matching
pattern example manifests:

```bash
npm install --save-exact @jskit-ai/<selected-package>@<pattern-version> [...]
```

Use installed patterns for existing apps; [upgrade the graph](/guide/app-setup/upgrading-jskit)
before using newer patterns. Never mix individual `@latest` packages with older
runtime pins. Review manifest and lockfile changes.
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
