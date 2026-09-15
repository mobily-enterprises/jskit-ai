# Assistant

`@jskit-ai/assistant-runtime` supplies a reusable assistant runtime, client
elements, actions, persistence, and settings behavior. The application decides
where an assistant belongs and composes its pages directly.

```bash
npm install @jskit-ai/assistant-runtime
npm run db:migrate
```

Use the `assistant/assistant-surface` pattern. There is no assistant generator.

For an app-owned backend or custom conversation storage, use the
[embeddable conversation element and backend contracts](./assistant-conversation.md).
The package includes a standalone application template.

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

### Framework account and workspace actions

Account and workspace action owners supply assistant-specific descriptions,
output validators and result adapters. Their API routes keep their existing
responses. The current tagged JSON:API action result stores its payload in
`result.value`; profile update stores it in `result.response.value` beside a
server-only session. Do not forward the wrapper or session to the assistant.

`surfaces: ["*"]` matches every named surface. An empty surface list remains
unrestricted; explicit names remain restrictive. Surface matching never grants
permissions. Trusted `workspaceSlug` replaces model input only on actions whose
input declares that field; account and directory-list actions receive no extra
workspace parameter.

There are 22 enabled framework contracts: eight account actions and fourteen
workspace actions. Invitation creation returns invitation summaries, the created
ID and delivery status, without token previews, invitation URLs, provider message
IDs or provider delivery messages. Pending invitation lists omit raw tokens.
Output validation rejects unexpected fields, including nested fields, instead
of passing arbitrary server state into model results.

Nine actions are explicitly excluded from assistant discovery and execution:

| Actions | Reason / existing alternative |
| --- | --- |
| `settings.profile.avatar.upload` | Use the authenticated account file picker; no upload streams in tool arguments. |
| `settings.security.password.change` | Use the authenticated account security form; no passwords in tool arguments. |
| `settings.security.oauth.link.start` | Use the authenticated account security screen; authorization URLs contain transient state. |
| `workspace.invitation.resolve`, `workspace.invite.redeem` | Use the invitation screen; no raw invitation tokens in tool arguments. |
| `assistant.settings.read`, `assistant.settings.update` | Assistant self-configuration stays disabled. Use the existing assistant settings screen. |
| `console.settings.read`, `console.settings.update` | Application-defined settings have no framework field allowlist. An application must define its own safe contract before exposing configuration. |

An owner records an exclusion as `extensions.assistant.exclude`, containing a
human-readable reason. An exclusion takes precedence even if the action later
gains a structured HTTP output. It affects assistant tools only, not API or
internal execution. The runtime also retains its `assistant.` prefix exclusion,
so recursive chat/history operations remain unavailable. This release introduces
no protected handoff subsystem. Do not ask a user to paste credentials into chat
to work around an excluded operation.

The framework inventory test checks all account, workspace and console action
specification modules plus the assistant runtime automation actions. Every action
must have a documented exclusion or a description, output contract, result adapter
and execution fixture. Application-defined automation actions require the same
review; automation capability alone does not mean model exposure is safe.

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
`items[0].lookups.pet.name`. Resource identifiers remain available as `id`,
but relationship IDs and included-resource fields that were not selected are
removed after JSKIT uses JSON:API linkage to associate each lookup with its
primary record. Invalid array forms such as `include: ["pet"]` or
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

The runtime tells the model that discovery tools are entry points into the
authorized action catalog. Before claiming a capability or dataset is missing,
it must search or browse that catalog and inspect relevant action contracts.
Search matches every supplied word literally against action IDs, kinds, and
descriptions. If user terminology finds no match, the model is instructed to
try broader resource or operation terms such as `list` or `query`, or omit
`query` to browse. Catalog `nextCursor` pages contain more actions, not more
business records.

For requests involving several records, comparisons, or whole collections,
the shared instructions direct the model to appropriate list, search, query,
or aggregate actions. For counts and summaries, it first looks for suitable
count, aggregate, or report actions before reading individual records. The
model must respect the user's current scope, reconsider earlier filters when
that scope broadens, and follow the selected action's
record pagination until the requested count or scope is covered. Partial
results must not be described as a complete collection. This guidance applies
to every resource; application-specific vocabulary belongs in action
descriptions. Model adherence still requires conversational verification.

An application can keep a small critical action directly available in a large
catalog by opting it in explicitly:

```js
extensions: {
  assistant: {
    alwaysAvailable: true,
    preflight: ["current-time"]
  }
}
```

The catalog exposes at most eight authorized `alwaysAvailable` actions beside
the three discovery tools. Permission, surface, channel, actor, and trusted
workspace enforcement remain unchanged. Other actions still require contract
lookup before discovery-mode execution.

## Conversation lifecycle

Tool selection, execution, correction, and recovery run silently. The client
receives tool timeline events, but assistant prose is emitted only when the
answer is complete. Progress-only responses such as “Let me query…” are
retried internally and are not stored or replayed as chat history.

The runtime permits up to 16 bounded tool rounds so catalog search, contract
lookup, and execution can complete in one turn. If ordinary tool-failure
recovery cannot finish, the runtime returns the latest successful tool result
with a 4,000-character cap, or a concise failure when there was no successful
result. Genuine round-budget exhaustion ends with exactly `Limit reached. Start
a new conversation.`

