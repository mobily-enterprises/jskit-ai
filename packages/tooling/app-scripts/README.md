# @jskit-ai/app-scripts

Reusable app task preset and CLI runner for Node + Vue + Fastify style applications.

## What this package is for

Use this package to standardize app scripts across projects:

- one preset to generate a canonical `tasks` map
- one CLI (`jskit-app-scripts`) to run those tasks from app-local config
- consistent behavior for dev/build/test/lint/db/docs/ops commands

This avoids repeating large script definitions in every app `package.json`.

## What this package is not for

- No build system by itself.
- No deployment orchestration.
- No app runtime behavior changes.
- No replacement for package manager scripts; it runs tasks defined by the app.

## Exports

- `@jskit-ai/app-scripts`
  - `createNodeVueFastifyScriptsConfig`
- CLI binary:
  - `jskit-app-scripts` (from `bin/jskit-app-scripts.js`)

## Public API reference

## `createNodeVueFastifyScriptsConfig(options = {})`

Creates a default task config object:

```js
{
  tasks: {
    dev: { command: "vite", env: { VITE_CLIENT_ENTRY: "main.js" } },
    lint: "jskit-app-scripts lint:process-env && eslint .",
    test: { command: "node", args: ["--test"], env: { NODE_ENV: "test" } },
    ...
  }
}
```

### What it returns

- A `tasks` object with canonical tasks for:
  - server/start/worker
  - vite dev/build/preview
  - lint/format
  - knex migrate/rollback/seed
  - test/test coverage/e2e
  - docs api contracts
  - retention ops tasks

### Option fields (real examples)

- `serverEntry`, `workerEntry`
  - Example: custom server path `bin/server.custom.js`.
- `mainClientEntry`, `publicClientEntry`
  - Example: use `main.alt.js` for custom client boot.
- `internalDistDir`, `publicDistDir`
  - Example: split internal/public build outputs.
- `knexfile`, `usersSeedFile`, `calculatorSeedFile`
  - Example: app with custom knexfile and seed filenames.
- `testCoverageConfig`, `testCoverageAspirationalConfig`
  - Example: use app-specific coverage policy files.

Practical example:

```js
import { createNodeVueFastifyScriptsConfig } from "@jskit-ai/app-scripts";

export default createNodeVueFastifyScriptsConfig({
  mainClientEntry: "main.alt.js",
  knexfile: "knexfile.alt.cjs"
});
```

This keeps a project aligned with team defaults while allowing local override where needed.

## CLI behavior reference (`jskit-app-scripts`)

Usage:

```bash
jskit-app-scripts <task> [-- <extra args>]
```

The CLI loads config from current app directory:

- `app.scripts.config.mjs` (preferred)
- fallback `app.scripts.config.js`

That config must default-export an object containing `tasks`.

### Task definition styles

- String task:
  - executed via shell
  - example: `"lint": "jskit-app-scripts lint:process-env && eslint ."`
- Object task:
  - `{ command, args?, env?, shell? }`
  - example:
    ```js
    test: { command: "node", args: ["--test"], env: { NODE_ENV: "test" } }
    ```

### Internal CLI function behavior (important for maintainers)

- `shellQuote(value)`
  - safely quotes args when running shell tasks.
  - Example: argument with spaces stays a single argument.
- `printUsageAndExit(message)`
  - prints user-friendly error plus usage then exits.
  - Example: called when task name is missing.
- `parseTaskArguments(argv)`
  - parses task and extra args after `--`.
  - Example: `task -- alpha beta` passes `alpha beta` to task command.
- `loadConfigFromCwd()`
  - loads app config from working directory and validates shape.
  - Example: fails fast if app config file is missing.
- `resolveTaskDefinition(config, task)`
  - resolves task and throws with supported task list when unknown.
  - Example: typo `testt` returns clear message with valid choices.
- `createProcessOptions(env, cwd)`
  - builds child-process options with merged env and inherited stdio.
- `runShell(command, extraArgs, options)`
  - executes string task through shell.
- `runCommand(taskDefinition, extraArgs, options)`
  - executes object task directly with `spawn`.
- `main()`
  - orchestrates parsing, loading config, resolving task, spawning process, and forwarding exit code/signal.

## How it is used in apps (real terms, and why)

Current `jskit-value-app` usage:

- `apps/jskit-value-app/app.scripts.config.mjs`
  - imports `createNodeVueFastifyScriptsConfig`
  - exports default preset config
- `apps/jskit-value-app/package.json`
  - almost all scripts call `jskit-app-scripts <task>`
  - examples:
    - `npm run -w apps/jskit-value-app dev`
    - `npm run -w apps/jskit-value-app test`
    - `npm run -w apps/jskit-value-app db:migrate`

Why this matters:

- new apps can adopt a full script suite quickly
- script behavior is consistent across apps
- local app overrides stay explicit in one config file

Practical flow example:

1. Developer runs `npm run -w apps/jskit-value-app test`.
2. npm executes `jskit-app-scripts test`.
3. CLI loads `app.scripts.config.mjs`.
4. Task resolves to node test command with `NODE_ENV=test`.
5. Process exit code is forwarded back to npm.

## Testing notes

This package includes tests that verify:

- CLI task execution and argument passing
- fail-fast behavior for unknown task/missing config
- preset task defaults and option override behavior

Files:

- `packages/tooling/app-scripts/test/cli.test.js`
- `packages/tooling/app-scripts/test/preset.test.js`

