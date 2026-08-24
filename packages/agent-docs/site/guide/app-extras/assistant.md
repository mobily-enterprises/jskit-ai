# Assistant

`@jskit-ai/assistant-runtime` supplies a reusable assistant runtime, client
elements, actions, persistence, and settings behavior. The application decides
where an assistant belongs and composes its pages directly.

```bash
npm install @jskit-ai/assistant-runtime
npm run db:migrate
```

Use the `assistant/assistant-surface` pattern. There is no assistant generator.

## Product decisions

Choose:

- the runtime surface and settings surface;
- global or workspace configuration scope;
- page routes and placement roles;
- provider and model policy;
- whether the assistant begins disabled until credentials exist.

The application records an environment prefix, never an API key, in source.
Secrets arrive through the normal deployment or development environment.

## Composition

Use `AssistantSurfaceClientElement` and
`AssistantSettingsClientElement` from `@jskit-ai/assistant-runtime/client`.
Configure public surface behavior and server settings in ordinary app-owned
config, then register routes and placements like any other feature.

Workspace scope is valid only when both the runtime and its settings surface
are workspace-aware. Requests must retain the selected workspace through the
server action boundary.

## Action tools

The assistant reads automation-capable actions from `runtime.actions`. It keeps
the typing user's actor, permissions, target surface, and workspace context,
then executes through `runtime.actions.execute()` with the `automation`
channel. When workspace context resolves `workspaceSlug`, the tool schema hides
that field and execution overwrites any model-supplied value with the trusted
context value.

An action is available as a tool only when it has an input contract and a
truthful model-facing output contract. Ordinary actions use their normal
`output`. An action whose native result needs a different model-facing shape
can declare the adapter-specific contract and transformation explicitly:

```js
{
  input,
  output: null,
  extensions: {
    assistant: {
      description: "List books.",
      output: booksResource.operations.list.output,
      transformResult(result, { input, context }) {
        return toAssistantBookList(result, { input, context });
      }
    }
  }
}
```

The assistant validates the transformed result against
`extensions.assistant.output` before returning it to the model. Generated
JSON:API CRUD actions supply these assistant contracts and transformations
automatically; their native action and HTTP result shapes do not change.

Generated list and view actions use JSON:API query shapes directly. `include`
is a comma-separated string, and `fields` is keyed by resource type:

```json
{
  "include": "pet",
  "fields": {
    "bookings": ["petId"],
    "pets": ["name"]
  },
  "limit": 5
}
```

Sparse primary fields remain sparse in the result. Requested included records
use the resource's lookup container and relationship name, for example
`items[0].lookups.pet.name`. Invalid array forms such as `include: ["pet"]` or
`fields: ["pet.name"]` are rejected with field-specific shape guidance. A
relationship name is not a fieldset key: for a `pet` relationship whose
JSON:API resource type is `pets`, use `fields: { "pets": ["name"] }`, not
`fields: { "pet": ["name"] }`. Generated contracts enumerate the allowed
resource-type keys and reject relationship aliases with the corresponding
resource type in the validation error.
Applications do not need an assistant discovery or CRUD transformation bridge.

Up to 32 authorized actions remain direct tools. For a larger authorized
catalog, the runtime automatically exposes compact paged action search, exact
one-action contract lookup, and contract-gated execution tools. Search returns
at most 20 compact matches and never includes schemas. Tool arguments and
results are byte-bounded; an oversized result returns a controlled error so it
cannot overflow assistant transcript storage.

## Height and scrolling

`AssistantSurfaceClientElement` owns its bounded responsive layout. Below the
medium breakpoint the sidebar column is absent and the compact conversation
control remains available; at medium and expanded widths the non-wrapping 8/4
chat and sidebar layout is visible. Long conversations scroll inside the
message panel while the composer remains in view.

Do not deep-override `.assistant-layout`, `.assistant-main-col`, or
`.assistant-side-col`. A normal page can mount the public element directly. If
the product deliberately embeds it in a shorter flex pane, that app-owned pane
must have a definite height and `min-height: 0` so its child is allowed to
shrink.

## Verification

Run migrations, load assistant and settings pages through normal navigation,
test missing credentials without exposing values, exercise one successful and
one provider-error conversation, and verify global or cross-workspace isolation.

Do not add a second model client beside the runtime, copy its repositories or
routes, infer a surface, store keys in source, or keep generator markers,
questionnaire answers, receipts, or provenance.
