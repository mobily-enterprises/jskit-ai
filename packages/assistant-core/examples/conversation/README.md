# Standalone conversation example

Copy this directory into a new application, then run:

```sh
npm install
npm run server
```

In a second terminal:

```sh
npm run dev
```

Open http://127.0.0.1:5175. `npm run build` builds the client. The default demo
provider streams a labelled example response and needs no credentials.

## Enable an AI integration

The example uses JSKIT's existing `ai` integration configuration and authorized
connection resolver. To call the explicitly selected model in `integrations.json`:

```sh
ASSISTANT_INTEGRATIONS=./integrations.json npm run server
```

Edit that portable configuration through JSKIT's integration editor or its JSON
contract. Shared keys use `env:NAME` references; the key stays in the server's
normal environment. The example binds authorization to its one local user.
Provider availability is separate from valid configuration. Demo mode remains
offline when `ASSISTANT_INTEGRATIONS` is unset.

| Variable | Meaning |
| --- | --- |
| `ASSISTANT_INTEGRATIONS` | Path to the app's portable integration JSON; enables real inference. |
| `ASSISTANT_INTEGRATION_ID` | Default chat integration; `assistant` by default. |
| `ASSISTANT_SUGGESTION_INTEGRATION_ID` | Separate suggestion agent integration; `suggestions` by default. |
| `ASSISTANT_SUGGESTION_PROMPT` | Server-owned suggestion instructions; returns an array of `{label,prompt}`. |
| `ASSISTANT_CONFIGURATION_MODE` | `hidden`, `readonly`, or `editable`; default `editable`. |
| `ASSISTANT_STORAGE_MODULE` | Path to an app module exporting async `createStorage()`. Otherwise history is held in memory and disappears on restart. |

The shared chooser selects the configured chat integrations; suggestions keep
their independent connection. The shared row shows suggestions and working status,
and responses stream incrementally. The example accepts text, JSON and common
web images up to 2 MB each. Uploads use opaque IDs, preview through app URLs,
and preserve files accepted by a message. Both uploaded bytes and default history
are transient. When replacing history storage, also replace `attachments.js`
with storage that preserves referenced files across restart.

Goals stay off in this API-model example because it has no goal scheduler.
Native-agent apps enable the shared goal control by supplying real goal actions.

This is a single-user local template with one conversation. A hosted app must
derive storage scope from authenticated actor/workspace/conversation ownership,
authorize every route and attachment, and retain provider-delivery evidence for
reconciliation after crashes. The example never executes the same message ID
twice. Retrying a request whose provider delivery is uncertain requires the app
to resolve that uncertainty first.

The server owns model choice, credentials and allowed configuration. Hidden or
read-only configuration always uses the server's fixed settings, regardless of
the submitted object. Replace the storage adapter to use your application's
database or files; the UI has no storage assumptions.

See the JSKIT guide **Embeddable assistant conversations** for the complete
client, storage and provider contracts and reusable storage-adapter checks.
