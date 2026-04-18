# Working with the JSKIT CLI

In the first chapter, we used the JSKIT CLI, but only in passing. We created the app, installed dependencies, and moved on.

This chapter steps back and treats the CLI as a subject in its own right.

That matters because `jskit` is not just "the thing that installs packages". It is the tool that helps you:

- discover what JSKIT can do
- inspect bundles, packages, and generators before using them
- apply and re-apply JSKIT-managed mutations to your app
- keep managed files and lock state healthy
- create your own app-local runtime packages

If you understand this chapter early, the rest of the guide becomes much easier to follow.

## Recap from previous chapters

To get back to the same starting point as the end of the previous chapter, run:

```bash
npx @jskit-ai/create-app exampleapp --tenancy-mode none
cd exampleapp
npm install
```

If you are already continuing from the previous chapter, you are already in the right place and can skip that setup.

One practical note before we start: the discovery commands in this chapter are safe to run right now. Some of the later examples are shown as real commands you will use in later chapters, but you do **not** need to run all of them yet.

## What the CLI is actually managing

The easiest way to understand `jskit` is to separate it from the other tools in the app.

- `jskit` manages JSKIT-owned app mutations
- `npm install` downloads dependencies from `package.json`
- `npm run dev` and `npm run build` run Vite
- `npm run server` runs the backend
- `npm run db:migrate` runs Knex migrations against the database

That separation is crucial.

When you run a command such as `npx jskit add package shell-web`, JSKIT updates app-owned files and records what it changed. It does **not** replace npm, Vite, or Knex.

The most important record of that managed state lives here:

```text
.jskit/lock.json
```

That lock file is the source of truth for installed JSKIT-managed package state. It records things like:

- which JSKIT packages are installed
- which options were used when they were installed
- which package.json fields were added or changed
- which managed files or text mutations belong to each package

That is why commands such as `update`, `remove`, `position`, `migrations`, and `doctor` all care about `.jskit/lock.json`.

## JSKIT-managed app maintenance scripts

The scaffolded app also has a small set of `npm run` shortcuts that are really wrappers around JSKIT-owned maintenance behavior.

The important examples are:

- `npm run verify`
- `npm run jskit:update`
- `npm run devlinks`
- `npm run release`

In the current scaffold, those scripts are intentionally thin:

```json
{
  "scripts": {
    "verify": "jskit app verify && npm run --if-present verify:app",
    "jskit:update": "jskit app update-packages",
    "devlinks": "jskit app link-local-packages",
    "release": "jskit app release"
  }
}
```

That is a deliberate design choice.

The app keeps the handy `npm run` names, but the real maintenance policy now lives in the installed CLI package instead of copied shell scripts inside the app. That means if JSKIT later changes how package updates, local linking, or baseline verification should work, apps can pick up the new behavior by updating `@jskit-ai/jskit-cli` instead of hand-editing frozen scaffold files.

This gives you a clean ownership split:

- app-owned scripts still describe how *this app* runs, builds, and tests
- JSKIT-owned wrapper scripts delegate framework maintenance to `jskit app ...`

That split is worth keeping in mind through the rest of the guide. When you see `npm run verify`, that is now shorthand for "run the app's JSKIT baseline verification policy, then any app-specific extra verification hook".

If your app uses a non-default npm registry for JSKIT packages, pass it to the maintained CLI command rather than hard-coding it in the scaffold. For example:

```bash
npm run jskit:update -- --registry https://registry.example.com
npm run release -- --registry https://registry.example.com
```

For older apps that still carry copied maintenance scripts, the migration path is:

```bash
npx jskit app adopt-managed-scripts
```

That command rewrites known old scaffold values to the thin wrapper form above.

## Discover first, change second

One of the best habits in JSKIT is to inspect the catalog before mutating the app.

### Start with `help`

The top-level overview is:

```bash
npx jskit help
```

That shows the available commands such as:

- `app`
- `list`
- `show`
- `add`
- `update`
- `remove`
- `position`
- `migrations`
- `create`
- `doctor`

Every command in the CLI also has its own help page. For example:

```bash
npx jskit help app
npx jskit help add
npx jskit help migrations
```

