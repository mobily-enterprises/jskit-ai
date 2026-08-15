# The Great Change

## Status

This document defines the next architecture of JSKIT.

It is not a proposal to improve the existing generator experience. It replaces
the generator-centred authoring model with an AI-first framework and pattern
library. The valuable knowledge currently embodied by JSKIT templates will be
preserved, tested, published, indexed, and made directly usable by an agent.
Questionnaires, field-by-field scaffold construction, generated-source
ownership, and generator provenance will not remain the normal way to build an
application.

The migration should be ruthless about obsolete machinery and conservative
about proven software knowledge. Git history remains the recovery mechanism
for deleted implementation.

### Version 0 means no backward compatibility

JSKIT is version 0. This transformation will use that freedom honestly.

There will be:

- no backward-compatibility layer
- no compatibility shims
- no dual old/new authoring paths
- no deprecated generator implementation kept alive behind another command
- no adapter that translates the new pattern model back into generator options
- no runtime branches whose only purpose is to recognize historical scaffold
  provenance
- no promise that an existing app can upgrade without deliberate changes

Existing applications may remain pinned to a published historical JSKIT
version. Applications that adopt the new version will migrate to the new public
contracts directly. Git history and published package versions are the archive;
the current codebase will not become one.

If an old concept has no owner in the new architecture, it is deleted. If a
valuable behaviour exists only inside old code, that behaviour is first moved
to its correct new owner and the old path is then deleted. Nothing remains as a
shim “for now.”

### No receipts. None.

The new architecture has no tooling receipts. This is an absolute design
constraint, not a preference and not a cleanup target for later.

There will be no:

- generator receipts
- install receipts
- source-mutation receipts
- UI receipts
- pattern-copy receipts
- completion ledgers
- replay journals
- transaction journals
- operation histories
- applied-operation tables
- hidden "already handled" flags
- “this tool ran” evidence files
- hidden project state whose purpose is to remember an authoring operation
- replacement of generator provenance with a differently named receipt
- JSON, Markdown, database, cache, metadata, or lock-file representations of
  any of the above

Git-visible source, package manifests, the current dependency graph, migrations,
tests, runtime behaviour, and verification results are the evidence. A tool
must determine current state from current authoritative files and behave
idempotently. It must not require a historical receipt to know whether the
project is valid.

Atomicity must come from ordinary atomic filesystem/database operations and
idempotent reconciliation of authoritative state, not from inventing a second
history of what tooling attempted. If a design appears to require a receipt or
journal, redesign the operation and its ownership instead of adding one.

Renaming a receipt does not make it acceptable. Terms such as evidence,
checkpoint, completion record, applied state, operation metadata, replay data,
tool history, or provenance are equally prohibited when their actual purpose
is to remember that JSKIT tooling performed an authoring operation.

This rule concerns JSKIT authoring and tooling receipts. A product domain may
of course contain a real business concept called a receipt; that record has no
relationship to framework operation bookkeeping.

### Managed-session isolation is a release requirement

The new JSKIT line must support managed editors such as Vibe64 without making
them invent technology-specific adapters or weaken isolation. Two operational
properties are non-negotiable acceptance requirements for this version.

Every development session has exactly one isolated database. A fresh session
database is provisioned before application work begins, receives the complete
installed migration graph, and then receives the application's explicit seed
operation. Seed data is a real application setup contract beyond migrations;
it is not hidden generator behaviour. MySQL and PostgreSQL must both support
this lifecycle. The managed shell owns database allocation, credentials,
lifetime, and injection of the session-specific connection environment. JSKIT
owns dependable migration and seed capabilities that the shell can invoke.
Neither side may silently fall back to a project-shared database.

Files created during a managed session must have correct ownership and modes at
creation time. Process identity, supplementary groups, directory inheritance,
and umask are established at the execution boundary before Git, package tools,
generators, application processes, or agents write anything. Recursive
post-job chmod/chown passes, Git-command permission repairs, and best-effort
cleanup sweeps are forbidden as the normal mechanism. Permission correctness
is an invariant of execution, not a repair phase.

The decisive hosted failure was an `EACCES` from Vite while immediately
rewriting an atomically replaced `src/typed-router.d.ts`. The human writer and
the workspace daemon shared the `vibe64` group and the directory was setgid,
but there was no inherited default ACL. Vite failed before the former
post-command permission repair could run. Therefore a Vibe64-managed source
must be created under group `vibe64`, directory mode `2770`, managed-writer
umask `0007`, and access plus inherited default group ACL `vibe64:rwx`, with no
access for other users. Human actors and the workspace daemon must both belong
to that group. Missing ACL support is a startup failure.

Acceptance must include a real cross-identity proof: a human actor using umask
`0022` creates and atomically replaces a generated file while a daemon watcher
is live, and the daemon rewrites it immediately. A second case crosses Git
checkout/reset and a generated router file. Clone, copy, move, and restore must
preserve the contract before a path becomes visible. A failed preview must
also expose a working fresh-start/retry operation; a dead former process is not
a reason to reject the replacement terminal.

These requirements do not move Vibe64 host policy into JSKIT. JSKIT exposes
portable, explicit application operations; Vibe64 remains the shell that owns
session isolation, host users and groups, credentials, process execution, Git,
preview, and lifecycle.

## The decision

JSKIT started from a sound premise for its time: strong applications can be
created faster when repeated structures are scaffolded consistently. That
premise is still correct. The mechanism is now wrong.

In the older model, JSKIT had to ask a human for every field, option, route,
surface, ownership mode, and output choice because a deterministic generator
could only produce what its questionnaire described. It then interpolated
those answers into a fixed file tree. The generated tree was valuable, but the
authoring system was rigid. It could not understand the product, judge which
parts of a template mattered, make a small contextual variation, or explain
why it chose a pattern.

An AI agent can do those things. It can understand the product conversation,
read the existing application, select a relevant pattern, reuse framework
functions, copy a complete example, adapt a few files, or use an example only
as architectural evidence. Requiring that agent to impersonate a human filling
out a 2023-era generator questionnaire throws away its strongest capability.

