# Typed Feature Heuristics

Use when:

- writing or reviewing a server feature, provider, action, service, repository, route, error or test
- a `jskit/*` lint rule from `@jskit-ai/config-eslint` reports a finding
- a collaborator is probed, defaulted to nothing, or filled in after construction

[Typed features](../site/guide/framework/typed-features.md) is the one guide:
each rule there says what to do, why, and shows good and bad code. This map
only sends a keyword or a finding to its section. Every lint message already
ends with the same link.

## Keyword map

- `typeof x === "function"`, `x?.method?.()`, `received?.()`, `= null`, `= {}` or `= () => {}` on a collaborator, "x is required" guard (`jskit/required-collaborators`)
  - [Required collaborators](../site/guide/framework/typed-features.md#required-collaborators)
- `optional operation:` on a method every implementer has, a feature-gated operation
  - [Required collaborators](../site/guide/framework/typed-features.md#required-collaborators)
- `create<Name>(dependencies)` with `dependencies.x` in the body, no `@param` type, a pure helper passed in (`jskit/typed-dependencies`)
  - [Typed collaborators](../site/guide/framework/typed-features.md#typed-collaborators)
- `(...args: any[]) => Promise<any>`, `ReturnType<…>` or `X["service"]` repeated, a missing `types.js` (`jskit/named-repeated-type`)
  - [Capability types](../site/guide/framework/typed-features.md#capability-types)
- `capability.service || capability`, `x?.value ?? x`, "tests pass the bare service" (`jskit/no-dual-shape`)
  - [One shape per value](../site/guide/framework/typed-features.md#one-shape-per-value)
- `env = process.env`, `env || process.env`, `.env` loaded twice (`jskit/no-env-default`)
  - [Environment from the caller](../site/guide/framework/typed-features.md#environment-from-the-caller)
- `setProvider`, `attach*`, any `set<Name>()` that fills a slot, `X | null` below the hook, `deferred until boot: <reason>` (`jskit/no-slot-setter`)
  - [Optional tokens](../site/guide/framework/typed-features.md#optional-tokens)
- a module-level `register<Name>()`, `let x` or a `WeakMap` filled in `boot()` (`jskit/no-module-registry`)
  - [Owned state](../site/guide/framework/typed-features.md#owned-state)
- `shutdown()` with `?.()` or `?? []`
  - [Shutdown mirrors setup](../site/guide/framework/typed-features.md#shutdown-mirrors-setup)
- `logger = null`, `if (!logger) return`, `logger = console`, `logger?.warn`, a log line built from `error.message`
  - [Loggers](../site/guide/framework/typed-features.md#loggers)
- a value built inline in `setup()`, inline `actions() { return [{ … }] }`, a `defineFeature` in `*Provider.js`
  - [Feature files](../site/guide/framework/typed-features.md#feature-files)
- an action outside `create<Name>Actions`, `ActionSpecifications`, `run(service, input, context)`, positional `create<Name>Actions(service)` (`jskit/action-creator`)
  - [Action creators](../site/guide/framework/typed-features.md#action-creators)
- `async execute`, `execute(input) { … }`, `await` or an envelope in an action, `input || {}`, `input?.` (`jskit/one-line-action`, `jskit/action-execute-shape`)
  - [One-line execute](../site/guide/framework/typed-features.md#one-line-execute)
- `actionDefaults`, `channels` and `surfaces` repeated in every literal
  - [Shared action fields](../site/guide/framework/typed-features.md#shared-action-fields)
- `mode: "patch"` on a command, a service guard that repeats `required`
  - [Strict action inputs](../site/guide/framework/typed-features.md#strict-action-inputs)
- `idempotency:` (`jskit/no-idempotency`)
  - [No idempotency](../site/guide/framework/typed-features.md#no-idempotency)
- a `with<Rule>(definition)` wrapper around every action
  - [The action policy](../site/guide/framework/typed-features.md#the-action-policy)
- `context?.actor`, `options.context.actor`, `requireRequestContext`, `{ request, context }` beside `{ context }`
  - [Request context](../site/guide/framework/typed-features.md#request-context)
- `payload = {}`, `query = {}`, `input?.x` in a service, a second parse of validated input
  - [Validated input as is](../site/guide/framework/typed-features.md#validated-input-as-is)
- `options?.` or `options || {}` after `options = {}`, `fetchImpl = null` below the feature, `skip*` flags, a boolean mode parameter (`jskit/no-optional-after-default`)
  - [Options and defaults](../site/guide/framework/typed-features.md#options-and-defaults)
- `return { method() { … } }` from a `create*`, an unfrozen list (`jskit/frozen-factory-result`)
  - [Frozen results](../site/guide/framework/typed-features.md#frozen-results)
- `...factory(…)` in a token value or a returned API (`jskit/no-factory-spread`)
  - [Named members](../site/guide/framework/typed-features.md#named-members)
- a copied helper, function or arrow, a local `normalizeText` (`jskit/no-duplicate-helper`)
  - [One helper per package](../site/guide/framework/typed-features.md#one-helper-per-package)
- `options?.trx || options?.transaction`, a hand-read actor, cursor or created id
  - [One reader per fact](../site/guide/framework/typed-features.md#one-reader-per-fact)
- a route that queries storage, `boot*.js` holding routes
  - [Routes](../site/guide/framework/typed-features.md#routes)
- `new AppError(status, message)` with no code, `new NotFoundError("…")`, one code for two sentences (`jskit/app-error-code`)
  - [Refusals carry their own code](../site/guide/framework/typed-features.md#refusals-carry-their-own-code)
- `AppError(500, …)` for an internal invariant
  - [Internal failures are plain errors](../site/guide/framework/typed-features.md#internal-failures-are-plain-errors)
- `Object.assign(new Error(…), { statusCode })`, `error.status = 404` (`jskit/no-patched-error`)
  - [One construction per error](../site/guide/framework/typed-features.md#one-construction-per-error)
- `.catch(() => {})` around a collaborator call
  - [Failures are logged, not swallowed](../site/guide/framework/typed-features.md#failures-are-logged-not-swallowed)
- a double that copies an id format or a stream frame, production code shaped around a double
  - [Doubles use documented seams](../site/guide/framework/typed-features.md#doubles-use-documented-seams)
- a parameter, option or default only tests pass
  - [Tests are not callers](../site/guide/framework/typed-features.md#tests-are-not-callers)
- `…ForTests`, `__reset…`, `testOnly…` exports (`jskit/no-test-only-export`)
  - [No test-only exports](../site/guide/framework/typed-features.md#no-test-only-exports)
- a file over 750 lines, a function over 600 (`max-lines`, `max-lines-per-function`), a data module
  - [Size limits](../site/guide/framework/typed-features.md#size-limits), [Data modules](../site/guide/framework/typed-features.md#data-modules)
- two properties on one line in `Object.freeze({ … })` or a token map (`jskit/one-property-per-line`)
  - [Formatter](../site/guide/framework/typed-features.md#formatter)
- `build*` factories, `create*` pure builders, files not named for what they hold
  - [Names](../site/guide/framework/typed-features.md#names)
- a `//` description before a `/** */` block, a comment that says "was", "now", "until" or "tests" (`jskit/jsdoc-description-inside`)
  - [Comments](../site/guide/framework/typed-features.md#comments)
- `readable-check: allow` without a reason prefix, a reason that cites tests (`jskit/allow-comment-form`)
  - [Exceptions](../site/guide/framework/typed-features.md#exceptions)

Avoid:

- probing a collaborator before calling it
- defaulting a collaborator to `null`, `{}` or a no-op
- setters that fill a slot after construction
- module-level registries
- refusals without their own code
- excusing a finding without a reason in its `readable-check: allow` comment