That is the fastest way to check current usage without leaving the terminal.

### Use `list` for discovery

The broad catalog view is:

```bash
npx jskit list
```

By default, this prints three groups:

- bundles
- runtime packages
- generators

That distinction matters.

#### Bundles

A bundle is a curated install shortcut for several runtime packages that are meant to go together.

In the current catalog, `auth-base` is the obvious example. It is a single bundle id, but it expands to several real runtime packages.

#### Runtime packages

These are the actual packages that change how the app runs. Packages such as `shell-web`, `auth-web`, `users-web`, and `workspaces-web` belong here.

These are the things you install with:

```bash
npx jskit add package ...
```

#### Generators

Generators are tooling packages such as `ui-generator`, `crud-server-generator`, and `crud-ui-generator`.

They are **not** runtime installs.

You do **not** add them with `jskit add`. You run them with:

```bash
npx jskit generate ...
```

That distinction is easy to miss at first, and it is one of the main reasons this chapter exists.

If you only want one section of the catalog, use a mode:

```bash
npx jskit list packages
npx jskit list generators
```

Those two commands are especially useful later in the guide, once you already know roughly what kind of thing you are looking for.

If you want bundle members printed inline too, `npx jskit list --full` expands the bundle view. That is useful when you want a quick catalog scan without dropping straight into `show`.

One more detail is worth noticing. In repos that contain local package descriptors, `list packages` can also show app-local or repo-local packages in addition to the published catalog. So `list` is not only a remote catalog browser. It is also a view of what this app can currently see.

### Use `show` before you install

Once `list` helps you find the right id, `show` is how you inspect it.

The basic form is:

```bash
npx jskit show <id>
```

And the more useful inspection form is:

```bash
npx jskit show <id> --details
```

This command is unusually valuable in JSKIT because packages and bundles do more than "add a dependency". They can:

- provide or require capabilities
- register runtime providers
- contribute placement entries
- write files into the app
- mutate `package.json`, scripts, and text blocks

So `show` is the command that answers:

- what does this thing actually install?
- what does it depend on?
- what runtime surfaces does it contribute?
- what app-owned files will it write or mutate?
- what container tokens or import surfaces does it expose?

The plain form is useful when you only want to identify something quickly. `--details` is what turns `show` into a real architecture-inspection command.

### What `show` is good at

There are two especially common cases:

- you found a bundle or package in `jskit list` and want to know what it really does before you install it
- you already know a package changed the shell, the runtime graph, or the app tree, and you want to see *how*

That second case matters just as much as the first one. Later in the guide, chapters explain package behavior one feature at a time. `show --details` is the generic command that lets you inspect those same package contracts directly.

### A first example: what does `auth-base` actually install?

Run:

```bash
npx jskit show auth-base --details
```

This output is short, but it already teaches something important:

- `auth-base` is a **bundle**
- it is not a runtime package by itself

It expands to two real runtime packages:

- `@jskit-ai/auth-core`
- `@jskit-ai/auth-web`

That is exactly the kind of thing you want to know before you mutate the app. For a bundle, this is often the main question:

- *what real packages am I about to get?*

`auth-base` is a good example because the bundle name is short and convenient, but the detailed view makes the underlying install explicit. It also helps you keep the mental model straight:

- bundles are install shortcuts
- runtime packages are the things that actually provide capabilities

### A richer example: what does `workspaces-web` contribute?

Run:

```bash
npx jskit show @jskit-ai/workspaces-web --details
```

This is where `--details` becomes much more powerful.

The compact form of `show` is fine when you only want the package description. The detailed form can show things like:

- provided and required capabilities
- summary import surfaces / exported subpaths
- container tokens
- placement outlets
- default placement contributions
- dependency mutations
- script mutations
- text mutations
- file writes
- runtime providers

That makes `show --details` one of the best "read before you write" commands in the whole CLI.

### Why `--details` matters

The plain form:

```bash
npx jskit show @jskit-ai/workspaces-web
```

is mainly for identifying the package at a glance.

The detailed form:

```bash
npx jskit show @jskit-ai/workspaces-web --details
```

is for understanding the package as part of the app architecture. It lets you answer concrete questions from one command instead of hunting across descriptors and generated files.