JSKIT will therefore become true to its name:

> JSKIT is an AI-first application framework that supplies dependable runtime
> capabilities, strong repetitive patterns, inspectable reference
> implementations, and concrete verification. The agent owns contextual
> composition. The application owns its source immediately.

This is not “AI generates arbitrary code and JSKIT gets out of the way.” It is
the opposite. JSKIT will make the good path easier to see, easier to reuse, and
harder to accidentally violate. It will move repetition into stable functions
where possible, preserve structural knowledge as tested patterns where code
must remain application-owned, and enforce actual contracts through
verification rather than through claims about how a file was generated.

## The four-way ownership rule

Every existing generator behaviour, template, option, check, and piece of
documentation will be classified using this rule.

### Stable repeated behaviour belongs in framework code

If many applications need the same operational behaviour, it should be a
function, component, composable, provider, service factory, validator, or
runtime capability.

Examples include:

- request execution, retries, CSRF and structured error handling
- command state and duplicate-submit protection
- authenticated and workspace-aware policy enforcement
- resource validation and CRUD operation definitions
- repository mapping and ownership filtering
- standard list, view, add/edit, and delete behaviour
- loading, empty, error, success, and permission states
- route and placement resolution
- responsive shell behaviour
- realtime invalidation
- database and migration runtime behaviour
- browser-test helpers that operate through accessible public contracts

The more of a template that can become a stable public framework seam, the
smaller and clearer the application-owned example becomes.

### Variable application structure belongs in patterns

If an application must own the code but a known arrangement is repeatedly
useful, it becomes a pattern asset.

Examples include:

- a complete base web application
- a local-account application
- an owner-scoped CRUD resource
- a public catalogue and an authenticated catalogue
- a substantial non-CRUD server package
- nested resources
- a settings section
- compact/medium/expanded list screens
- a Material 3 add/edit form
- a placement-backed navigation page
- a package-owned migration
- a browser test for registration and resource isolation

Patterns are real, readable source files accompanied by concise instructions.
They are not generator implementation details and they do not own the copied
application source.

### Product decisions belong to the user and the agent

Product purpose, entities, fields, relationships, access, tenancy, navigation,
and domain language must be determined from the product conversation and
existing code. The developer's chosen project workflow may preserve that
conversation, but JSKIT does not require or implement one.

JSKIT must not conduct a second product questionnaire. It may explain a
technical consequence or report an unresolved invariant, but it must not ask a
wizard's sequence of questions merely because a template once had options.

### Correctness belongs in verification

An application should be accepted because it satisfies public contracts, not
because a generator wrote it or because it contains a provenance marker.

Verification will check observable and structural invariants such as:

- package and capability closure
- valid provider composition
- resource and action contracts
- migration integrity
- ownership and permission enforcement
- route and placement validity
- accessible shell behaviour
- Material interaction and state rules
- compact, medium, and expanded layout behaviour
- rebuildability from a fresh database
- focused and broad tests

It will not require application code to retain magic CSS classes, generated
headers, generator ids, or historical file shapes unless those are genuine
public runtime contracts.

## What JSKIT will be

JSKIT will provide five cohesive things.

### A framework library

The existing runtime packages remain the centre of the system. Packages such
as the kernel, HTTP runtime, HTTP web layer, shell, auth, users, database,
resources, CRUD, realtime, storage, uploads, and mobile integrations provide
real executable behaviour.

Their public APIs will be made easier for agents to discover and use. Repeated
source currently emitted by generators will be reviewed for promotion into
framework functions. Application examples should become thinner over time,
not because the framework hides product logic, but because it owns genuinely
generic mechanics once.

### A versioned pattern library

Every worthwhile template will survive as a pattern or as part of a pattern.
A pattern is a published, versioned, tested reference implementation owned by
the package that owns the relevant framework contract.

Patterns may be used in four ways:

1. **Use directly.** Copy the complete example when it matches the product.
2. **Adapt narrowly.** Copy it and change names, fields, routes, copy, or a
   documented variation point.
3. **Compose.** Use compatible patterns together, resolving their application
   boundaries deliberately.
4. **Use as evidence.** Read the pattern to understand the framework and write
   a substantially different implementation through the same public APIs.

No mode creates permanent generator ownership. Once copied, source is ordinary
application source.

### An agent-facing catalogue

The current package catalogue will grow an index of pattern assets and public
framework capabilities. An agent must be able to find the narrow relevant
material without reading all JSKIT documentation or reverse-engineering
package source.

The default discovery surface will remain human-readable and concise. It may be
an installed skill plus ordinary package paths rather than a CLI. Optional
structured output may exist for tools, but the source pattern documentation
will be normal Markdown and the source assets will be normal files.

The intended discovery flow is conceptually:

```text
jskit patterns list --search "authenticated owner-scoped crud"
jskit patterns show crud/owner-scoped-resource
jskit patterns files crud/owner-scoped-resource
```

Those examples describe required operations, not a commitment to retain the
`jskit` executable. An installed skill, small library, or direct package file
contract may provide the same discovery more simply.

An optional exact-copy primitive may be provided:

```text
jskit patterns copy app/base-shell --to .
```

That command, if retained, is deliberately mechanical. It copies a coherent
example, checks collisions, and reports files. It does not ask questions,
interpolate a field DSL, decide product behaviour, or attach provenance. The
agent edits normal files after copying them. This is not a renamed generator.

### Focused AI guidance

The installed JSKIT skill will route agents to the smallest useful pattern and
API reference. It will not require reading several enormous operational
documents before an ordinary change.

Guidance will be progressive:

- a short orientation explaining framework ownership
- task-indexed pattern discovery
- pattern-local invariants and variation points
- API references only for the functions actually used
- verification guidance proportional to the change
- deeper troubleshooting material only after a concrete failure

The current repository already has useful beginnings in
`packages/agent-docs/patterns/`. Those files will become the conceptual index
around tested source patterns rather than a companion to generator command
lanes.

### Concrete verification and diagnosis

`jskit doctor`, package linting, migration checks, CI projection, application
verification, and browser helpers remain valuable. They will be simplified
around current framework contracts.

