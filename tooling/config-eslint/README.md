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
| `jskit/one-line-action` | `input = {}`, `input \|\| {}` or `input?.` in an action's `execute` or an actions file |
| `jskit/no-duplicate-helper` | a small top-level helper that repeats one in another file of the package's server code |
| `max-lines`, `max-lines-per-function` | files over 750 lines, functions over 600 |

`baseConfig` reports them as warnings, so adopting a new version does not fail
a build. `typedFeaturesConfig(globs)` makes them errors for the globs you list:
add each package as you convert it. Test files and `test`, `client` and
`shared` directories are not checked.

A justified exception carries a comment on the line before it, naming the rule
(`one-line-action`) or the finding (`input-fallback`):

```js
// readable-check: allow setter-seam - cycle: terminals requires database tools
setProvider(next) { provider = next; }
```

The two size limits are ESLint's own rules; excuse them with
`// eslint-disable-next-line max-lines-per-function -- <reason>`.
