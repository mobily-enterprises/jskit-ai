---
title: Client features
description: How JSKIT client code is written (composables, components, client factories and providers), rule by rule with a good and a bad example, and the lint rules that check it.
---

# Client features

Read this page before writing or reviewing JSKIT client code: a composable, a
Vue component, a client factory or a client provider. It is the client half of
[typed features](/guide/framework/typed-features): the same rule, the same
`readable-check: allow` vocabulary and the same size limits, applied to Vue.
`clientFeaturesConfig` makes the rules a machine can see errors
([checks](#checks)); the others are checked by reading.

The [client features heuristic](https://github.com/mobily-enterprises/jskit-ai/blob/main/packages/agent-docs/heuristics/client-features.md)
maps keywords and lint findings to the section that fixes them.

## The rule

> Every collaborator client code uses arrives through its options, props,
> injection or provider capabilities, typed where it is received and required,
> never probed, so each call has one visible destination.

- A **collaborator** is an object or function with behaviour that code calls:
  an adapter, an API client, a state object with methods, a callback, a router.
  Plain data (a label, a list, a record) is not one.
- A **composable** is a `use<Name>()` function that holds Vue state; a **client
  factory** is a `create<Name>()` that holds none.

## Simplicity

### Simple to reason about

**A reader follows each flow top to bottom: plain functions, direct calls,
names that say what they do.** Satisfying a rule by adding a layer, a
registry, a pass-through wrapper, meta-programming or a one-use abstraction is
wrong, and so is splitting a file into many tiny modules to meet a size limit.

Signs of over-cleverness: a `create*` that only forwards to another; handlers
built in a loop or from strings; `Object.fromEntries(… .map(…))` to build an
API; a `Proxy`; a factory used once; a registry for two entries; a module of
one three-line helper; files named `utils2`, `part1` or `…Helpers`.

Why: the rules exist so code is easy to follow; a contortion that silences one
defeats it.

```js
// good: the contract is required, so the calls are direct
function resend(messageId) {
  return controller.resend(messageId);
}

// bad: a computed layer that hides two probes
const operations = Object.fromEntries(["find", "resend"].map((name) => [name, (...args) => controller.value?.[name]?.(...args)]));
```

When a rule seems to force a contortion, take the direct reading that meets
its intent, and report the case so the rule can be narrowed.

## Types and collaborators

### Client types

**A package's client types live in `src/client/types.js`, exported as
`./client/types` when another package uses them: one `@typedef` per value its
client code hands out or receives across files.** That is a composable's
result (`ReturnType<typeof useX>`), a client factory's result, and each
contract an application implements, written once with its optional members
marked `?`. Kernel capabilities come from `@jskit-ai/kernel/client/types`:
`ClientComponents`, `ClientVueApp`, `ClientRouter`, `ClientPinia`,
`ClientQueryClient`, `ClientEnv`, `ClientSurfaceRuntime`, `ClientSurfaceMode`
and `ClientLogger`.

Why: a parameter that names its type sends a reader to one file.

```js
// good: src/client/types.js
/** @typedef {ReturnType<typeof import("./useAttachmentQueue.js").useAttachmentQueue>} AttachmentQueue */
/**
 * What an application supplies to render a conversation.
 * @typedef {object} ConversationAdapter
 * @property {(text: string) => Promise<void>} send
 * @property {MessageDelivery} [delivery] Present when the application tracks delivery.
 */
export {};

// bad: the shape is whatever the caller passed
function useConversationActions({ adapter }) {
```

### Typed options

**A composable, client factory or helper destructures its options in its
signature and types them with a JSDoc `@param`.** An options object's `= {}`
stays only where a real caller passes nothing and every member has its own
default.

Why: the same one-step reading as server code; `useX(options)` read in the
body hides what it needs.

```js
// good
/** @param {{ uploadAttachment: AttachmentUpload, onUploaded: (attachment: Attachment) => void }} options */
function useAttachments({ uploadAttachment, onUploaded }) {

// bad
function useAttachments(options = {}) {
  const upload = options.uploadAttachment;
```

### Required options

**A collaborator every real caller passes is required: no `= null`, `= {}` or
no-op default, no `typeof x === "function"` probe and no `x?.()` call.** A
default that is the production implementation stays (`now = Date.now`).

Why: a probe gives each call a second outcome that production never takes.

```js
// good
function useAttachments({ uploadAttachment }) {

// bad: every caller passes uploadAttachment, yet it is probed
function useAttachments({ uploadAttachment = null } = {}) {
  if (typeof uploadAttachment !== "function") return;
```

### Absent options

**What a real caller leaves out takes one of the server's two forms.** A
per-call callback (`onError`, `onProgress`) defaults to a named no-op and is
called plainly. An optional operation, a contract member some real caller
omits, is typed `?`, received with no default, probed once with an
`optional operation:` allow comment, and branched on that one boolean.

- When the member is read live (an application binding behind a getter), probe
  it where it is called, with one allow comment, through one local reader
  function when several sites call it.
- In a template, call it in the binding, `adapter.actions.reload?.()`, with one
  HTML allow comment directly above the element's opening tag; it covers that
  element's bindings, not its children's. Never `a?.b && a.b()`.
- A maybe-ref input (`MaybeRefOrGetter<T>`) is read with Vue's `toValue()`.
- A function whose one job is normalizing a documented external value of
  several shapes carries one `input validation:` allow comment directly above
  it, which covers the probes in its own body. Nowhere else: never over a
  composable, a `setup()` or a function that does more than normalize.

A test-only omission counts for none of these: complete the double.

Why: one spelling for "may be absent" across server and client, and one probe
instead of one per call.

```js
// good
function ignoreProgress() {}
function useUpload({ onProgress = ignoreProgress }) {
  onProgress(0);
}
/** @param {{ deleteAttachment?: AttachmentDelete }} options */
function useAttachments({ deleteAttachment }) {
  // readable-check: allow method-probe - optional operation: a read-only queue has no deleteAttachment, so removal stays local
  const canDelete = typeof deleteAttachment === "function";
}
const text = toValue(source);

// bad
function useUpload({ onProgress = null }) {
  onProgress?.(0);
}
const text = typeof source === "function" ? source() : source.value;
```

```html
<!-- good -->
<!-- readable-check: allow optional-call - optional operation: a read-only transcript has no reload -->
<v-btn :disabled="loading" @click="adapter.actions.reload?.()" />

<!-- bad -->
<v-btn v-if="adapter.actions?.reload" @click="adapter.actions.reload()" />
```

### Platform probes

**A probe of a host object lives in one helper per package,
`hasWindowFunction(name)`, with one `platform object:` allow comment, and is
imported.**

Why: one treatment per probe kind; copies of a `window` probe drift.

```js
// good: src/client/browser.js
/** Whether the page's window has the named function; outside a browser there is no window. */
function hasWindowFunction(name) {
  // readable-check: allow method-probe - platform object: window and its functions exist only in a browser
  return typeof window !== "undefined" && typeof window[name] === "function";
}

// bad, in five places
if (typeof window !== "undefined" && typeof window.clearTimeout === "function") window.clearTimeout(timer);
```

### Client providers

**A client provider follows the server's token rules: `requires`, `optional`
and `provides` one per line, hooks typed with the kernel's or the owner's
types, registration in `setup()`, a replaceable value as an `optional` token
with a named default, and no module-level registry.**

Why: client providers are capabilities like server features; a slot filled by
a setter or a module map has no visible owner.

```js
// good
const ConversationClientProvider = defineProvider({
  id: "conversation.web.client",
  requires: {
    components: "client.components"
  },
  /** @param {{ components: import("@jskit-ai/kernel/client/types").ClientComponents }} capabilities */
  setup({ components }) {
    components.register("conversation.web.settings.element", ConversationSettingsElement);
  }
});

// bad
const components = new Map();
export function registerComponent(id, component) { components.set(id, component); }
```

### Injected values

**`inject()` takes the owner's exported key, never a literal. A required value
is `inject(KEY)`; one that may be absent is `inject(KEY, NAMED_DEFAULT)` with
the named default exported beside the key. The binding names its type.** A
key another package owns is imported, with its type and disabled default, from
that package; a consumer that cannot depend on it writes the key in place,
typed, with a named `NO_*` default.

Why: injection is the client's capability lookup: one key, one type, one
resolution.

```js
// good
/** @type {import("@jskit-ai/workspaces-web/client/types").WorkspaceScopeSupport} */
const support = inject(WORKSPACE_SCOPE_KEY, NO_WORKSPACE_SCOPE);

// bad
const support = inject("workspaceScope", null);
if (!support || typeof support.readRouteScope !== "function") return FALLBACK;
```

## Components

### Collaborator props

**Every prop has a `type` and is required or has a real default. A prop the
component calls is `required: true`, typed with a `PropType` cast to its
typedef, and called without `?.`.** A collaborator prop that real callers
genuinely leave out keeps `default: null`, is typed `PropType<X | null>`,
carries one `optional operation:` allow comment and is branched on once.

Why: a `default: null` collaborator is a probe at every use; a chain of `?.`
calls on one adapter hides which parts are really optional.

```js
// good
const props = defineProps({
  state: { type: /** @type {import("vue").PropType<GoalState>} */ (Object), required: true }
});
const canSet = computed(() => !props.state.loading && props.state.available);

// bad
const props = defineProps({ state: { type: Object, default: null } });
const canSet = computed(() => typeof props.state?.set === "function");
```

### Declared emits

**`defineEmits()` lists every event the component emits, including those a
composable emits through the `emit` it receives.**

Why: the declaration is the component's event contract, and an undeclared
event also falls through as a DOM listener.

```js
// good
const emit = defineEmits(["close", "closed"]);

// bad
const emit = defineEmits(["close"]);
emit("closed");
```

### Presenting scripts

**A component's `<script>` presents: props, emits, element refs, display
`computed`s and handlers that call a composable or emit.** Requests, state
machines, timers, parsing and projections live in a composable or a plain
module, moved verbatim. Split by concern into a few cohesive pieces; a large
style block moves to `<style scoped src="./X.css">`. Never a subcomponent made
only to shrink a file: it changes scoped styles and slots.

Why: logic in a composable is read and tested without mounting a component.

```text
good: Transcript.vue (template and presentation), useTranscriptScroll.js,
      transcriptEntries.js (pure projection), Transcript.css via <style scoped src>
bad:  Transcript.vue, 1,600 lines: rendering, scroll anchoring, delivery state and 500 lines of CSS
```

## Composables

### Fixed result shape

**A composable returns one object literal of named members, the same on every
path: nothing assigned after construction, no spread of another composable's
result, no conditional keys, and never `Object.freeze`.** That includes a
result a callback builds: a wrapper passes what the result needs into the
callback instead of patching what it returned. An extension that needs the
object it extends is listed in the literal (`application: null`) and filled
once right after construction, with a `cycle:` allow comment. A plain
`create*` that holds no Vue state keeps `Object.freeze`.

Why: a fixed shape keeps the type true; and `reactive()` leaves a frozen
object unproxied while `proxyRefs()` (applied to a `setup()` return and to
`defineExpose()`) throws on one, so Vue state is never frozen.

```js
// good
const suggestions = useSuggestions();
return { messages, send, suggestions };
const runtime = app.runWithContext(() => createRuntime(readers, retain));

// bad
return Object.freeze({ messages, send, ...useSuggestions() });
const runtime = app.runWithContext(() => createRuntime(readers));
runtime.retain = retain;
```

### Effect order

**Splitting a composable keeps its `watch()` and `watchEffect()` calls in the
original composable, in their creation order, calling the extracted module's
functions.**

Why: pre-flush watchers in one scope run in trigger order, so moving them into
a helper composable can reorder an application's callbacks.

```js
// good: useConversation.js keeps its watchers in order
watch(messages, (next) => scroll.follow(next));
watch(draft, (text) => drafts.save(text));

// bad: one watcher moved into useDrafts(), now created before the scroll watcher
const drafts = useDrafts(draft);
watch(messages, (next) => scroll.follow(next));
```

### Released listeners

**Everything client code starts, it stops: each `addEventListener`,
`setInterval`, observer and `.on()` is released in `onScopeDispose` or
`onBeforeUnmount`, or registered with `{ once: true }` or an `AbortSignal`
aborted there.** A listener on an object the code creates with `new` and drops
with it (its own socket, closed in `disconnect`) goes with that object.

Why: a listener that outlives its component leaks memory and fires against
unmounted state.

```js
// good
onMounted(() => window.addEventListener("resize", measure));
onBeforeUnmount(() => window.removeEventListener("resize", measure));

// bad
onMounted(() => window.addEventListener("resize", () => measure()));
```

### Module state

**State lives inside the composable or factory that owns it. A module-level
`let`, `ref()` or `reactive()` exists only when every instance on the page
must share it, with a `shared resource:` allow comment.** A private memo
cache nothing fills from outside stays.

Why: module scope is shared by every component instance and every application
on the page, and survives unmounting.

```js
// good: each composer owns its draft
function useComposer() {
  const draft = ref("");
}
// readable-check: allow module-state - shared resource: every attachment queue on the page draws ids from one sequence
let attachmentClientSequence = 0;

// bad: every composer on the page shares one draft
let pendingDraft = "";
```

## Helpers and sizes

### One helper per package

**A pure helper exists once in a package and is imported; one the kernel owns
(`isRecord`, `normalizeText`) comes from
`@jskit-ai/kernel/shared/support/normalize`; one client and server code both
need lives in the package's `src/shared`.**

Why: copies drift, and the next reader cannot tell which is right.

```js
// good
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

// bad: a copy in src/client/lib/api.js
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
```

### Size limits

**Files stay under 750 lines and functions under 600; a `.vue` file counts
whole: template, script and style.** Split by concern
([presenting scripts](#presenting-scripts)), never into tiny modules
([simple to reason about](#simple-to-reason-about)).

Why: a reader holds one concern at a time.

```text
good: Transcript.vue 420 lines, useTranscriptScroll.js 180, transcriptEntries.js 240
bad:  Transcript.vue 1,600 lines; or eight 90-line files named transcriptPart1.js to transcriptPart8.js
```

## Checks

### Running the checks

`clientFeaturesConfig(globs)` makes the client rules errors for the client
code the globs select, Vue components included and tests excluded. A new
application lists all of it; an existing one lists each client tree as it
converts it, and nothing else changes until it does:

```js
import { baseConfig, clientFeaturesConfig, typedFeaturesConfig, vueConfig } from "@jskit-ai/config-eslint/server";

export default [
  ...baseConfig,
  ...typedFeaturesConfig(["packages/*/src/server/**", "packages/*/src/shared/**"]),
  ...vueConfig,
  ...clientFeaturesConfig(["packages/*/src/client/**", "src/**"])
];
```

It runs the typed-features rules that read client code, with `use*`
composables counted as factories and templates read for probes, and the
client-only rules below. The server's action and error rules do not apply.

### Lint rules

| Rule | Reports | Section |
| --- | --- | --- |
| `jskit/typed-inject` | `inject()` with a literal key, an untyped binding, or a `null` / `{}` default | [Injected values](#injected-values) |
| `jskit/collaborator-props` | a prop the component calls that is optional with no named default, or typed only `Object` | [Collaborator props](#collaborator-props) |
| `jskit/fixed-result-shape` | behaviour assigned to a `use*` / `create*` result after it is built, also one a wrapper's callback built | [Fixed result shape](#fixed-result-shape) |
| `jskit/no-frozen-vue-state` | `Object.freeze` over refs, computeds or reactive state | [Fixed result shape](#fixed-result-shape) |
| `jskit/released-listeners` | a listener, interval, observer or subscription the file starts and never releases | [Released listeners](#released-listeners) |
| `jskit/no-module-state` | a module-level `let`, `ref()` or `reactive()` | [Module state](#module-state) |
| `vue/require-prop-types`, `vue/require-default-prop`, `vue/require-valid-default-prop`, `vue/no-required-prop-with-default` | a prop without a type, optional without a default, or both | [Collaborator props](#collaborator-props) |
| `vue/require-explicit-emits` | an emitted event the component does not declare | [Declared emits](#declared-emits) |

The typed-features rules keep their own sections:
[`typed-dependencies`](/guide/framework/typed-features#typed-collaborators),
[`required-collaborators`](/guide/framework/typed-features#required-collaborators),
[`no-duplicate-helper`](/guide/framework/typed-features#one-helper-per-package),
[`no-factory-spread`](/guide/framework/typed-features#named-members) and the
rest. In client code, `no-slot-setter` reports only a setter named like a slot
(`setProvider`), `frozen-factory-result` leaves Vue state unfrozen, and
`no-duplicate-helper` compares a client helper with the whole package, server
and shared code included.

Simplicity, effect order and presenting scripts are checked by reading.

### Exceptions

Client exceptions use the
[typed features exceptions](/guide/framework/typed-features#exceptions): a
comment on the line before the finding, naming the rule or the finding, with a
reason prefix. Client code adds three placements:

| Placement | The exception |
| --- | --- |
| `// readable-check: allow module-state - shared resource: <what the page shares>` | module state every instance on the page shares on purpose |
| `<!-- readable-check: allow optional-call - optional operation: <what lacks it> -->` above an element | that element's bindings call an optional operation |
| `// readable-check: allow method-probe - input validation: <the shapes>` above a function | the probes of a function whose one job is normalizing an external value of several shapes |
