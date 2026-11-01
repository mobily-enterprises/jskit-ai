# @jskit-ai/config-eslint

Shared flat ESLint presets for JSKIT projects.

```js
// eslint.config.mjs
import { baseConfig, nodeConfig, typedFeaturesConfig, vueConfig, webConfig } from "@jskit-ai/config-eslint/server";

export default [
  ...baseConfig,
  ...vueConfig,
  ...webConfig,
  ...nodeConfig,
  // Packages already converted to typed features keep following them.
  ...typedFeaturesConfig(["packages/billing/src/server/**"])
];
```

- `baseConfig`: ESLint's recommended rules, JSKIT's import policy and, as
  warnings on `**/src/server/**`, the typed-features rules below.
- `nodeConfig`, `webConfig`: Node and browser globals.
- `vueConfig`: `eslint-plugin-vue`'s recommended rules.

## Typed features

A feature receives every collaborator through its declared capabilities, typed
where it is received and required, never probed. The `jskit` plugin reports
code that does not:

| Rule | Reports |
|---|---|
| `jskit/typed-dependencies` | a `create*`/`build*` factory or constructor that receives collaborators without a JSDoc `@param` type |
| `jskit/required-collaborators` | a collaborator defaulted to nothing (`null`, `{}`, a no-op), a `typeof x.y === "function"` probe, an `x.y?.()` call |
| `jskit/no-slot-setter` | a returned `set<Name>()` that fills a slot after construction, or a call that fills one |
| `jskit/no-module-registry` | a module-level `register<Name>()` that writes module state |
| `jskit/one-line-action` | `input = {}`, `input \|\| {}` or `input?.` in an action's `execute` or an actions file; an `async` `execute`; an action definition, or a list of them, that is not `Object.freeze`d |
| `jskit/no-duplicate-helper` | a small top-level helper, a function or a `const` arrow, that repeats one in another file of the package's server code (a named no-op is not a helper) |
| `jskit/allow-comment-form` | a `readable-check: allow` comment whose reason has no fixed prefix, cites tests, or cites the state of a project |
| `jskit/jsdoc-description-inside` | a `//` line comment directly above a `/** */` block, whose description belongs inside it |
| `jskit/no-dual-shape` | a value accepted in two shapes: `x.service \|\| x`, `x?.value ?? x`, `x.service ? x.service : x` |
| `jskit/named-repeated-type` | a `ReturnType<…>` or indexed JSDoc type (`X["y"]`) written in two or more files of a package, instead of named once in its `types.js` |
| `jskit/action-execute-shape` | an action's `execute` that is not one expression-bodied arrow making one call: a method or block body, a helper-built `execute: helper(…)`, a bare reference, or a body that builds a result or makes a second call |
| `jskit/no-factory-spread` | a `create*()` result spread into a factory's frozen API or a `setup()` token value; a `decorateService`/`decorateRepository` may spread the CRUD service or repository, and data may be spread |
| `jskit/frozen-factory-result` | a `create*` factory that returns behaviour in an object that is not `Object.freeze`d, or defines a member inline (a method or function expression) instead of naming an inner function; a factory returning plain data and an action definition are left alone |
| `max-lines`, `max-lines-per-function` | files over 750 lines, functions over 600 |

`baseConfig` reports them as warnings, so adopting a new version does not fail
a build. `typedFeaturesConfig(globs)` makes them errors for the globs you list:
add each package as you convert it. The rules cover every module a capability
value is built from, so list a package's shared modules too
(`packages/billing/src/shared/**`). Test files and `test`, `tests`, `client`,
`components` and `pages` directories are not checked.

`one-line-action` leaves CRUD custom actions' `execute({ input, service, … })`
alone: that is the CRUD declaration's own contract. `no-duplicate-helper`
treats a pattern's example application (an `example` directory beside a
`PATTERN.md`) as a package of its own, and skips the agent skill bundle's
generated copies under `skills/jskit/references/patterns`.

A justified exception carries a comment on the line before it, naming the rule
(`one-line-action`) or the finding (`input-fallback`, `async-execute`,
`unfrozen-action`):

```js
// readable-check: allow setter-seam - cycle: terminals requires database tools
setProvider(next) { provider = next; }
```

The reason starts with one of these prefixes and says what is true of the
code, never the state of a project:

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

The two size limits are ESLint's own rules; excuse them with
`// eslint-disable-next-line max-lines-per-function -- <reason>`.