Diagnostics must say what is wrong and what public contract is relevant. They
must not tell an agent to rerun a generator simply because the old generator
was once the only supported authoring path.

## What will go

The following concepts will be removed from the target architecture.

### Interactive application creation

`create-app --interactive`, its readline questionnaire, and its Stage 1
question flow will go. Product discovery belongs in an ordinary AI
conversation.

The `ai-seed` template will go. A temporary `AGENTS.md` whose job is to ask
questions and later overwrite itself is no longer the application foundation.
The agent works from the user's request and the project's ordinary product
context.

### Product scaffolding generators

The target architecture has no `ui-generator`, `crud-ui-generator`,
`crud-server-generator`, or `feature-server-generator` as application
authorities.

Their valuable output will be extracted into patterns and their repeated
runtime mechanics will be promoted into framework functions. Their command
handlers, template-context builders, option interpolation, subcommands,
completion rules, overwrite paths, AST field patchers, and questionnaire
metadata will then be deleted.

In particular, the following model will go:

- select a generator
- answer `promptLabel`/`promptHint` questions
- define or select fields through generator options
- introspect a live table as the only supported source-authoring lane
- emit a fixed source tree
- patch one additional field through an AST subcommand
- remember that the tree came from a generator
- require future work to preserve generator assumptions

The product schema will be authored as normal migrations and resource
contracts. Read-only database inspection may remain useful for understanding
or adopting an existing database, but it will not be the compulsory authoring
authority.

### Generated application ownership

Generated source headers, provenance such as `crud-server-generator`, scaffold
shape declarations, and health checks that accept code only when it came from
a named generator will go.

Table ownership, resource ownership, permissions, and package ownership are
real concepts and will remain. They will be declared by the application and
verified directly. Their legitimacy will not depend on the tool that first
wrote the file.

### Magic recognition markers

Tests and framework tools must not require arbitrary presentation markers such
as `.generated-ui-screen` merely to recognize a valid application page. Where
a cross-package contract is necessary, it must be semantic, public, and
documented—for example an accessible landmark, a component API, a placement,
or an explicit test id owned by the shell.

### JSKIT-owned product memory

`.jskit/APP_BLUEPRINT.md`, `.jskit/WORKBOARD.md`, and equivalent attempts to
make JSKIT remember product intent will go from the normal model. Applications
use their ordinary project documentation or whichever external project system
the developer has selected.

The `.jskit` directory must not become a second project brain. If a JSKIT tool
needs derived local state, it should be disposable, clearly generated, and
minimal. Prefer conventional source files and package metadata whenever
possible.

### Installation ambiguity

`jskit add package` must not silently add only a top-level dependency when the
requested capability requires a managed framework closure. It will either:

- resolve and apply the complete supported package/capability closure; or
- fail with a concise explanation of the missing explicit decision.

It will not leave the agent to infer success from silence and discover later
that routes, providers, migrations, or companion packages were never composed.

## Pattern asset contract

Patterns will live near their owning framework package so code, guidance, and
tests evolve together. Existing `templates/` trees should be moved with Git
history where practical rather than copied and abandoned.

A pattern directory will have a small, readable shape similar to:

```text
packages/crud-core/patterns/owner-scoped-resource/
  PATTERN.md
  example/
    packages/books/package.json
    packages/books/src/shared/bookResource.js
    packages/books/src/server/BooksProvider.js
    packages/books/src/server/actions.js
    packages/books/src/server/service.js
    packages/books/src/server/repository.js
    packages/books/src/server/registerRoutes.js
    migrations/...
  tests/
    contract.test.js
```

`PATTERN.md` is the primary agent-facing contract. It will contain:

- a stable pattern id and title
- search keywords
- when to use it
- when not to use it
- required JSKIT packages and capabilities
- product decisions that must already be known
- invariants that must not be changed accidentally
- the framework APIs demonstrated
- the files in the example
- documented variation points
- composition notes
- focused verification
- common mistakes and prohibited workarounds

Metadata should remain minimal and readable. A short Markdown front matter
block may carry stable ids, keywords, requirements, and compatibility data for
the catalogue. The design must not grow into another option language or field
questionnaire.

Examples will use coherent concrete domain names rather than forests of
template placeholders. An agent can understand and rename `books`, `contacts`,
or `booking-engine`. Exact mechanical copying may preserve those names first;
the agent then makes ordinary reviewed edits. We will not rebuild a semantic
interpolation engine inside the pattern catalogue.

Each published package that owns patterns must include them in its npm files
and advertise them through the catalogue. Pattern ids are versioned with the
owning package. A breaking public pattern/API change follows normal package
versioning.

## The initial pattern catalogue

The first migration will preserve and reorganize at least these assets.

### Application foundations

From `tooling/create-app/templates/`:

- base web application with shell, server, Vite, placements, settings,
  verification, and browser-test configuration
- minimal application foundation
- conventional package layout
- server entry and surface configuration
- CI and migration projection setup

The AI seed questionnaire is not preserved as a pattern. Its useful product
questions belong in the ordinary agent conversation.

The base application pattern must be safely usable inside an existing
repository. It must refuse actual file collisions while leaving `.git` and all
unrelated project and agent context intact. The temporary-directory
scaffold-and-copy manoeuvre observed in the book-catalogue trial must become
unnecessary.

### Shell and navigation

From `packages/shell-web/templates/` and its public APIs:

- application shell
- responsive navigation
- route surfaces
- settings section
- placements and topology
- menu and tab links
- compact drawer behaviour
- standard shell browser tests

The adaptive browser helper will use accessible controls. In particular, it
must close a compact drawer through the public “Close navigation menu” control,
not by clicking a Vuetify scrim at a coordinate that the open drawer can
intercept.

### Authentication and accounts

From auth/users package templates:

- local authentication
- database-backed local authentication
- login and registration
- account settings
- authenticated route surfaces
- current-user/profile projection
- password and session flows
- test patterns for registration and authenticated requests

The package graph for a supported account setup will be explicit and complete.
An agent should be able to discover one authoritative pattern and add the
required package closure in one planned operation.

### CRUD server resources