For current or relative date and time questions, the runtime instructs the
model to use an available authoritative workspace clock action. When an
authorized `preflight: ["current-time"]` action has no model-required input,
the runtime executes it before the first model completion and places its result
in model history. Mark it `alwaysAvailable` when the authorized catalog can
enter discovery mode. Trusted workspace input can still be required by the
application because JSKIT hides and injects it before execution.

The clock action and its timezone policy remain application-owned; JSKIT does
not invent a clock action or infer the current date from model knowledge. Make
that action automation-capable and available on the assistant surface if the
product needs now, today, tomorrow, or other relative-date answers.

Conversation restoration loads every transcript page needed to retain the
newest bounded transcript window, so a completed response on page two does not
disappear after navigation or remounting. The defaults are 200 entries per page
and at most 2,000 restored entries. Applications can set
`assistant.restoreMessagesPageSize` up to 500 and
`assistant.restoreMessagesMaxEntries` up to the hard 5,000-entry limit. Longer
conversations restore the newest entries rather than expanding client memory
without a bound. Each page has its own query-cache key and can be reused by a
warm remount.

Restored tool calls without matching results, and live calls still pending when
a stream ends, are shown as interrupted rather than remaining pending forever.

## Shared conversation UI

`AssistantSurfaceClientElement` connects `useAssistantRuntime` to
`AssistantConversationElement`. There is one maintained conversation renderer
and composer. Applications that own a separate conversation operation use the
[embeddable element](./assistant-conversation.md) directly through their own
adapter; they do not need the generic assistant's database or tool loop.

The runtime owns the draft, requests, saved conversations, history selection,
provider settings, authorization scope and action tools. Its adapter maps
`streaming` to `inProgress`, `done` to `completed`, `error` to `failed`, and
`canceled` to `interrupted`. Existing message IDs stay stable while text streams.
Restored entries retain their database IDs; equal text is not a duplicate ID.
Tool activity shows the existing tool name and status, never raw arguments or
results. No provider reasoning is invented.

Typing stays available during streaming and history restoration; Send waits for
the active operation. The runtime clears an accepted draft synchronously, so
later typing survives response completion and cancellation. A failure before an
answer restores the request as a draft if the user has not already typed a new
one. Enter sends, Shift/Alt+Enter inserts a newline, and Ctrl/Cmd+Enter sends.
IME composition never submits. Only the shared composer handles these keys.

Stop aborts the browser's response request. The pending cancellation ends when
that local request settles. It does not prove that a tool already executing on
the server has stopped; the UI states that limitation. Closing/unmounting a view
also aborts its local request and releases its state. Reopening can restore the
selected saved conversation. It does not reattach a stream or resume work.
Switching the configured surface or workspace clears that view's draft and
messages and rejects late responses from its previous scope. Applications must
continue to supply their normal authenticated shell and workspace context.

Conversation selection and cached transcripts are separated by the signed-in user,
assistant surface, and workspace. Switching any of them clears the mounted draft
and detaches its pending response. The application must supply the current user
and surface through JSKIT placement context and the workspace through the normal
workspace scope provider; text from a prompt is never used as that authority.
A failed automatic restore waits for explicit conversation selection to retry.
Typing during a restore is retained.

### Pages and compact panels

```vue
<AssistantSurfaceClientElement
  surface-id="admin"
  layout="compact"
  assistant-label="Workspace assistant"
  welcome-message="What would you like to do in this workspace?"
  placeholder="Ask about your workspace…"
  :show-tool-activity="true"
/>
```

`surfaceId` selects an existing configured assistant surface. The presentation
props are `layout` (`page` or `compact`), `assistantLabel`, `welcomeMessage`,
`placeholder`, and `showToolActivity`. Configuration controls stay on the
application's existing assistant-settings route; these presentation props do
not change provider settings or permissions.

Conversation selection, Refresh, Start new conversation and loading older
conversations are available through the Conversations dialog at every width.
The current title remains visible. Activity opens the current tool-status list;
setting `showToolActivity` to false hides presentation only. The
`composer-tools` slot receives `{ runtime }` for application-owned supplementary
controls. The element exposes `focus()` so a drawer owner can focus it once when
opened and restore focus to the opener when closed.

Mount the element in a pane with a definite height and `min-height: 0`. Long
transcripts scroll internally; the composer keeps its space. The compact layout
removes page padding and uses the shared compact input. Style the app-owned
container and use the application's Vuetify theme. Do not target private DOM
classes or pass the retired renderer's `variant`, `features`, `ui`, or `copy`
objects. `AssistantClientElement` and its Markdown/keyboard helpers have been
removed; there is no forwarding alias.

## Verification

Run migrations, load assistant and settings pages through normal navigation,
test missing credentials without exposing values, exercise one successful and
one provider-error conversation, and verify global or cross-workspace isolation.

Do not add a second model client beside the runtime, copy its repositories or
routes, infer a surface, store keys in source, or keep generator markers,
questionnaire answers, receipts, or provenance.
