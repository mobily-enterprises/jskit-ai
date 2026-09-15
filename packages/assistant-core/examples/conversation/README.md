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

Optional server environment:

| Variable | Meaning |
| --- | --- |
| `ASSISTANT_API_KEY` | Enables the existing JSKIT API-model client; server only. |
| `ASSISTANT_PROVIDER` | `openai`, `deepseek`, or `anthropic`; default `openai`. |
| `ASSISTANT_MODEL` | Model available to that provider/account. |
| `ASSISTANT_CONFIGURATION_MODE` | `hidden`, `readonly`, or `editable`; default `editable`. |
| `ASSISTANT_STORAGE_MODULE` | Path to an app module exporting async `createStorage()`. Otherwise history is held in memory and disappears on restart. |

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