From `crud-server-generator` templates and `crud-core` APIs:

- resource contract
- provider
- actions
- service
- repository
- routes
- input and output validators
- ownership filtering
- role/permission integration
- baseline and additive migrations
- positive and negative isolation tests

The pattern should demonstrate how little application code is needed when the
framework APIs are strong. If providers, actions, services, and repositories
contain identical mechanics across examples, those mechanics should first move
into framework factories.

The agent will author the schema intentionally. JSKIT may inspect an existing
database, compare migrations with a live development schema, and verify
rebuildability, but normal creation will not require manually creating a live
table solely so a generator can read it back and write source.

### CRUD user interfaces

From `crud-ui-generator` templates and shared screen composables/components:

- list screen
- compact cards and wider tables
- list filters and search
- view screen
- add/edit screen
- field rendering and serialization
- deletion with confirmation
- row and bulk actions
- loading, empty, error, permission, and success states
- nested/detail resource examples

The application page should normally be a slim call to a high-level composable
plus a clear template. Boilerplate that can disappear into a stable component
or composable will disappear.

### General UI and placements

From `ui-generator` templates:

- route page
- placed component
- placed link
- subpage host
- outlet
- topology mapping
- settings page

The agent chooses paths and placements from product intent and the existing
application. There is no prompt schema for display labels, targets, navigation
roles, and every possible interpolation. Pattern documentation explains the
decisions and public APIs.

### Non-CRUD server features

From `feature-server-generator` templates:

- persistent JSON REST feature
- orchestration-only feature
- explicit custom persistence exception
- provider/service/repository/action/route boundaries

The current generator's most valuable contribution is its ownership guidance:
providers compose, services orchestrate, repositories persist, and the main
package remains glue. Those remain semantic boundaries, but they will no longer
be mandatory files or pass-through layers. They become progressive pattern
guidance and framework APIs, not a file-writing command.

### Server architecture: semantic layers, not ceremonial files

JSKIT's action architecture is more important in an AI-first framework, not
less. Actions are the canonical application API used by HTTP, the UI,
assistants, automation, internal callers, and tests. An agent should be able to
inspect one action and understand its identifier, input, output, access,
idempotency, transactional expectations, and implementation.

The existing Laravel-like separation remains available when a domain earns it,
but JSKIT will not require a controller, service, repository, action file,
schema file, route file, and provider for every operation. Every repeated
declaration is another opportunity for an agent or person to update five of six
locations and leave the product inconsistent.

The new default is:

- an action is a first-class use case and the single public operation contract
- ordinary HTTP exposure is projected from that action rather than duplicated
  in an app-owned controller
- assistants discover and invoke the same action rather than a parallel tool
  implementation
- a service is introduced when product orchestration or shared domain policy
  exists, not as an automatic pass-through
- a repository is introduced for meaningful persistence boundaries, complex
  queries, aggregates, or external stores, not for conventional resource CRUD
- providers remain the runtime composition mechanism, but app-owned features
  use a small framework feature declaration instead of hand-writing provider
  lifecycle mechanics
- authentication, permissions, transactions, audit, observability,
  idempotency, HTTP exposure, and assistant exposure are stated once and
  projected consistently
- code is grouped by bounded product feature; technical subdirectories appear
  inside a feature only as it grows

A simple feature may therefore be one action plus one feature declaration. A
complex feature may grow services, repositories, domain objects, events, and
custom transports without switching architectural models. JSKIT provides a
progressive architecture rather than enforcing a folder diagram.

This preserves the most successful part of the original architecture: the
assistant can enumerate and execute real product operations. It removes the
least successful part: synchronized boilerplate whose only purpose is to prove
that every named layer exists.

### No general service locator or container tokens

The version-0 server model will not expose a general dependency container to
application or feature code. String, symbol, function, class, and object tokens
all preserve the same underlying problem: code can request an arbitrary hidden
dependency whose producer is not visible from its imports or parameters.

JSKIT still needs stable string identifiers for public architecture:

- installed-package capabilities
- providers
- actions
- events
- routes
- surfaces and placements

Those are identifiers, not service-locator tokens. They are intentionally
searchable, serializable, and readable in diagnostics.

Installed providers declare their required capabilities as a map from a local,
meaningful parameter name to a stable capability id. The runtime resolves that
map once and calls the provider with a plain dependency object. A provider may
return the capabilities it owns. Feature code then uses normal imports,
closures, constructor arguments, and factory arguments; it cannot call
`make()`, `has()`, or another generic lookup method.

For example, the conceptual boundary is:

```js
const BooksProvider = defineProvider({
  id: "books",
  requires: {
    actions: "runtime.actions",
    database: "runtime.database",
    http: "runtime.http"
  },
  setup({ actions, database, http }) {
    const books = createBooksFeature({ actions, database, http });
    return { books };
  }
});
```

The exact API may become smaller while it is implemented, but the invariant is
fixed: dependency lookup occurs at the composition boundary and dependencies
arrive in product code as ordinary named values.

Multi-contributor behavior uses purpose-built registries instead of tagged
container bindings. Actions, events, bootstrap contributors, authorization
backends, placement contributors, and realtime listeners each expose the
smallest explicit registration API their domain requires. Request-scoped data
travels through the explicit action or request context rather than a child
container.

The old container may be used only as temporary migration scaffolding inside
the worktree. It is not part of the completed architecture, public API,
patterns, or documentation.

### Other package templates

Templates currently owned by assistant, console, database, mobile, storage,
uploads, workspaces, rewards, and other packages will be audited individually.
Each asset will become one of:

- framework runtime code
- a published pattern
- a deterministic package projection such as a package migration
- a test fixture
- deleted obsolete scaffolding

No valuable template will be deleted before its knowledge has an identified
owner and passing tests in the new model.

## Application creation after the change

An agent-first creation flow will look like this:

1. `git init` establishes an ordinary project.
2. The opening conversation establishes product intent and explicit technology
   decisions.
3. The agent loads the JSKIT skill and relevant pattern catalogue entries.
4. The agent inspects the application-foundation pattern and copies or authors
   the small initial substrate directly into the existing repository.
