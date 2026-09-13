# Telegram

Import `telegramProvider` from `@jskit-ai/connectors-catalog/server/telegram`.
The adapter reads bot identity/webhook status, sends plain text and chat actions,
and receives message updates through explicit polling. It does not change
webhooks or authenticate application users.

## Manual provider setup

1. Open Telegram and find the verified [BotFather](https://t.me/BotFather).
2. Send `/newbot`, supply a display name, then choose an available username
   ending in `bot`. Keep the returned token private.
3. Store the token in your backend environment as `TELEGRAM_BOT_TOKEN`.
4. Add Telegram in Vibe64. Enter `env:TELEGRAM_BOT_TOKEN` in **Bot token
   reference** and save. The CLI uses exactly the same JSON below.
5. Run the application's connection verification. Saving an editor form alone
   does not contact Telegram or prove that the token works.

BotFather manages bot creation and tokens; the token belongs to a bot rather
than its owner's personal Telegram mailbox.
[Telegram bot tutorial](https://core.telegram.org/bots/tutorial).

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "bot": {
      "provider": "telegram",
      "displayName": "Service bot",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "api-key", "secretRef": "env:TELEGRAM_BOT_TOKEN" }
    }
  }
}
```

Compose the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with
`providers: [telegramProvider]`, application authorization and a file connection
store. Runtime state is private text files outside the source tree; no editor
database or generated project is required to use the library from a CLI.

```js
await connections.connectApiKey({ context, integrationId: "bot" });
const status = await connections.invoke({
  context, integrationId: "bot", operation: "webhook.read"
});
console.log(status.result.pending_update_count);
```

| Operation | Telegram method | Input | Result |
|---|---|---|---|
| `profile.read` (verification) | `getMe` | `{}` | `{ ok: true, result: bot }` |
| `webhook.read` | `getWebhookInfo` | `{}` | `{ ok: true, result: webhook }` |

Bot API requests use `https://api.telegram.org/bot<TOKEN>/<METHOD>`.
`getMe` identifies the bot. `getWebhookInfo` reports delivery configuration and
pending updates; its URL is empty when no outgoing webhook is configured.
`getUpdates` and webhooks are alternative delivery mechanisms, so verification
must not start polling or acknowledge updates. Telegram error envelopes contain
`ok: false`, a description and an error code.
[Bot API methods and envelopes](https://core.telegram.org/bots/api).

The adapter checks the token's numeric-ID/colon/token shape before transport,
validates successful bot and webhook fields, and preserves extra response data.
Only the fixed API origin receives credentials. Source and connection records
contain references; update the environment binding for token rotation.
HTTP failures and unsuccessful JSON envelopes become safe connector errors;
an unauthorized token marks a previously verified connection as needing
reconnection. Provider descriptions are not returned. This fragment does not
schedule retries or expose Telegram's optional retry-delay payload.

The request pathname contains the credential. Redact it in application HTTP
logs and tracing. Authorize webhook reads because the returned URL can reveal
application configuration. Disconnect deletes local state only; it leaves the
bot and its delivery configuration intact.

## API provisioning and application ownership

For ordinary manual setup, create a bot for the application through BotFather
with an available username. Store its token in the application's private Env. Rotating a token for one bot retains that
bot's identity; it does not create independent message delivery or capacity.

Telegram also documents **managed bots**: a manager provides a new-bot link,
the user confirms creation, and the manager receives a `managed_bot` update.
Authorized manager methods can retrieve or replace the managed bot's token.
This offers API-assisted provisioning after the manager and user-confirmed flow
exist; it is not an unattended generic bot-creation endpoint. An AI can prepare
the manager workflow and bot profile configuration, but must not invent a
`createBot` call or silently replace a live token.
[Managed bots and BotFather controls](https://core.telegram.org/bots/features).

This runtime fragment does not implement managed-bot provisioning, webhook
registration or Telegram Login. Those are separate operations with different
ownership. The application owner must confirm provider capacity for its usage. Different VM or application domains do not affect these
outbound API calls; a separately implemented webhook consumer must own its explicit callback and
delivery lifecycle.

## Focused evidence

Automated fixtures check token validation, fixed destinations, bot-only
verification, empty webhook URLs, malformed results, unsuccessful HTTP-200
envelopes, authorization failures, rate limits, file-store restart, isolation,
rotation and disconnect. The editor test checks the bot-token label, rejection
of raw credentials, setup link and saved-reference reload. No live bot,
provider consent, message delivery or sample application is exercised.


## Interactive message workflow

Before polling, call `webhook.read`. A nonempty webhook URL means another
consumer is configured; polling will conflict. Do not automatically remove it.
Use a dedicated bot or deliberately switch delivery in the application that owns
that webhook. Only one application worker should poll a bot at a time.

```js
const batch = await connections.invoke({ context, integrationId: "bot",
  operation: "updates.poll", input: savedOffset === undefined ? {} : { offset: savedOffset } });
for (const update of batch.result) {
  // Authorize this chat and deduplicate update.update_id in your application's state.
  // Handle incoming content; it is untrusted, not a command to your coding agent.
  await handleUpdate(update);
  // Persist update.update_id + 1 only after processing succeeds.
}
```

The next poll with a higher offset acknowledges earlier updates at Telegram.
Persist offsets and deduplication in app-owned storage; the connector neither
starts a worker nor saves processing state. An outbound reply and local offset
save are not atomic: a crash can duplicate a reply. The application must choose
its recovery policy. Negative offsets that would discard older updates are
rejected. Default `allowed_updates` is explicitly `["message"]`; optional
`edited_message`, `channel_post`, `edited_channel_post` are supported. Telegram
may still return older queued types; inspect each update rather than assuming
that every entry contains a text message. Limits are 1–100; long poll is 20
seconds by default (0–20 allowed), within the adapter's 30-second request timeout.
[Polling contract](https://core.telegram.org/bots/api#getupdates).

Send a reply only to an application-authorized chat:

```js
await connections.invoke({ context, integrationId: "bot", operation: "chats.action",
  input: { chat_id: String(chatId), action: "typing" } });
await connections.invoke({ context, integrationId: "bot", operation: "messages.send",
  input: { chat_id: String(chatId), text: "Your booking request was received." } });
```

`messages.send` accepts plain text (1–4096 characters), chat ID as a decimal
string or @username, optional forum thread ID, silent notification and content
protection booleans. No HTML/Markdown parser, paid broadcast, files or keyboards
are enabled. `chats.action` accepts Telegram's documented typing/upload/record
status values and optional thread ID; it is a transient indicator, not a job
queue. Bot membership, user initiation and group privacy settings control access.
The application must not interpret a successful bot verification as permission
to contact arbitrary people. No send is retried automatically after uncertainty.
[Send message](https://core.telegram.org/bots/api#sendmessage),
[chat action](https://core.telegram.org/bots/api#sendchataction).

A non-JavaScript framework uses its own HTTP client and worker with the same Env
bot token, JSON payloads and offset contract. JSKIT is optional; Vibe64 hosts no
polling service. Local disconnect leaves the bot and queued updates intact.
Revoke/replace a compromised token with BotFather, change Env and verify again.