That is the version you should prefer when you are making a real install decision.

### What `show --details` teaches you

The output is not one giant wall of metadata. It is answering several practical questions. You do not need to read every line. Read the sections that answer the question you currently have.

#### "What capabilities does this package participate in?"

The `Capabilities` section tells you:

- what the package provides
- what it requires from other packages

That helps you reason about dependency direction and why some packages bring others with them.

For `@jskit-ai/workspaces-web`, the detailed output shows:

- it **provides** `workspaces.web`
- it **requires** `users.web` and `workspaces.core`

That immediately tells you this package is not just some loose UI helper. It is the web layer of the workspace feature set, and it expects the users and workspace core layers underneath it.

#### "What UI does this package contribute?"

The placement sections are often the most useful part of `show --details`.

For `@jskit-ai/workspaces-web`, the detailed output shows placement contributions such as:

- the workspace selector in `shell-layout:top-left`
- the pending invites cue in `shell-layout:top-right`
- the workspace tools widget on the `admin` surface
- the `Members` and workspace settings menu entries

That lets you answer a very concrete question before installing anything:

- *what will change in the shell if I add this package?*

It also shows placement outlets, such as:

- `admin-settings:primary-menu`

which helps you understand where later app-owned pages or settings links can attach.

#### "What import paths, tokens, or providers does it register?"

The detailed output can also show:

- summary import surfaces / exported subpaths
- container tokens
- runtime providers

For `@jskit-ai/workspaces-web`, that includes client tokens such as:

- `workspaces.web.workspace.selector`
- `workspaces.web.workspace.tools.widget`
- `workspaces.web.members-admin.element`

It also shows a short `Summary` section with the main client import surfaces, such as:

- `@jskit-ai/workspaces-web/client`
- `@jskit-ai/workspaces-web/client/providers/WorkspacesWebClientProvider`
- `@jskit-ai/workspaces-web/client/composables/useWorkspaceRouteContext`

That gives you a quick view of the package's client integration surface without reading the source first.

This is especially useful when you are asking questions like:

- *does this package expose a client entrypoint I can import from?*
- *does it register a provider, or am I expected to wire components myself?*
- *what token name should I expect to see in placements or providers?*

#### "What app-owned files will it touch?"

The `File writes`, `Text mutations`, and `Script mutations` sections answer one of the most practical questions in JSKIT:

- *what will this package actually do to my app tree?*

For `@jskit-ai/workspaces-web`, the detailed view shows app-owned files such as:

- workspace surface route scaffolds
- workspace settings pages
- `WorkspaceNotFoundCard.vue`
- `useWorkspaceNotFoundState.js`

It also shows text mutations such as:

- appending placement entries to `src/placement.js`
- registering tokens in `packages/main/src/client/providers/MainClientProvider.js`

That matters because JSKIT packages are not only libraries. Many of them also write scaffold files into the app and extend app-owned provider files.

### The kinds of questions this answers well

Once you get used to it, `show --details` is the fast answer to questions like:

- *what does this bundle really install?*
- *why did this package add a new shell widget?*
- *which capabilities does this package provide and require?*
- *which app-owned files will JSKIT write if I install this?*
- *where do later pages or placements plug into this package?*
- *what container tokens or client entrypoints does this package expose?*

### How to read the output at a high level

Not every package shows every section, and that is normal. A good reading order is:

1. `Information`
   - what is this thing?
2. `Summary`
   - what are the main import paths or public entrypoints?
3. `Depends on`
   - what else does it need?
4. `Capabilities`
   - what role does it play in the runtime graph?
5. `Placement contributions` / `Placement outlets`
   - what UI surfaces does it add?
6. `File writes` and `Text mutations`
   - what app-owned files will change?
7. `Runtime providers` and `Container tokens`
   - what does it register internally?

That is enough to make `show --details` useful without treating it like a formal spec.

### A simple rule of thumb

Use:

```bash
npx jskit show <id>
```

when you only want to identify a package or bundle quickly.

Use:

```bash
npx jskit show <id> --details
```

when you are seriously considering installing it, or when you need to understand why a package changed the shell, the config, or the runtime in a particular way.

