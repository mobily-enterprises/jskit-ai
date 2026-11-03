# @jskit-ai/config-eslint

Shared flat ESLint presets for JSKIT projects.

```js
// eslint.config.mjs
import {
  baseConfig,
  clientFeaturesConfig,
  formatterConfig,
  nodeConfig,
  sizeLimitsConfig,
  typedFeaturesConfig,
  vueConfig,
  webConfig
} from "@jskit-ai/config-eslint/server";

const SERVER_SOURCES = ["packages/*/src/server/**", "packages/*/src/shared/**", "server/**", "server.js"];
const CLIENT_SOURCES = ["packages/*/src/client/**", "src/**"];
const HAND_WRITTEN_SOURCES = ["packages/*/src/**", "src/**", "config/**", "server/**", "server.js", "bin/**"];

export default [
  ...baseConfig,
  ...typedFeaturesConfig(SERVER_SOURCES),
  ...sizeLimitsConfig(HAND_WRITTEN_SOURCES),
  ...vueConfig,
  ...clientFeaturesConfig(CLIENT_SOURCES),
  ...webConfig,
  ...nodeConfig,
  ...formatterConfig([...SERVER_SOURCES, "config/**", "bin/**"])
];
```

- `baseConfig`: ESLint's recommended rules, JSKIT's import policy and, as
  warnings on `**/src/server/**`, the typed-features rules.
- `typedFeaturesConfig(globs)`: the typed-features rules and the size limits,
  as errors, for the server and shared code the globs select.
- `clientFeaturesConfig(globs)`: the client rules, as errors, for the client
  code the globs select, Vue components included; list it after `vueConfig`.
- `sizeLimitsConfig(globs)`: files under 750 lines and functions under 600, as
  errors, for every hand-written file the globs select, client code and Vue
  components included.
- `formatterConfig(globs)`: the formatter.
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

The `jskit` plugin checks the rules of the
[typed features guide](https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features),
the one place JSKIT explains how server code is written. Its
[lint rules table](https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#lint-rules)
lists what each rule reports, every finding ends with a link to the section
that explains it, and its
[exceptions](https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features#exceptions)
give the `readable-check: allow` comment and its reason prefixes.

`baseConfig` reports the rules as warnings, so adopting a new version does not
fail a build. `typedFeaturesConfig(globs)` makes them errors for the globs you
list; an existing application adds each package as it converts it. The rules
cover every module a capability value is built from, so list a package's
shared modules too (`packages/billing/src/shared/**`). Test files and `test`,
`tests`, `client`, `components` and `pages` directories are not checked.

## Client features

`clientFeaturesConfig(globs, severity = "error")` holds composables, Vue
components, client factories and client providers to the
[client features guide](https://mobily-enterprises.github.io/jskit-ai/guide/framework/client-features):
the typed-features rules that read client code, with `use*` composables
counted as factories and component templates read for probes and optional
calls, plus `typed-inject`, `collaborator-props`, `fixed-result-shape`,
`no-frozen-vue-state`, `released-listeners`, `no-module-state` and
`eslint-plugin-vue`'s prop and emit rules. The server's action and error rules
do not apply, a composable is never held to `Object.freeze`, and
`no-duplicate-helper` compares a client helper with the whole package. Nothing
changes for client code until a glob selects it, so an existing application
lists each client tree as it converts it. In a template, one
`<!-- readable-check: allow <rule> - <reason> -->` above an element excuses
that element's bindings.

`sizeLimitsConfig(globs, { ignores })` holds the rest of the hand-written code
to the size limits; tests are not checked, and `ignores` leaves generated
output alone. A generated or static data module is exempt through its first
line, `/* eslint-disable max-lines -- data: <how it is produced> */`.

`one-line-action` leaves CRUD custom actions' `execute({ input, service, … })`
alone, also when it takes only part of that object (`({ service, context })`):
that is the CRUD declaration's own contract. `no-duplicate-helper` and
`named-repeated-type` compare a file with the rest of its package. Both treat a
pattern's example application (an `example` directory beside a `PATTERN.md`)
as a package of its own, skip `templates` and `patterns` directories inside a
package, and leave the agent skill bundle's generated copies under
`skills/jskit/references/patterns` to their sources. `app-error-code` follows
the error classes a module declares, and compares codes and sentences within
one module.
