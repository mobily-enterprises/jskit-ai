<!-- Generated from `packages/agent-docs/heuristics/typed-features.md`. -->

# Typed Feature Heuristics

Use when:

- writing or reviewing a server feature, provider, action, service or repository
- a `jskit/*` lint rule from `@jskit-ai/config-eslint` reports a finding
- a collaborator is probed, defaulted to nothing, or filled in after construction

Read [Typed features](../typed-features.md) for the rule,
the worked example (users-core's account preferences) and slots.

A *collaborator* is an object or function with behaviour that code calls:
service, store, repository, runtime, router, publisher, catalogue, clock. Plain
data (input, record, list, options bag) is not one.

## Keyword map and fixes

- `typeof dependency.method === "function"`, `typeof x === "function"` on a collaborator (`jskit/required-collaborators`)
  - Require the capability in `requires` and call it directly. When it is
    genuinely optional, declare an `optional` token whose default the package
    names and `setup()` resolves once (`events || createEventRuntime()`).
  - Keep `typeof` checks that validate what an application passed to a public
    entry point, such as `defineFeature()` checking a definition.
- `= null`, `= {}`, `= () => {}` on a collaborator or on the dependencies object, `if (!x) throw new TypeError("... requires x")` (`jskit/required-collaborators`, `jskit/typed-dependencies`)
  - Remove the default and the guard; the capability runtime already refuses
    to start without a required token.
  - Type the parameter with a JSDoc `@param` naming the owner's type: the
    owner's `./server/types`, `ReturnType<typeof createX>` inside a package, or
    a class name. Reference only subpaths the package exports.
  - Keep a default that is the production implementation (a clock,
    `globalThis.fetch`) and an options bag whose fields are optional by
    contract (`options = {}` with `trx` or `context`).
- `dependency?.method?.()`, `dependency?.method(` on a collaborator (`jskit/required-collaborators`)
  - Call `dependency.method()`. The collaborator is required, so the optional
    call only hides a wiring mistake.
- `setProvider`, `setResolver`, `setObserver`, any `set<Name>()` that fills a slot after construction (`jskit/no-slot-setter`)
  - Declare the slot as an `optional` token in the package that owns it, name
    its default beside it, and resolve it once in `setup()`. The supplier
    provides the token instead of calling the setter.
  - When the supplier requires the owner (a cycle), split the part of the owner
    that the supplier needs into its own feature. Until then keep the setter
    with `// readable-check: allow setter-seam - cycle: <supplier> requires <owner>`
    on the line before it.
- `register`, a module-level `register<Name>()` that writes module state (`jskit/no-module-registry`)
  - Supply the entries through a capability: a catalogue the feature receives,
    or an `optional` token.
  - `register()` on a catalogue the feature received (`http.router.register`,
    `bootstrap.register`, `events.register`) is a catalogue entry, not a
    registry; keep it.
- `input || {}`, `input = {}`, `input?.` in an action or in a service method (`jskit/one-line-action`)
  - The action's input schema already validated the input. Remove the
    fallback from every method whose callers all pass validated input; keep it
    on a method some caller invokes without arguments.
  - Make `execute` one call to one service method:
    `execute: (input, context) => service.method(resolveRequest(context), input)`.
  - Destructure the input in the service instead of normalizing it again.
    Turn `input.x || d` into `{ x = d }` only after confirming that the schema
    rejects null and empty values for `x`.
- `ActionSpecifications`, `run(service, input, context)`, `build<Name>Actions` mapper
  - Replace them with one `create<Name>Actions({ <service> })` whose
    definitions call the service in `execute`. Keep each id a string literal or
    a module-level string constant so the inspector finds the action.
- inline `actions() { return [{ ... }] }` in a feature
  - Move the array into an unexported `create<Name>Actions()` in the same
    file; do not add a file for it.
- a provided value built inline in `setup()`, a `types.js` missing, "Exports: None" for a `types.js` in an old package map
  - Build the value with a named `create<Name>` factory in its own module
    beside the provider.
  - Add `src/server/types.js` with one `@typedef` per provided token, named in
    PascalCase after the token, and export it as `./server/types`. A token
    with several implementations (`auth.service`) gets a hand-written contract
    in its owning package, with optional operations as optional properties.
  - Run `npm run agent-docs:build`; the package map lists each typedef as
    `type <Name>`.
- copied helper, file over 750 lines, function over 600 (`jskit/no-duplicate-helper`, `max-lines`, `max-lines-per-function`)
  - Keep one copy of each pure helper per package and import it.
  - Split a factory that has more than one concern.

## Exceptions

A justified exception carries `// readable-check: allow <rule> - <reason>` on
the line before it. The reason starts with one of these prefixes and says what
is true of the code, never the state of a project:

| Reason prefix | The exception |
| --- | --- |
| `input validation:` | checks a value its caller passes and refuses a wrong one with its own error |
| `data:` | probes data (a route definition, a transport, a parsed record), not a collaborator |
| `platform object:` | probes a platform or library object whose implementations differ, such as `Headers` |
| `optional operation:` | calls an operation the collaborator's type marks optional |
| `test asserts error:` | keeps a guard whose error a test asserts |
| `not a slot:` | matched a name that fills no slot |
| `cycle: <supplier> requires <owner>` | keeps a setter because the slot's supplier requires its owner |
| `deferred until boot: <reason>` | keeps a capability handed out at setup and filled in `boot()`, such as the deferred `auth.service` |
| `filled by <repository>; convert with its supplier` | keeps a setter that another repository's code calls |
| `cross-repository slot <token>` | keeps a probe for a token another repository supplies |

Avoid:

- probing a collaborator before calling it
- defaulting a collaborator to `null`, `{}` or a no-op
- setters that fill a slot after construction
- module-level registries
- excusing a finding without a reason in its `readable-check: allow` comment