## Make the terminal nicer: `completion`

The CLI also ships with Bash completion:

```bash
npx jskit completion bash
```

That prints the completion script to stdout.

If you only want completion for the current shell session, run:

```bash
source <(npx jskit completion bash)
```

If you want JSKIT completion to keep working in future Bash sessions too, run:

```bash
npx jskit completion bash --install
```

This is not required, but it is genuinely useful once you start using commands such as `add`, `generate`, and `show` frequently.

## Installing runtime capability: `add`

The install command comes in two main forms:

```bash
npx jskit add package shell-web
npx jskit add bundle auth-base
```

Those two examples look similar, but they do different things.

### `add package`

Use this when you know the exact runtime package you want:

```bash
npx jskit add package shell-web
```

This is the command the next chapter uses.

Important defaults:

- short ids such as `shell-web` resolve to `@jskit-ai/shell-web` when available
- JSKIT records the install in `.jskit/lock.json`
- JSKIT rewrites app-owned managed files as needed
- npm install does **not** run unless you ask for it with `--run-npm-install`

That last point is why the normal guide flow is still:

```bash
npx jskit add package shell-web
npm install
```

`jskit add` changes the app. `npm install` downloads the dependencies that the changed app now requires.

### `add bundle`

Use this when the catalog already offers a sensible grouped install:

```bash
npx jskit add bundle auth-base
```

Bundles are a convenience layer. They save you from having to remember and install several related runtime packages one by one.

This is why `show auth-base --details` is useful first: it lets you see what the bundle will actually install.

### Generator packages are different

This is worth saying one more time because it causes confusion early on.

If `npx jskit list generators` shows a package such as `crud-ui-generator`, that does **not** mean you should run:

```bash
npx jskit add package crud-ui-generator
```

Generators are tooling packages. You use them through `jskit generate`, not `jskit add`.

## Managed-file lifecycle: `update`, `remove`, and `position`

Once a package is installed, JSKIT treats it as managed app state, not just as "one more dependency".

That state lives in `.jskit/lock.json`, which is why lifecycle commands all start from the lock record for the installed package. In practice, that means JSKIT remembers:

- which package is installed
- which install options were used
- which files, text mutations, dependency entries, and migrations it owns

The easiest way to think about the lifecycle is:

1. `jskit add package ...` creates managed state
2. `jskit update package ...` reapplies that managed state
3. `jskit position element ...` reapplies just the positioning layer
4. `jskit remove package ...` removes the managed state

That is a better mental model than thinking of these as three unrelated commands.

### `update` re-applies one installed package

The basic shape is:

```bash
npx jskit update package workspaces-web
```

This does **not** mean "fetch the newest npm version" in the way people often expect from other ecosystems.

In JSKIT, `update package ...` means:

- find the installed package in `.jskit/lock.json`
- reuse the saved lock options unless you override them inline
- run the normal package-application flow again with forced reapply

So `update` is for reapplying package-owned managed changes, not for generic dependency upgrades.

The best guide example is the tenancy-mode recovery path from the multi-homing chapter. If you installed `workspaces-core` or `workspaces-web` while the app was still on `tenancyMode = "none"`, then later changed the app to `personal`, the missing gated scaffold does not backfill automatically. The recovery path is:

```bash
npx jskit update package workspaces-core
npx jskit update package workspaces-web
```

That works because `update` reuses the saved install record and re-applies the package after the surrounding app state has changed.

This is the main kind of problem `update` solves:

- a package was installed correctly for the app state at the time
- the app state changed later
- the package's managed mutations need to be applied again

### `position` re-applies only the placement/positioning layer

The positioning command is:

```bash
npx jskit position element workspaces-web
```

This is the focused version of reapply.

It reads the installed package from the lock file and reapplies only positioning mutations. That makes it especially useful for placement-heavy packages such as `shell-web` or `workspaces-web`, where a package contributes:

- shell placements
- menu entries
- outlet-targeted UI elements
- ordering-sensitive positioned elements

Use `position` when:

- the package itself is still installed
- you only need the placement layer refreshed
- you do **not** want a full package reapply