5. The agent edits normal source to reflect the product and selected runtime.
6. It declares the required JSKIT package/capability closure in one batch.
7. Workspace setup installs dependencies once after the coherent package graph
   exists.
8. The agent authors migrations and resource contracts, reusing framework APIs
   and relevant patterns.
9. It runs focused verification while implementing and broad verification at
   the appropriate boundary.
10. The agent reconciles project explanations and runs a bounded Deslop pass.

The process is independent of any editor or agent host. A developer may supply
their own environment, database, Git, preview, browser, and project workflow,
or use a managed environment that supplies them.

## Package and installation model

Runtime packages and authoring patterns are separate concepts even when one
npm package owns both.

The current `jskit add package` command represents a deterministic
package-composition operation, not a product generator. Its underlying
capability may remain, but the command itself is not guaranteed to survive. A
replacement library, package script, or npm-native contract may:

- resolve exact package dependencies and capabilities
- update application package dependencies
- add provider/runtime declarations
- install invariant package-owned files
- expose package-owned migrations for synchronization
- report environment requirements
- report conflicts before writing

It must not:

- conduct a product questionnaire
- generate a product entity from fields
- produce pages, services, repositories, or routes whose shape depends on
  interactive product answers
- claim permanent ownership of copied application source
- silently stop after installing only a dependency when the requested
  capability is incomplete

The final composition seam will support applying multiple packages in one
transaction. The agent should be able to establish a planned closure and then
run one dependency installation. Repeated `npm install` calls between every
package operation are a migration target, not the desired workflow.

Package-owned deterministic projections may remain where they have a single
clear owner and are intentionally regenerated in full. Examples include the
standard CI workflow and immutable package migration projections. These are
not product scaffolding: they are replaceable operational output with explicit
source authority.

## Database and resource authoring

The database workflow will be rewritten around authored intent rather than
generator interrogation.

The agent will:

- determine entities and relationships from the Blueprint and product
  conversation
- ask only about genuinely material ambiguity, such as whether a reading
  status is free text or a fixed vocabulary
- write normal source-controlled migrations
- write or adapt a normal resource contract
- use framework functions for standard CRUD behaviour
- declare ownership and permissions explicitly
- verify a complete rebuild in a fresh disposable database
- test positive and negative ownership cases

JSKIT will provide:

- database runtimes and drivers
- migration execution and synchronization where package projections exist
- resource and schema validators
- standard CRUD service/repository factories
- ownership and row-policy primitives
- serialization and persistence mapping
- read-only schema inspection and comparison
- migration and live-schema diagnostics

Framework-selected technical constants belong to the relevant technology
contract. For example, MySQL's `DB_CLIENT=mysql2` and PostgreSQL's
`DB_CLIENT=pg` must not become product questions. JSKIT runtime requirements
will carry those values consistently.

## Material 3 and UI quality

Material guidance will be both a creation contract and a Deslop contract.
Agents should not have to rediscover the same UI corrections after every
scaffold.

Standard JSKIT patterns and components will enforce or demonstrate:

- skeletons for meaningful loading states, not spinning progress indicators
- stable button labels while commands run
- transient command and server errors through the standard toast/snackbar
  channel, not large in-page banners that move content
- inline errors only when the error belongs to a field or persistent page
  state and must remain in context
- minimum 48px interactive targets
- compact-first layout
- responsive cards/tables appropriate to each width
- no horizontal overflow
- accessible names and controls
- computed sources of truth where possible
- synchronous hydration or immediate watchers for cached resource, prop, and
  route state
- URL persistence for user-selected filters and screen context that must
  survive navigation
- warm-cache, back/forward, empty, failure, retry, and permission tests

The book-catalogue trial proved these rules are not cosmetic. The Deslop pass
found generated loading-button spinners and 44px “large” buttons. Those defects
belong upstream in JSKIT's components and patterns so future applications are
correct before cleanup.

## Prompts and agent guidance

The JSKIT skill will be rewritten around outcomes and public seams.

For a common task such as “create an authenticated MySQL catalogue,” it should
route the agent to one short recipe that identifies:

- the application-foundation pattern
- the local-account pattern
- the MySQL package/capability closure
- the owner-scoped resource pattern
- the CRUD UI pattern
- the exact framework functions involved
- the focused verification contract

It should not make the agent read four large references, inspect generator
source, query several package details, and infer the correct command ordering.

Guidance will explicitly distinguish lifecycle phases:

- **Opening:** understand the product and select Stack; do not verify an app
  that does not exist.
- **Realization:** establish the application substrate from patterns and
  framework requirements.
- **Workspace setup:** install dependencies or other declared prerequisites
  after source exists.
- **Implementation:** compose framework functions and adapt application-owned
  patterns.
- **Verification:** run focused checks, then the declared broad checks once the
  substrate is ready.
- **Explanation:** reconcile Blueprint and Program.
- **Deslop:** make a bounded, behaviour-preserving cleanup pass.

Automatic agent continuation turns must make their phase visible. A user
should be able to see that implementation is complete and that Program or
Deslop work is continuing. Expensive verification should reuse trustworthy
evidence from the implementation turn and rerun only checks made necessary by
cleanup changes.

## The CLI is not assumed to survive

The JSKIT CLI must become as slim as possible. We will explicitly consider not
having a general JSKIT CLI at all.

Every command must answer a hard question: why does this need an imperative
JSKIT command rather than one of these simpler owners?

- an ordinary framework API
- normal npm package dependencies
- a package script
- a readable pattern file
- an agent skill
- a standard migration runner
- a build/test tool's native configuration
- a deterministic library function called by the application

If there is no strong answer, the command is deleted.

Pattern discovery does not automatically justify a CLI. Installed skills and
the package catalogue may expose pattern locations directly. An agent can read
and copy normal files. Package composition does not automatically justify a
CLI if correct npm dependencies and small configuration APIs can express it.
Doctor does not automatically justify a CLI if it can be a library invoked by
`npm run verify`. Migration and CI behaviour do not automatically justify a
CLI if their real owners can expose ordinary scripts or configuration.

