# Typed Feature Heuristics

Use when:

- writing or reviewing a server feature, provider, action, service or repository
- a `jskit/*` lint rule from `@jskit-ai/config-eslint` reports a finding
- a collaborator is probed, defaulted to nothing, or filled in after construction

Read [Typed features](../site/guide/framework/typed-features.md) before writing
the feature: its [rules](../site/guide/framework/typed-features.md#rules) give
each rule with a before and after, and its
[common mistakes](../site/guide/framework/typed-features.md#common-mistakes)
lists what passes the lint rules but is still wrong.

A *collaborator* is an object or function with behaviour that code calls:
service, store, repository, runtime, router, publisher, catalogue, clock. Plain
data (input, record, list, options bag) is not one.

## Keyword map and fixes

- `typeof dependency.method === "function"`, `typeof x === "function"` on a collaborator (`jskit/required-collaborators`)
  - Require the capability in `requires` and call it directly. When it is
    genuinely optional, declare an `optional` token whose default the package
    names and the receiving hook resolves once (`mailer ?? unconfiguredMailer`).
  - Keep `typeof` checks that validate what an application passed to a public
    entry point, such as `defineFeature()` checking a definition.
- `optional operation:` on a method every implementer has, a feature-gated operation
  - Make the operation required in the contract and call it. An operation
    that refuses when its feature is off is still implemented. The prefix is
    only for a contract method some real implementer lacks.
- `= null`, `= {}`, `= () => {}` on a collaborator or on the dependencies object, `if (!x) throw new TypeError("... requires x")` (`jskit/required-collaborators`, `jskit/typed-dependencies`)
  - Remove the default and the guard; the capability runtime already refuses
    to start without a required token.
  - Type the parameter with a JSDoc `@param` naming the owner's type: the
    owner's `./server/types`, `ReturnType<typeof createX>` inside a package, or
    a class name. Reference only subpaths the package exports.
  - Keep a default that is the production implementation (a clock,
    `globalThis.fetch`) and an options bag whose fields are optional by
    contract (`options = {}` with `trx` where callers may omit it).
- `fetchImpl = null`, `x || null`, `options.x || default` below the feature, a default or check that appears twice, `options?.` or `options || {}` after `options = {}` (`jskit/no-optional-after-default`)
  - Resolve the default once, at the feature or the public entry point, and
    pass the resolved value down as required. Delete the second default and
    the re-check of what the provider validated.
- `logger = null`, `if (!logger) return`, `logger = console`, `logger?.info`
  - Require the logger, typed `RuntimeLogger`. Use the kernel's `silentLogger`
    only where a real caller may omit it.
- `capability.service || capability`, two shapes, "tests pass the bare service" (`jskit/no-dual-shape`)
  - Accept one shape. Read `.service` on a CRUD capability, use a feature
    capability as it is, and give the test double the real shape.
- `create<Name>(dependencies)` with `dependencies.x` in the body, a pure helper passed in
  - Destructure in the signature and type it with `@param`. Import pure
    helpers (error mappers, id builders, validators) instead of passing them.
- `dependency?.method?.()`, `dependency?.method(` on a collaborator (`jskit/required-collaborators`)
  - Call `dependency.method()`. The collaborator is required, so the optional
    call only hides a wiring mistake.
- `setProvider`, `setResolver`, `setObserver`, `attach*`, any `set<Name>()` or `register<Name>()` that fills a one-value slot after construction (`jskit/no-slot-setter`)
  - Declare the slot as an `optional` token in the package that owns it, name
    its default beside it, and resolve it once at the receiving hook with
    `??`. The supplier provides the token from a small feature instead of
    calling the setter.
  - When the supplier requires the owner (a cycle), split the part of the owner
    that the supplier needs into its own feature. Until then keep the setter
    with `// readable-check: allow setter-seam - cycle: <supplier> requires <owner>`
    on the line before it.
- `register`, a module-level `register<Name>()` that writes module state, `let x` or a `WeakMap` filled in `boot()` (`jskit/no-module-registry`)
  - Supply the entries through a capability: a catalogue the feature receives,
    or an `optional` token. Build owned state in `setup()`, start it in
    `boot()`, stop it in `shutdown()` without `?.`.
  - `register()` on a catalogue the feature received (`http.router.register`,
    `bootstrap.register`, `events.register`) is a catalogue entry, not a
    registry; keep it.
- `X | null`, `X | undefined` below the hook, `null` passed into a factory
  - Type an absent optional token `X | null` only at the hook that receives
    it, resolve its named default there, and pass the result as required.
- `input || {}`, `input = {}`, `payload = {}`, `query = {}`, `input?.` in an action, a service method or a contract operation (`jskit/one-line-action`)
  - The action's input schema already validated the input, and a contract
    types what its operations receive. Remove the fallback from every method
    whose callers all pass a value; keep it on a method some caller invokes
    without arguments.
  - Destructure the input in the service instead of normalizing it again.
    Turn `input.x || d` into `{ x = d }` only after confirming that the schema
    rejects null and empty values for `x`.
- `async execute`, `execute(input) { … }`, `await` in an action, an envelope built in an action, a helper that builds actions or strips their input, input rebuilt in an action (`jskit/one-line-action`, `jskit/action-execute-shape`)
  - Write each definition literally and freeze it and the list. Make
    `execute` one call: `execute: (input, context) => service.method(input, { context })`.
  - The service returns the final result, its JSON:API document included.
  - A key the service must not see is destructured in the parameter list:
    `execute: ({ workspaceSlug, ...payload }, context) => service.update(workspaceSlug, payload, { context })`.
  - CRUD custom actions keep `execute: ({ input, context, service }) => service.method(...)`.
  - A wrapper that applies one application rule to every definition becomes
    data in each definition's `extensions` and one `runtime.actions.policy`
    the application provides.
- `mode: "patch"` on an action input that is not a partial update, or a guard in the service for a field the schema marks `required`
  - An action input with no `mode` is validated in create mode, so `required`
    is enforced and defaults are applied. Keep `mode: "patch"` only where the
    action updates part of a record; a command (start, invite, run) drops it,
    and its service drops the guards that only repeated `required`.
- `idempotency:` on an action definition, or an idempotency key in request metadata
  - Remove it: the kernel has no idempotency machinery and refuses the field.
    An action that must tolerate a repeated request handles it in its own
    domain (a unique key, an upsert, a state check) and says so in a comment
    where that is not obvious.
- `ActionSpecifications`, `run(service, input, context)`, `build<Name>Actions` mapper, positional `create<Name>Actions(service)`
  - Replace them with one `create<Name>Actions({ <service> })` whose
    definitions call the service in `execute`. Keep each id a string literal or
    a module-level string constant so the inspector finds the action.
- inline `actions() { return [{ ... }] }` in a feature
  - Move the array into an unexported `create<Name>Actions()` in the same
    file; do not add a file for it.
- `context?.actor`, `options.context.actor`, `requireRequestContext`, `{ request, context }` beside `{ context }`
  - Use one request-context form per package: one helper that reads the actor
    or workspace, the kernel's `resolveRequest(context)` for the request, and
    one way for actions to pass the context.
- a provided value built inline in `setup()`, a runtime factory in the feature file, a `types.js` missing, "Exports: None" for a `types.js` in an old package map
  - Build the value with a named `create<Name>` factory in its own module
    beside the feature (`<name>Runtime.js`).
  - Add `src/server/types.js` with one `@typedef` per provided token, named in
    PascalCase after the token, and export it as `./server/types`. A token
    with several implementations (`auth.service`) gets a hand-written contract
    in its owning package, with optional operations as optional properties.
  - Run `npm run agent-docs:build`; the package map lists each typedef as
    `type <Name>`.
- `(...args: any[]) => Promise<any>`, a type literal of methods, a package cycle
  - Import the owner's type. A JSDoc `import("…")` is type-only, so a package
    cycle is no reason to hand-write an interface.
- `ReturnType<typeof import(…)>` or `X["service"]`, `RuntimeDatabase["knex"]`, `import("knex").Knex` repeated in files (`jskit/named-repeated-type`)
  - Name the type once in the owner's `types.js` and import that name:
    `RuntimeKnex`, `RuntimeRouter`, crud-core's `CrudService` and
    `CrudRepository`, the package's own service type.
- `...factory(…)` in a token value or a returned API (`jskit/no-factory-spread`), `return { method() { … } }` from a `create*` (`jskit/frozen-factory-result`)
  - Build each factory once and name each member
    (`logout: sessions.logout`). Return `Object.freeze({ … })` of named inner
    functions. Spread only in `decorateService` or `decorateRepository` over
    the JSKIT CRUD service or repository.
- `// …` description line before a `/** */` block, a comment that says "was", "now", "until", "tests" (`jskit/jsdoc-description-inside`, `jskit/allow-comment-form`)
  - Move the description inside the JSDoc block. Delete comments that narrate
    history or cite tests; complete the test double instead of shaping the
    code around it.
- copied helper, function or arrow, file over 750 lines, function over 600 (`jskit/no-duplicate-helper`, `max-lines`, `max-lines-per-function`)
  - Keep one copy of each pure helper per package and import it.
  - Split a factory that has more than one concern.
- `boot*.js` holding routes, `actions.js` holding another concern's actions, `*Provider.js` holding a `defineFeature`, `build*` factories
  - Name files for what they hold: `<name>Routes.js`, `<name>Actions.js`,
    `<Name>Feature.js`, `<name>Runtime.js`. Factories and action creators are
    `create*`; `build*` names a pure data builder.

## Exceptions

A justified exception carries `// readable-check: allow <rule> - <reason>` on
the line before it. The reason starts with one of these prefixes and says what
is true of the code, never the state of a project or its tests
(`jskit/allow-comment-form` reports one that does not):

| Reason prefix | The exception |
| --- | --- |
| `input validation:` | a public library entry point checks a value an application passes it, and refuses a wrong one with its own error |
| `data:` | probes or defaults data (a route definition, a transport, a parsed record, an options list), not a collaborator; never a function itself, such as a repeated helper |
| `platform object:` | probes a host or library object reached internally, such as `Headers`, a fetch `Response` or a Knex transaction (`platform object: a Knex transaction`) |
| `optional operation:` | calls a contract method that some real implementer lacks, which the contract marks optional |
| `safety invariant: <what goes wrong>` | keeps a guard that protects an internal invariant, saying what goes wrong without it; the retired `test asserts error:` is reported |
| `not a slot:` | matched a name that fills no slot |
| `cycle: <supplier> requires <owner>` | keeps a setter because the slot's supplier requires its owner |
| `deferred until boot: <reason>` | keeps a capability handed out at setup and filled in `boot()`, such as the deferred `auth.service`: a two-phase value that is neither a cycle nor a setter |
| `filled by <repository>; convert with its supplier` | keeps a setter that another repository's code calls |
| `cross-repository slot <token>` | keeps a probe for a token another repository supplies |

One kind of probe gets one prefix and one wording everywhere, with or without
a finding.

Avoid:

- probing a collaborator before calling it
- defaulting a collaborator to `null`, `{}` or a no-op
- setters that fill a slot after construction
- module-level registries
- excusing a finding without a reason in its `readable-check: allow` comment