A realistic example is a workspace-heavy shell where the placement registry or surrounding shell files were edited, merged, or recovered and you want JSKIT to re-apply the `workspaces-web` positioned contributions without rerunning the whole install flow:

```bash
npx jskit position element workspaces-web
```

That is why the target word is `element` rather than `package`. This command is about positioned UI contributions, not general package installation.

It also does **not** run npm install. This is a focused managed-file repair command, not a dependency-install step.

### `remove` removes managed state for one installed package

The removal form is:

```bash
npx jskit remove package workspaces-web
```

This is the inverse side of the lifecycle.

`remove` uses the lock record to tear out the managed state that package owns. In practice, that means it:

- removes the package's lock entry
- restores or removes the `package.json` fields JSKIT originally managed
- removes managed files only when they still match the version JSKIT owns

That last part is important. JSKIT is trying to remove package-owned managed state without blindly deleting user-owned edits.

Two practical things to remember:

- `remove` can refuse to run if other installed packages depend on the target package
- it does **not** automatically delete app-owned local package directories such as `packages/contacts/`

So if you created a local package yourself, `remove` cleans up the JSKIT-managed install state, but it does not assume it should delete the directory you own.

### The practical rule of thumb

If a package is already installed and you are deciding which command to use, think like this:

- use `update` when the package's full managed install state needs to be applied again
- use `position` when only its placement/positioning contributions need to be refreshed
- use `remove` when you want JSKIT to cleanly remove the managed package state from the app

All three commands make more sense once you see them as one lifecycle around `.jskit/lock.json`, not as isolated CLI tricks.

### `doctor` checks managed-state health

The health check is:

```bash
npx jskit doctor
```

This is JSKIT's normal app-health check for JSKIT-managed state.

It is not a linter, and it is not a test runner. It validates the things that only JSKIT itself can really verify.

In the current CLI, that includes checks such as:

- installed package entries in `.jskit/lock.json`
- whether managed files recorded in the lock still exist
- whether installed packages are still visible in the package registry
- certain JSKIT-specific app checks, such as invalid raw `mdi-*` icon literals in Vue templates when the app uses Vuetify's `mdi-svg` iconset

That last check is narrower than it sounds. `doctor` is looking for the broken case in direct Vue templates, such as:

```vue
<v-icon icon="mdi-paw" />
```

It does not flag the normal menu-metadata case in `src/placement.js`, where a shell menu link may still use:

```js
icon: "mdi-cog-outline"
```

because the shell runtime normalizes that metadata before Vuetify renders it. So if you see a `doctor` icon warning, the fix is usually "switch this Vue component to `@mdi/js`", not "remove every `mdi-*` string from the app."

In other words, `doctor` helps catch drift between:

- what JSKIT thinks it owns
- what is actually present on disk

That is a different job from:

- `npm run lint`, which checks source style and static code rules
- `npm run test`, which checks behavior
- `npm run build`, which checks whether the app can compile successfully

Those commands can all pass while JSKIT-managed state is still inconsistent. `doctor` is the command that checks that JSKIT's own view of the app still makes sense.

That is exactly why the starter scaffold now routes `npm run verify` through `jskit app verify`.

It belongs there because JSKIT apps are not only source trees. They also have:

- descriptor-driven runtime installs
- lock-file state under `.jskit/lock.json`
- JSKIT-managed files and mutations written into the app

`doctor` is the quick confirmation that those pieces still line up after all the normal quality checks pass.

This command belongs in your normal quality gate, not only in emergency debugging.

### When to run it manually

The most common manual use is simply:

```bash
npx jskit doctor
```

after you have done something that changes JSKIT-managed state.

Good times to run it manually include:

- after `jskit add`, `update`, `remove`, `create package`, or generator commands
- after rebasing or resolving conflicts that touched `.jskit/lock.json`, `package.json`, or app-owned managed files
- after deleting, moving, or renaming files that may have been created by JSKIT
- when a package appears installed in the lock but starts behaving as if it is missing
- when you want a fast JSKIT-specific health check without waiting for a full test suite

One important nuance: `doctor` is checking for broken JSKIT ownership and visibility, not trying to stop you from editing app-owned files. For example, a managed file that still exists but whose contents changed is normally fine. The problem is when JSKIT expects a managed file to exist and it is gone, or when the installed package state no longer resolves cleanly.