The preferred target is therefore:

1. no general-purpose `jskit` executable; or
2. only a tiny, non-interactive executable containing operations that cannot
   be expressed more simply and whose implementation is mostly calls into
   independently usable libraries.

There will not be a large command framework, completion engine, interactive
runtime, or metadata interpreter merely to preserve familiar command names.

The following command families will be retired unconditionally:

- interactive create-app
- generator execution
- generator option interpolation
- generator prompt rendering
- generator-specific completion logic
- generator field-patching subcommands
- generator provenance repair
- health messages whose only solution is rerunning a generator

Any surviving command output must be short enough for an agent to use without
flooding the context window. A surviving inspection operation must return the
exact public contract and relevant pattern references, not an enormous dump of
every package metadata field. Structured output is optional and does not
justify keeping the CLI by itself.

## Verification after the change

Verification will be stricter about behaviour and looser about irrelevant file
origin.

It will verify:

- dependency and capability closure
- supported runtime versions
- provider and token composition
- required environment inputs without exposing values
- resource and operation validity
- ownership and access rules
- route and placement contracts
- migration ids, order, immutability, and rebuildability
- package boundaries
- standard UI state and accessibility contracts
- responsive shell behaviour through accessible controls
- framework API compatibility
- pattern asset integrity
- example compilation and tests

It will not verify:

- that product code was written by a generator
- that a resource carries obsolete generator provenance
- that a screen contains a magic “generated” class
- that customized application files still match a historical template byte for
  byte
- that an application retains JSKIT-owned product planning files

Every pattern will have a direct contract test. Important pattern compositions
will be assembled into representative fixture applications and verified under
the supported runtimes. Templates will no longer be valuable but unexecuted
text that can silently drift from framework APIs.

## Repository changes

The current repository gives us a concrete removal and migration map.

### `tooling/create-app`

- extract `base-shell` and `minimal-shell` into application patterns
- delete `ai-seed`
- delete interactive readline collection
- remove product/tenancy/auth questionnaires from application creation
- retain only a mechanical pattern-copy seam if it proves useful
- allow a pattern to be copied safely into an existing repository
- remove create-app-specific setup command narration once pattern guidance owns
  it
- eventually retire the `@jskit-ai/create-app` package

### `packages/ui-generator`

- move page, placed-element, subpages, outlet, and topology examples into
  shell/UI patterns
- promote repeated placement operations into public placement helpers where
  needed
- delete template context and subcommand machinery
- delete generator option and prompt metadata
- retire the package

### `packages/crud-server-generator`

- preserve provider/action/service/repository/route/resource/migration examples
  as CRUD patterns
- extract repeated behaviour into `crud-core`, `resource-core`, database, auth,
  and HTTP APIs
- replace live-table-first authoring with normal migration/resource authoring
- retain schema inspection only as an inspection/adoption/verification tool
- delete scaffold and scaffold-field AST patching
- remove generator provenance from Doctor and table ownership rules
- retire the package

### `packages/crud-ui-generator`

- preserve list/view/add/edit/filter/action templates as CRUD UI patterns
- strengthen shared screen components and composables so examples stay slim
- move Material rules into those components and patterns
- delete field-questionnaire and template-context machinery
- delete generator subcommands and overwrite semantics
- retire the package

### `packages/feature-server-generator`

- preserve persistent, orchestrator, and explicit custom-persistence examples
- retain its provider/service/repository ownership guidance
- promote repeated feature wiring into public framework factories where useful
- delete mode questionnaire and scaffold machinery
- retire the package

### `tooling/jskit-cli`

- move independently valuable logic such as validation into normal libraries
- prove whether pattern discovery needs any command at all
- prove whether package composition needs any command at all
- prove whether Doctor, migration projection, CI projection, and app
  maintenance need commands or only package scripts/library APIs
- if a tiny executable remains, make it non-interactive and a thin caller of
  those libraries
- remove generator catalog, dispatch, interpolation, completion, and repair
- remove generator-origin health rules
- delete shell completion and the general command framework if the remaining
  surface does not justify them
- delete the `@jskit-ai/jskit-cli` package entirely if all remaining operations
  have clearer owners

### `tooling/jskit-catalog`

- index patterns as well as packages
- publish stable ids, keywords, owning packages, requirements, and compatible
  framework versions
- keep full pattern prose and files in owning packages rather than embedding
  large template bodies into one JSON catalogue
- provide deterministic catalogue validation

### `packages/agent-docs`

- rewrite the JSKIT skill around patterns and public APIs
- replace generator command recipes with outcome-based pattern routes
- make Material 3 creation/deslop rules part of the relevant UI patterns
- delete `.jskit/APP_BLUEPRINT.md` and generator-workboard guidance
- preserve deep troubleshooting as progressive references
- build and test distributed docs from the new source of truth

### Runtime packages

- inventory generator templates for repeated mechanics
- move stable mechanics into framework APIs
- co-locate and publish relevant patterns
- add focused API and pattern contract tests
- remove generator dependencies and generator-shaped metadata
- change runtime APIs directly where the new architecture benefits, without
  compatibility branches or shims

## External integration boundary

JSKIT owns JavaScript/Vue runtime APIs, capability closure, package-owned
patterns, framework guidance, environment requirements, migrations, routes,
actions, resources, auth, shell, placements, UI primitives, and verification.

JSKIT does not own the editor, agent host, project-memory model, conversation
UI, Git credentials, preview proxy, browser installation, or deployment host.
External systems may consume JSKIT's public package metadata and pattern assets,
but JSKIT does not depend on, name, detect, or special-case those systems.

## Migration sequence

The migration will be implemented in deliberate stages. The old system will
not be deleted before the knowledge it contains is secured, but the final
architecture will not preserve dual authoring paths indefinitely.

### Phase 1: Inventory and freeze the knowledge

- enumerate every template root and generator output
- map each file to runtime API, pattern, deterministic projection, fixture, or
  deletion
- identify repeated mechanics that should become framework functions
- record current generator tests that prove valuable behaviour
- stop adding new generator features except fixes required to complete the
  migration safely

