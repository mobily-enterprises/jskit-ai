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

## Formatter

`formatterConfig(globs)` is the one formatter config of a JSKIT application, as
errors, for the source files the globs select (tests are not formatted):

```js
// eslint.config.mjs
import { baseConfig, formatterConfig, typedFeaturesConfig } from "@jskit-ai/config-eslint/server";

const SERVER_SOURCES = ["packages/*/src/server/**", "packages/*/src/shared/**", "server/**", "server.js"];

export default [
  ...baseConfig,
  ...typedFeaturesConfig(SERVER_SOURCES),
  // Published upgrade scripts never change, so the formatter leaves them alone.
  ...formatterConfig(SERVER_SOURCES, { ignores: ["packages/core/src/server/upgrades/**"] })
];
```

- Width 140 for code, comments and JSDoc prose. Strings, template literals,
  regular expressions, URLs, `readable-check: allow` comments, ESLint
  directives and JSDoc type tags may run past it, so long prose stays inline.
- Semicolons, double quotes (template literals allowed), no trailing commas,
  no space before a named function's parentheses, no repeated or trailing
  spaces.
- A one-line body without braces stays beside its `if` (`if (!x) return null;`);
  an `if`/`else` chain braces all its bodies or none, and a line holds at most
  two statements.
- An object whose properties span lines puts each property on its own line,
  with its braces on their own lines; a call whose arguments span lines breaks
  after `(` and before `)`.
- A braced block spans lines (`1tbs`: `} else {` on the closing brace's line),
  and code is indented by two spaces, `case` inside `switch` by one level and a
  ternary's object, array or function branch past its `?`.

`eslint --fix` fixes all of these except the width and the statements per line,
and its output passes them: a block it braces or an argument list it breaks is
re-indented in the same run.

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
| `jskit/one-line-action` | `input = {}`, `input \|\| {}` or `input?.` in an action's `execute` or an actions file; an `async` `execute`; an action definition, or a list of them, that is neither `Object.freeze`d nor inside the kernel's `deepFreeze(…)` |
| `jskit/no-duplicate-helper` | a small top-level helper, a function or a `const` arrow, that repeats one in another file of the package's server code (a named no-op is not a helper) |
| `jskit/allow-comment-form` | a `readable-check: allow` comment whose reason has no fixed prefix, cites tests, cites the state of a project, or gives `data:` for a function (a parameter default's `dependency-default` / `required-collaborators` reason aside) |
| `jskit/jsdoc-description-inside` | a `//` line comment directly above a `/** */` block, whose description belongs inside it |
| `jskit/no-dual-shape` | a value accepted in two shapes: `x.service \|\| x`, `x?.value ?? x`, `x.service ? x.service : x` |
| `jskit/named-repeated-type` | a `ReturnType<…>` or indexed JSDoc type (`X["y"]`) written in two or more files of a package, instead of named once in its `types.js` |
| `jskit/action-execute-shape` | an action's `execute` that is not one expression-bodied arrow making one call: a method or block body, a helper-built `execute: helper(…)`, a bare reference, or a body that builds a result or makes a second call |
| `jskit/no-factory-spread` | a `create*()` result spread into a factory's frozen API or a `setup()` token value; a `decorateService`/`decorateRepository` may spread the CRUD service or repository, and data may be spread |
| `jskit/no-optional-after-default` | `x?.` or a second `x || {}` / `x ?? []` on a parameter that already has a present default (`options = {}`, `{ env = {} } = {}`, `items = []`, `name = ""`), so the value is never absent where it is read; a parameter that may be null takes no default and keeps its `?.` |
| `jskit/frozen-factory-result` | a `create*` factory that returns behaviour in an object that is not `Object.freeze`d, or defines a member inline (a method or function expression) instead of naming an inner function; a factory returning plain data and an action definition are left alone |
| `jskit/one-property-per-line` | two properties on one line in the `Object.freeze({ … })` a `return` statement returns, or in the `requires`, `optional` or `provides` map of a `defineFeature`/`defineProvider` call; `eslint --fix` breaks the object after `{`, after each `,` and before `}` |
| `max-lines`, `max-lines-per-function` | files over 750 lines, functions over 600 |

`baseConfig` reports them as warnings, so adopting a new version does not fail
a build. `typedFeaturesConfig(globs)` makes them errors for the globs you list:
add each package as you convert it. The rules cover every module a capability
value is built from, so list a package's shared modules too
(`packages/billing/src/shared/**`). Test files and `test`, `tests`, `client`,
`components` and `pages` directories are not checked.

`one-line-action` leaves CRUD custom actions' `execute({ input, service, … })`
alone, also when it takes only part of that object (`({ service, context })`):
that is the CRUD declaration's own contract. `no-duplicate-helper` and
`named-repeated-type` compare a file with the rest of its package. Both treat a
pattern's example application (an `example` directory beside a `PATTERN.md`)
as a package of its own, skip `templates` and `patterns` directories inside a
package, and leave the agent skill bundle's generated copies under
`skills/jskit/references/patterns` to their sources.

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
| `data:` | probes or defaults data (a route definition, a transport, a parsed record, an options list), not a collaborator; never a function itself, such as a repeated helper |
| `platform object:` | probes a platform or library object whose implementations differ, such as `Headers` |
| `optional operation:` | calls an operation the collaborator's type marks optional |
| `safety invariant: <what goes wrong>` | keeps a guard that protects an internal invariant, saying what goes wrong without it (the retired `test asserts error:` is reported) |
| `not a slot:` | matched a name that fills no slot |
| `cycle: <supplier> requires <owner>` | keeps a setter because the slot's supplier requires its owner |
| `deferred until boot: <reason>` | keeps a capability handed out at setup and filled in `boot()`, such as the deferred `auth.service` |
| `filled by <repository>; convert with its supplier` | keeps a setter that another repository's code calls |
| `cross-repository slot <token>` | keeps a probe for a token another repository supplies |

The two size limits are ESLint's own rules; excuse them with
`// eslint-disable-next-line max-lines-per-function -- <reason>`.