### Why `--json` exists

If you want machine-readable output, use:

```bash
npx jskit doctor --json
```

That prints a payload with:

- `appRoot`
- `lockVersion`
- `installedPackages`
- `issues`

This is useful in CI, editor tooling, or custom scripts where you want to parse the result instead of reading plain text. The exit code still does the simple job, but `--json` gives you the exact issue list in a form that other tools can consume.

## Migrations: writing files is not the same as running the database

This distinction is one of the most important things to understand in JSKIT.

The explicit migration-materialization command is:

```bash
npx jskit migrations changed
```

This command does **not** run Knex against the database.

What it does is:

- look at installed packages in `.jskit/lock.json`
- decide which installed packages have managed migrations that need to be materialized
- write those migration files into your app

So this command is about **managed migration files on disk**.

In many normal `jskit add` flows, those migration files are already written as part of package application. `jskit migrations changed` is the explicit re-sync command when you want JSKIT to materialize the migration files again based on the current installed package state.

The database execution step is still:

```bash
npm run db:migrate
```

That step is about **running** the migration files that already exist.

The clean mental model is:

1. JSKIT materializes managed migration files
2. Knex executes them against the database

If you remember only one thing from this section, make it this:

- `jskit migrations ...` writes or refreshes managed migration files
- `npm run db:migrate` actually applies migrations to the database

Do not confuse those two steps.

Here is the practical version:

```bash
# Common install flow for a schema-bearing package
npx jskit add package users-web
npm install
npm run db:migrate

# Refresh flow when JSKIT needs to re-materialize managed migration files
npx jskit migrations changed
npm run db:migrate
```

In the first flow, package installation usually already wrote the managed migration files. In the second flow, you are explicitly asking JSKIT to write or refresh them again before Knex applies them.

## Creating your own local package

JSKIT can also scaffold a brand-new app-local runtime package:

```bash
npx jskit create package contacts
```

If your app is named `exampleapp`, that command creates a package id like:

```text
@exampleapp/contacts
```

and scaffolds a real local package under:

```text
packages/contacts/
```

This is the direct CLI path for creating your own runtime package inside the app.

It is for the cases where you are authoring the package yourself:

- you want a new package boundary under `packages/`
- you want to define your own descriptor, providers, routes, or capabilities
- you are building app-specific runtime code, not installing something prebuilt from the catalog

That makes it different from both `add` and `generate`.

- `jskit add package ...` installs an existing runtime package from the catalog or from `node_modules`
- `jskit generate ...` runs a generator that writes app-owned scaffold files for a specific job such as CRUD
- `jskit create package ...` gives you a blank but valid app-local runtime package to grow yourself

### What the command creates

The new package is intentionally small. For `contacts`, the scaffold looks like this:

```text
packages/contacts/
  README.md
  package.json
  package.descriptor.mjs
  src/index.js
  src/client/index.js
  src/server/index.js
  src/shared/index.js
```

The command also updates two app-level files:

- `package.json`
- `.jskit/lock.json`

That means `create package` is not just "make a folder". It creates a real local JSKIT package and registers it with the app.

The important pieces are:

- `package.json`
  defines a private local package with exports for `.`, `./client`, `./server`, and `./shared`
- `package.descriptor.mjs`
  starts as a runtime descriptor with empty `dependsOn`, `capabilities`, `runtime`, `metadata`, and `mutations` sections ready for you to fill in
- `src/index.js`
  gives the package a top-level module entrypoint, even before you decide what should be exported from it
- `src/client/index.js`
  exports an empty `routeComponents` map and a no-op `bootClient()` so the package already has a valid client entrypoint
- `src/server/index.js` and `src/shared/index.js`
  give you the server and shared entrypoints without assuming any implementation yet
- `README.md`
  reminds you that the next step is to define runtime providers and real exports

This is a deliberate contrast with generated CRUD packages. A CRUD generator writes a much more opinionated scaffold: repository code, routes, actions, migrations, and resource definitions. `create package` does not guess any of that. It gives you the smallest valid runtime package boundary.

### How the new package fits into the app