Exit condition: every valuable template and invariant has a named future
owner.

### Phase 2: Establish the pattern contract

- implement the pattern directory and `PATTERN.md` contract
- add package-side validation
- extend the catalogue
- expose discovery directly through installed agent guidance and package assets
- add a small library or optional collision-safe exact-copy primitive only if
  direct agent file use proves insufficient
- test npm packaging of pattern files

Exit condition: an installed JSKIT package can publish, list, show, and test a
pattern without generator machinery.

### Phase 3: Migrate application foundations

- move base-shell and minimal-shell to patterns
- make the foundation safe inside an existing repository
- remove the AI seed questionnaire
- replace create-app guidance with agent-oriented realization guidance
- verify a blank Git repository can become a runnable JSKIT app without a
  temporary directory

Exit condition: the book-catalogue substrate can be created cleanly in place.

### Phase 4: Migrate common capability compositions

- define authoritative local-auth/account patterns
- define MySQL and PostgreSQL application patterns
- make package closure application deterministic and explicit
- support batched package composition
- ensure environment defaults such as database clients come from technology
  ownership rather than user questions

Exit condition: an agent can establish auth plus either supported database in
one planned composition without silent partial success.

### Phase 5: Migrate CRUD server authoring

- extract owner-scoped and workspace-scoped resource patterns
- strengthen resource/service/repository factories
- establish normal migration-first authoring
- preserve introspection for adoption and verification
- rewrite table ownership checks around declarations and contracts
- remove generator provenance requirements

Exit condition: an agent can create a rebuildable, isolated CRUD resource
without `crud-server-generator` or a live-table questionnaire loop.

### Phase 6: Migrate CRUD and general UI authoring

- extract list/view/add-edit/delete/filter/action patterns
- extract page, placement, subpage, and outlet patterns
- strengthen high-level UI composables and components
- make Material rules correct by default
- fix accessible adaptive-shell browser helpers
- delete magic generated-screen recognition

Exit condition: an agent can build compact-first Material UI through public
seams without either UI generator.

### Phase 7: Migrate non-CRUD feature authoring

- extract the three feature-server modes into patterns
- make actions the canonical application operation contract
- add a small feature declaration that owns normal provider composition
- project ordinary HTTP and assistant exposure from action contracts
- make service and repository layers progressive rather than mandatory
- strengthen service/repository composition APIs for domains that need them
- retain explicit approval for unusual persistence, without a JSKIT workboard
- remove feature generator machinery

Exit condition: a simple app-local feature needs no ceremonial layers; a
substantial feature can add explicit services and repositories through a clear
AI-first pattern; neither depends on a generator.

### Phase 7a: Remove the general dependency container

- define the provider capability input/output contract
- pass environment, logging, HTTP, actions, database, storage, and other
  framework services as named dependencies at provider setup
- make action dependencies ordinary captured values rather than token lookups
- replace tagged bindings with purpose-built contributor registries
- pass request-scoped state through explicit request and action contexts
- migrate server packages, then client providers, away from
  `bind`/`singleton`/`service`/`make`/`has`/`tag`/`resolveTag`
- delete container token support, container scopes, and service-registration
  compatibility machinery

Exit condition: supported product and package code contains no container token
and no general service-locator call. Stable architecture identifiers remain
plain strings at the installed-package and public-contract boundaries.

### Phase 8: Rewrite guidance and verification

- rewrite the installed JSKIT skill
- replace command-order archaeology with task-indexed pattern routes
- reduce default CLI output
- make Doctor diagnostics origin-neutral
- update human documentation
- rebuild distributed agent docs
- update pattern, package, application, and browser verification
- extract verification logic from CLI command handlers into independently
  usable libraries

Exit condition: an agent can find the correct narrow material without reading
generator internals or several full manuals.

### Phase 9: Delete the old authoring system

- remove interactive create-app
- remove generator command dispatch
- remove option prompt metadata and interpolation
- remove generator AST patchers
- remove generator completion and help machinery
- remove generator provenance and repair rules
- retire generator npm packages
- remove the general CLI and its completion/dispatch infrastructure unless a
  separately justified minimal executable remains
- delete obsolete tests and docs
- remove obsolete `.jskit` product-memory concepts
- regenerate catalogue, docs, package locks, and release manifests

Exit condition: there is one supported AI-first authoring model, not a new model
plus a permanent legacy system.

### Phase 10: Prove the great change

Build representative applications from empty Git repositories using the JSKIT
skill and published/local JSKIT packages:

- account-based MySQL book catalogue
- equivalent PostgreSQL application
- public no-auth application
- workspace-owned CRUD application
- non-CRUD orchestration feature
- imported/existing JSKIT application changed through patterns

For each proof:

- establish product intent and technology decisions conversationally
- create substrate in place
- install dependencies through declared setup
- use patterns and framework APIs without generators
- rebuild databases from zero where applicable
- verify access isolation
- verify compact, medium, and expanded UI
- verify no spinner/loading/banner regressions
- verify launch through ordinary application commands
- reconcile project explanations and complete a bounded Deslop pass

Exit condition: the new path is demonstrably simpler, more reliable, and more
adaptable than the generator path.

## Existing applications and old releases

Existing generated application source is ordinary application source, but the
new JSKIT release does not promise backward compatibility with its old runtime,
metadata, tooling, or package contracts.

An existing application has two honest choices:

- remain pinned to its historical JSKIT versions; or
- perform an explicit migration to the new framework APIs and pattern model.

The current repository will not carry a compatibility reader, old manifest
translator, generator facade, deprecated command alias, provenance converter,
or mixed-version runtime to make that migration appear automatic.

Old generator packages may receive a narrowly scoped correctness fix on their
historical release line when an existing application is genuinely blocked, as
has already been necessary. That fix must also be applied to the current code
where relevant. It does not create a compatibility obligation in the new
architecture.

Once the replacement owner exists, old generator packages and code are removed
immediately rather than entering a long deprecation period.

## Acceptance criteria

The transformation is complete only when all of the following are true.

- A new application can be created inside an initialized Git repository
  without a temporary scaffold directory or force-overwrite workflow.
