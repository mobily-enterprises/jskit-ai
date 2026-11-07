<!-- Generated from `packages/agent-docs/heuristics/typed-features.md`. -->

# Typed Feature Heuristics

Use when:

- writing or reviewing a server feature, provider, action, service, repository, route, error or test
- a `jskit/*` lint rule from `@jskit-ai/config-eslint` reports a finding
- a collaborator is probed, defaulted to nothing, or filled in after construction

[Typed features](../typed-features.md) is the one guide:
each rule there says what to do, why, and shows good and bad code. This map
only sends a keyword or a finding to its section. Every lint message already
ends with the same link.

## Keyword map

- `typeof x === "function"`, `x?.method?.()`, `received?.()`, `= null`, `= {}` or `= () => {}` on a collaborator, "x is required" guard (`jskit/required-collaborators`)
  - [Required collaborators](../typed-features.md#required-collaborators)
- `optional operation:` on a method every implementer has, a feature-gated operation
  - [Required collaborators](../typed-features.md#required-collaborators)
- `create<Name>(dependencies)` with `dependencies.x` in the body, no `@param` type, a pure helper passed in (`jskit/typed-dependencies`)
  - [Typed collaborators](../typed-features.md#typed-collaborators)
- `(...args: any[]) => Promise<any>`, `ReturnType<…>` or `X["service"]` repeated, a missing `types.js` (`jskit/named-repeated-type`)
  - [Capability types](../typed-features.md#capability-types)
- `capability.service || capability`, `x?.value ?? x`, "tests pass the bare service" (`jskit/no-dual-shape`)
  - [One shape per value](../typed-features.md#one-shape-per-value)
- `env = process.env`, `env || process.env`, `.env` loaded twice (`jskit/no-env-default`)
  - [Environment from the caller](../typed-features.md#environment-from-the-caller)
- `setProvider`, `attach*`, any `set<Name>()` that fills a slot, `X | null` below the hook, `deferred until boot: <reason>` (`jskit/no-slot-setter`)
  - [Optional tokens](../typed-features.md#optional-tokens)
- a module-level `register<Name>()`, `let x` or a `WeakMap` filled in `boot()` (`jskit/no-module-registry`)
  - [Owned state](../typed-features.md#owned-state)
- `shutdown()` with `?.()` or `?? []`
  - [Shutdown mirrors setup](../typed-features.md#shutdown-mirrors-setup)
- `logger = null`, `if (!logger) return`, `logger = console`, `logger?.warn`, a log line built from `error.message`
  - [Loggers](../typed-features.md#loggers)
- a value built inline in `setup()`, inline `actions() { return [{ … }] }`, a `defineFeature` in `*Provider.js`
  - [Feature files](../typed-features.md#feature-files)
- an action outside `create<Name>Actions`, `ActionSpecifications`, `run(service, input, context)`, positional `create<Name>Actions(service)` (`jskit/action-creator`)
  - [Action creators](../typed-features.md#action-creators)
- `async execute`, `execute(input) { … }`, `await` or an envelope in an action, `input || {}`, `input?.` (`jskit/one-line-action`, `jskit/action-execute-shape`)
  - [One-line execute](../typed-features.md#one-line-execute)
- `actionDefaults`, `channels` and `surfaces` repeated in every literal
  - [Shared action fields](../typed-features.md#shared-action-fields)
- `mode: "patch"` on a command, a service guard that repeats `required`
  - [Strict action inputs](../typed-features.md#strict-action-inputs)
- `idempotency:` (`jskit/no-idempotency`)
  - [No idempotency](../typed-features.md#no-idempotency)
- a `with<Rule>(definition)` wrapper around every action
  - [The action policy](../typed-features.md#the-action-policy)
- `context?.actor`, `options.context.actor`, `requireRequestContext`, `{ request, context }` beside `{ context }`
  - [Request context](../typed-features.md#request-context)
- `payload = {}`, `query = {}`, `input?.x` in a service, a second parse of validated input
  - [Validated input as is](../typed-features.md#validated-input-as-is)
- `options?.` or `options || {}` after `options = {}`, `fetchImpl = null` below the feature, `skip*` flags, a boolean mode parameter (`jskit/no-optional-after-default`)
  - [Options and defaults](../typed-features.md#options-and-defaults)
- `return { method() { … } }` from a `create*`, an unfrozen list (`jskit/frozen-factory-result`)
  - [Frozen results](../typed-features.md#frozen-results)
- `...factory(…)` in a token value or a returned API (`jskit/no-factory-spread`)
  - [Named members](../typed-features.md#named-members)
- a copied helper, function or arrow, a local `normalizeText` (`jskit/no-duplicate-helper`)
  - [One helper per package](../typed-features.md#one-helper-per-package)
- `options?.trx || options?.transaction`, a hand-read actor, cursor or created id
  - [One reader per fact](../typed-features.md#one-reader-per-fact)
- `api.resources.x.query(…)` with no `page` for a list, `queryDocuments(query)` with no `limit` in a service, a list that stops at 20 rows, `page: { size: 500 }` or `limit: 500` that returns 100 rows
  - [Every row](../typed-features.md#every-row)
- `await getDocumentById(…)`, `queryDocuments(…)` or a service `get` inside a loop or a `Promise.all` over a list, a single-record helper reused for a list, N+1 queries, a list whose query count grows with its rows, a slow list endpoint
  - [Lists read related rows in batches](../typed-features.md#lists-read-related-rows-in-batches)
- a `rowPolicy` that loads a person's whole history or calls an access check per item, `createDocument` per row of a batch, a write that gets slower as history grows
  - [Bounded access checks](../typed-features.md#bounded-access-checks)
- a route that queries storage, `boot*.js` holding routes
  - [Routes](../typed-features.md#routes)
- `new AppError(status, message)` with no code, `new NotFoundError("…")`, one code for two sentences (`jskit/app-error-code`)
  - [Refusals carry their own code](../typed-features.md#refusals-carry-their-own-code)
- `AppError(500, …)` for an internal invariant
  - [Internal failures are plain errors](../typed-features.md#internal-failures-are-plain-errors)
- `Object.assign(new Error(…), { statusCode })`, `error.status = 404` (`jskit/no-patched-error`)
  - [One construction per error](../typed-features.md#one-construction-per-error)
- `.catch(() => {})` around a collaborator call
  - [Failures are logged, not swallowed](../typed-features.md#failures-are-logged-not-swallowed)
- a double that copies an id format or a stream frame, production code shaped around a double
  - [Doubles use documented seams](../typed-features.md#doubles-use-documented-seams)
- a parameter, option or default only tests pass
  - [Tests are not callers](../typed-features.md#tests-are-not-callers)
- `…ForTests`, `__reset…`, `testOnly…` exports (`jskit/no-test-only-export`)
  - [No test-only exports](../typed-features.md#no-test-only-exports)
- a list, batch or write test with one to three rows, no query count, a fixed query ceiling tuned to pass, a slow endpoint first seen with real data, a hand-written `knex.on("query")` counter, a patched `Client.prototype.query`, `countQueries`, `countRuntimeQueries`, a route's query count
  - [Query counts at realistic sizes](../typed-features.md#query-counts-at-realistic-sizes)
- `node --test --test-concurrency=1`, `workers: 1`, `fileParallelism: false`, a suite that runs one file at a time, test files that collide when run together, a Playwright webServer running `npm run develop` or `vite`, a browser suite that takes hours, `test/*` findings of `jskit check`
  - [Test files run in parallel](../typed-features.md#test-files-run-in-parallel)
- `knex.migrate.latest()` in each test file, a template database rebuilt by migrating, test preparation slower than its tests
  - [Test databases are prepared once](../typed-features.md#test-databases-are-prepared-once)
- a file over 750 lines, a function over 600 (`max-lines`, `max-lines-per-function`), a data module
  - [Size limits](../typed-features.md#size-limits), [Data modules](../typed-features.md#data-modules)
- two properties on one line in `Object.freeze({ … })` or a token map (`jskit/one-property-per-line`)
  - [Formatter](../typed-features.md#formatter)
- `build*` factories, `create*` pure builders, files not named for what they hold
  - [Names](../typed-features.md#names)
- a `//` description before a `/** */` block, a comment that says "was", "now", "until" or "tests" (`jskit/jsdoc-description-inside`)
  - [Comments](../typed-features.md#comments)
- `readable-check: allow` without a reason prefix, a reason that cites tests (`jskit/allow-comment-form`)
  - [Exceptions](../typed-features.md#exceptions)

Avoid:

- probing a collaborator before calling it
- defaulting a collaborator to `null`, `{}` or a no-op
- setters that fill a slot after construction
- module-level registries
- refusals without their own code
- excusing a finding without a reason in its `readable-check: allow` comment
- a read per row of a list, or an access check sized by stored history
- raising a time limit instead of finding why a check is slow