When you create `contacts`, JSKIT also adds a file dependency to the app root `package.json`:

```json
"@exampleapp/contacts": "file:packages/contacts"
```

and records the package in `.jskit/lock.json` as a `local-package`.

That has a few consequences:

- the package becomes part of the app's managed JSKIT state
- `jskit list packages` can see it alongside catalog packages
- later `update`, `remove`, and related lifecycle commands know this package exists
- the package is still app-owned, so JSKIT does not assume it can delete your directory just because managed state changes

This is the same idea you already saw in the starter app's `packages/main/` package. `create package` is how you make another package like that on purpose, instead of waiting for a generator to create one indirectly.

One practical point is easy to miss: the package exists immediately, but it does not do anything interesting until you give the descriptor real runtime hooks. In other words, after `create package`, you still need to add things such as:

- client providers
- server providers
- routes or UI metadata
- capabilities or dependency declarations

So think of `create package` as "establish the package boundary first, then implement the runtime behavior."

Because the command adds a file dependency, the normal follow-up is still:

```bash
npm install
```

or:

```bash
npx jskit create package contacts --run-npm-install
```

JSKIT updates the app files. npm refreshes dependency installation.

### When to use it instead of a generator

Use `create package` when you are designing the package structure yourself.

Good fits include:

- a custom integration package that talks to one external API
- app-specific auth or policy behavior
- a local runtime package that owns both client and server behavior for one feature area
- a package that starts small now but may later grow providers, shared helpers, and routes

Use a generator when the problem is already understood well enough that JSKIT can scaffold the feature shape for you.

For example:

- `npx jskit create package contacts`
  gives you an empty-but-valid `packages/contacts/` package boundary
- `npx jskit generate crud-server-generator scaffold contacts ...`
  creates a CRUD-shaped package with repository, service, route, action, and migration files

Those commands can both result in a package under `packages/contacts/`, but they start from very different assumptions.

The other contrast is with catalog installs:

- `npx jskit add package workspaces-web`
  installs a package someone else already authored
- `npx jskit create package contacts`
  creates a package that your app will author and own

### `--scope`, `--package-id`, and `--description` in practice

The three most important inline options are about naming and identity.

#### `--scope`

By default, JSKIT derives the scope from the app package name.

So if your app is `exampleapp`, this:

```bash
npx jskit create package contacts
```

produces:

```text
package id: @exampleapp/contacts
directory:  packages/contacts
```

If you want a different scope, use `--scope`:

```bash
npx jskit create package contacts --scope local
```

which produces:

```text
package id: @local/contacts
directory:  packages/contacts
```

Use this when you want the package id to follow a deliberate local naming convention instead of the app name.

#### `--package-id`

`--package-id` overrides the full package id directly:

```bash
npx jskit create package contacts --package-id @acme/contacts
```

This is the strongest naming override. Use it when you already know the exact package id you want.

In practice, this matters when:

- you want the package id to stay stable even if the app name changes
- you want a different scope than the default inference
- you are standardizing naming across several related local packages

The package directory is derived from the package name part of the package id, so `@acme/contacts` still creates `packages/contacts/`.

#### `--description`

`--description` fills the generated descriptor description:

```bash
npx jskit create package contacts \
  --description "App-local contact management runtime package."
```

That is useful because the description is part of the package metadata JSKIT can show later when you inspect local packages. It is a small option, but it makes local packages easier to identify once an app has several of them.

So a practical mental model is:

- `--scope` chooses the default namespace for the generated package id
- `--package-id` sets the exact package id directly
- `--description` makes the generated descriptor self-describing

## Summary

The JSKIT CLI is easiest to understand if you separate four jobs:

- `list`, `show`, and `help` are for discovery and inspection
- `add`, `update`, and `remove` manage installed JSKIT runtime packages
- `position`, `doctor`, and `migrations` maintain or repair JSKIT-managed state
- `create package` scaffolds a new app-local runtime package

And then keep one more distinction in your head:

- JSKIT manages app-owned package mutations and managed files
- npm installs dependencies
- Knex runs database migrations

That is the mental model the rest of the guide assumes.

The next chapter goes back to the normal hands-on flow and uses that model immediately by installing `shell-web`.