- Product questions are asked by the agent, not a JSKIT wizard.
- The normal creation path invokes no application generator.
- The JSKIT catalogue exposes tested patterns and their framework requirements.
- An agent can inspect a relevant pattern without loading unrelated manuals.
- Templates can be copied exactly, adapted, composed, or used as evidence.
- Copied source has no permanent generator ownership.
- No backward-compatibility code or shim remains for the replaced authoring or
  runtime model.
- No receipt, completion ledger, transaction/replay journal, operation history,
  applied-operation state, or tooling-evidence file exists in any format;
  current authoritative state is sufficient.
- Existing applications must migrate explicitly or remain pinned to an old
  release.
- CRUD schema and resources are normal authored application contracts.
- Standard CRUD mechanics use strong framework APIs rather than copied
  orchestration.
- Actions are the canonical public operation contract for HTTP, assistants,
  automation, internal callers, and tests.
- Ordinary features do not duplicate one contract across controller, route,
  action, service, repository, and provider boilerplate.
- Services and repositories remain available as meaningful domain boundaries,
  but no supported pattern requires empty pass-through layers.
- Application and feature code performs no arbitrary container lookup.
- Installed provider dependencies are explicit named capability inputs.
- Request state is passed through explicit contexts, not child containers.
- Purpose-built registries replace tagged service bindings for extension
  points.
- Auth/account package composition cannot silently succeed partially.
- Package changes can be planned coherently and installed without repeated
  exploratory install cycles.
- Doctor and verification check contracts rather than file provenance.
- Material patterns use skeletons, stable pending labels, toasts for transient
  failures, 48px targets, accessible controls, and warm-cache-safe state.
- Responsive shell tests do not click implementation-detail scrims or depend
  on magic generated-page classes.
- `.jskit/APP_BLUEPRINT.md`, AI seed, generator workboards, questionnaires,
  field patchers, and generator provenance are absent from the supported model.
- The general JSKIT CLI is deleted, or any surviving executable is demonstrably
  tiny, non-interactive, and irreducible to simpler package/library/script
  ownership.
- MySQL and PostgreSQL reference applications pass equivalent end-to-end
  verification.
- Every managed development session receives its own database, with the full
  migration graph and explicit application seed applied before use; no shared
  project database fallback exists.
- Managed execution creates files with correct ownership and modes from the
  outset; no post-job permission repair or recursive chmod/chown sweep is part
  of the supported design.
- Any capable agent can drive the complete development flow when the developer
  supplies their own environment, editor, preview, Git, and browser.
- Managed development environments can drive the same flow without
  technology-specific JSKIT adapters.

## Success measures

We will compare the new reference builds with the book-catalogue trace that
motivated this change.

Useful measures include:

- number of tool calls before working application code exists
- number of package discovery commands
- number of dependency installation runs
- volume of agent guidance read
- number of generator-specific concepts the agent must understand
- number of app workarounds for JSKIT defects
- time from explicit Stack choice to runnable first slice
- time spent in repeated broad verification
- failures caused by hidden generated-file contracts
- framework defects caught upstream by pattern tests

The target is not an arbitrary benchmark number. The target is an obvious
qualitative change: the agent should spend its effort understanding and
building the product, not reverse-engineering the framework's authoring tools.

DogAndGroom is the decisive downstream proof before the new JSKIT line is
considered practically publishable. Its product behavior, data, migrations,
actions, routes, and UI should survive an explicit migration without a
compatibility shim. If porting DogAndGroom feels like rebuilding the product,
the new framework has become too clever or the migration has deleted the wrong
things. That result blocks practical publication until the architecture is
simplified.

The migration is expected to split along the architecture that the application
has already earned:

- ordinary resource packages such as breeds, contacts, services, and vets keep
  their resource definitions and product-specific policy, while repeated
  provider/repository/service/action/route wiring collapses into the strong
  CRUD framework API
- resources with real additional behavior, such as pet photo storage, keep
  that behavior as a small explicit feature beside the ordinary CRUD resource
- orchestration domains such as booking, grooming, daycare, notifications, and
  the customer portal keep their meaningful services, repositories,
  coordinators, lifecycle, and transactional boundaries
- those orchestration features receive repositories, storage, realtime,
  configuration, and other feature APIs as named capabilities; they do not
  recover them through hidden container lookups
- ordinary HTTP and assistant exposure is projected from action definitions;
  only genuinely custom transports retain explicit route code
- existing migrations and product data remain authoritative and are not
  regenerated, replayed, or replaced

The proof is therefore not merely that DogAndGroom can be made to start. Its
simple packages should become materially smaller, its complex packages should
become easier to read, and its product code should remain recognizably the same
codebase.

## Explicit non-goals

This change will not:

- make Vibe64 required for JSKIT development
- make any particular agent host or project orchestrator a JSKIT dependency
- turn JSKIT into an LLM host or agent scheduler
- allow product requirements to be silently inferred when materially
  ambiguous
- replace deterministic runtime behaviour with generated prose
- remove strong auth, ownership, schema, migration, UI, or testing contracts
- delete valuable templates before their knowledge is preserved
- keep old generators as a permanent alternative path
- preserve old commands, metadata, runtime branches, or file readers through
  backward-compatibility shims
- replace deleted provenance with receipts, ledgers, replay files, or other
  authoring-operation bookkeeping, whether durable or nominally temporary
- make patterns immutable application frameworks that cannot be adapted
- make verification compare applications byte-for-byte with examples
- let an agent patch framework defects locally instead of fixing them upstream

## Immediate next work

The first implementation slice after this document is:

1. inventory all current template roots and generator-owned invariants
2. define the minimal pattern package contract
3. expose pattern discovery through installed skills and normal package assets
   (using a tiny tool only if direct access is insufficient)
4. migrate the base application and owner-scoped CRUD patterns
5. prove in-place use inside an empty Git repository

That slice deliberately touches the hardest evidence from the book-catalogue
trial first: app realization, package closure, CRUD authoring, and concise agent
discovery. Once those boundaries are sound, the remaining templates can move
systematically and the old generator system can be deleted with confidence.
