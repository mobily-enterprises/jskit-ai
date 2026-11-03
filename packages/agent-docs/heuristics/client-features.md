# Client Feature Heuristics

Use when:

- writing or reviewing a composable, Vue component, client factory or client provider
- a `jskit/*` or `vue/*` finding from `clientFeaturesConfig` is reported
- a prop, injected value or option is probed, defaulted to nothing, or patched on after construction

[Client features](../site/guide/framework/client-features.md) is the one guide
for client code: each rule says what to do, why, and shows good and bad code.
Server code follows [typed features](../site/guide/framework/typed-features.md).

Simple to reason about comes first. Write plain functions and direct calls. If
a rule seems to need a layer, a registry, a wrapper, a computed API or a split
into tiny modules, the reading is wrong: take the direct form that meets the
rule's intent, and report the case.

## Keyword map

- a layer, wrapper, `Proxy`, `Object.fromEntries` API, one-use factory, `utils2`, `part1`, a file split only to fit a size limit
  - [Simple to reason about](../site/guide/framework/client-features.md#simple-to-reason-about)
- `ReturnType<typeof useX>` repeated, an adapter shape nobody wrote down, `./client/types`, `@jskit-ai/kernel/client/types`
  - [Client types](../site/guide/framework/client-features.md#client-types)
- `useX(options)` read in the body, an untyped composable option (`jskit/typed-dependencies`)
  - [Typed options](../site/guide/framework/client-features.md#typed-options)
- `= null`, `= {}`, `typeof x === "function"`, `x?.()` on an option every caller passes (`jskit/required-collaborators`)
  - [Required options](../site/guide/framework/client-features.md#required-options)
- `onX = () => {}`, `optional operation:`, a getter-backed binding, `?.()` in a template, `typeof source === "function" ? source() : source.value`, an upload result of several shapes
  - [Absent options](../site/guide/framework/client-features.md#absent-options)
- `typeof window`, `matchMedia`, `requestAnimationFrame`, `hasWindowFunction`, `platform object:`
  - [Platform probes](../site/guide/framework/client-features.md#platform-probes)
- `defineProvider` on the client, a module `Map` of components, `register<Name>()`
  - [Client providers](../site/guide/framework/client-features.md#client-providers)
- `inject("key")`, `inject(KEY, null)`, `inject(KEY, {})` (`jskit/typed-inject`)
  - [Injected values](../site/guide/framework/client-features.md#injected-values)
- `type: Object, default: null` on a prop the component calls, `adapter: Object` (`jskit/collaborator-props`, `vue/require-default-prop`)
  - [Collaborator props](../site/guide/framework/client-features.md#collaborator-props)
- an event emitted but not declared (`vue/require-explicit-emits`)
  - [Declared emits](../site/guide/framework/client-features.md#declared-emits)
- a long `<script setup>`, requests or timers in a component, `<style scoped src>`
  - [Presenting scripts](../site/guide/framework/client-features.md#presenting-scripts)
- `runtime.x = …` after `useX()`, `Object.assign` onto a result, `...useX()` in a result, `Object.freeze` on a composable (`jskit/fixed-result-shape`, `jskit/no-frozen-vue-state`, `jskit/no-factory-spread`)
  - [Fixed result shape](../site/guide/framework/client-features.md#fixed-result-shape)
- `watch()` moved into a helper composable while splitting
  - [Effect order](../site/guide/framework/client-features.md#effect-order)
- `addEventListener` without `removeEventListener`, `setInterval`, `ResizeObserver`, `.on()` without `.off()` (`jskit/released-listeners`)
  - [Released listeners](../site/guide/framework/client-features.md#released-listeners)
- a module-level `let`, `ref()` or `reactive()`, `shared resource:` (`jskit/no-module-state`)
  - [Module state](../site/guide/framework/client-features.md#module-state)
- a copied `isRecord` or `normalizeText` in client code, a client copy of a server helper (`jskit/no-duplicate-helper`)
  - [One helper per package](../site/guide/framework/client-features.md#one-helper-per-package)
- a `.vue` file over 750 lines (`max-lines`)
  - [Size limits](../site/guide/framework/client-features.md#size-limits)
- `clientFeaturesConfig`, which globs to list, an existing application's client tree
  - [Running the checks](../site/guide/framework/client-features.md#running-the-checks)

Avoid:

- probing a prop, option or injected value before calling it
- freezing a composable's result or anything holding refs
- patching members onto a result after it is built
- listeners, intervals and observers that outlive their component
- module-level state that is not one per page on purpose
- abstractions added only to satisfy a rule
