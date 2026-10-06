# Independent voice conversation example

This Vue/Vuetify and Fastify application uses the supplied JSKIT conversation
server integration, client binding and shared realtime connection. Planning,
Notes, Research, Writing and Review have separate file-backed histories. One
root voice modal retains its target independently of mounted text cards.
Vibe64, Genesis and a database are not required.

## Install and start

Use a coordinated set of packed packages containing the conversation integration
changes. The migration source and existing package numbers alone are not a fresh
installation proof; candidate verification records the exact archives and pins.
The application imports public package entrypoints only, with no source aliases.
Its Vite configuration uses JSKIT's supplied client plugin for installed-package
dependency scanning and shared client dependencies.

1. Run `npm install` in this directory using that candidate's package versions.
2. Copy `integrations.example.json` to your own configuration file. Choose a model
   key from the existing JSKIT AI catalogue. Set the referenced `ASSISTANT_API_KEY`
   in the server environment using your secret manager or protected shell session.
   Keep the key out of JSON configuration and browser environment variables.
3. For voice, prepare a speech service using the assistant-voice-sherpa README,
   or obtain a speech endpoint and application token from its operator. Supply
   its endpoint and protected tenant token file to this example's server.
4. Start the server with your protected configuration paths:

```sh
ASSISTANT_INTEGRATIONS=/path/to/integrations.json \
ASSISTANT_STORAGE_DIRECTORY=/path/to/private/conversations \
SPEECH_ENDPOINT=ws://127.0.0.1:3092/v1/voice \
SPEECH_TOKEN_FILE=/run/secrets/example-speech-token npm run server
```

5. In another terminal run `npm run dev` and open `http://127.0.0.1:5176`.
   Each text card uses `AssistantConversationClientElement`. Send a short request in two
   cards to see independent output and Stop controls on the one connection.
6. Open **Voice chat with Planning**. Tap Talk for hands-free listening or hold
   it for push-to-talk. The speech connection starts automatically when needed.
   Connect a microphone and speakers and grant browser permission yourself.
7. Minimize voice, then close Planning's text card or focus Notes. Voice retains
   Planning. Use another card's Voice chat button to switch explicitly; unfinished
   words require completion or discard. The voice modal's Text control reopens
   its original text card. Closing voice stops its audio; minimizing preserves it.

The speech WebSocket is separate from the shared conversation realtime channel.
It carries audio, not a second conversation subscription or transcript store.
Leave speech configuration unset to use text without running a speech service.

## Configuration and storage

`ASSISTANT_INTEGRATIONS` uses the existing JSKIT integration configuration and
credential resolver for every engine. `ASSISTANT_INTEGRATION_ID` selects its
connection; supplying an integration file without an ID selects `assistant`.
The server passes one configuration shape: `systemPrompt`, optional
`integrationId`, `model` and `effort`. The runtime normalizes new configuration
inputs and uses the example's explicit `defaultIntegrationId: "assistant"` for
API/OpenCode; Claude/Codex retain native login when no file or ID is supplied.
Opening existing history does not rewrite its saved configuration.
The existing `ASSISTANT_NATIVE_MODEL` and `ASSISTANT_NATIVE_EFFORT` variables fill
the common model and effort fields for any engine. Model IDs stay exact and each
engine checks its supported choices; setting a model cannot override the
authorized connection's model.

The API starter can open and display empty conversations before a connection is
configured. Missing connections or credentials fail on Send without selecting
another model. An explicitly supplied invalid integration file fails setup.
`config.js` owns the five IDs, labels and home surface. Existing Planning and
Notes IDs and history paths are preserved.

History and configuration live in `ASSISTANT_STORAGE_DIRECTORY` (default
`.assistant/conversations`). Keep it private and retain it across restarts.
The supplied file adapter supports one writer process. Multi-process hosts must
supply their transactional store. Text drafts remain in the retained browser
conversation while any text or voice reader retains that target; unfinished
recordings remain voice-owned. A full page reload does not persist either draft.

For Claude or Codex, install its CLI and log in as the server's operating-system
identity. Use `claude auth login` and `ASSISTANT_ENGINE=claude`, or `codex login`
and `ASSISTANT_ENGINE=codex`. With no integration selected, omitted model and
effort use the CLI defaults. Alternatively supply the same integration file and
ID as API/OpenCode, using a provider/model that the native engine supports.
Changing the engine does not require a different configuration object.
Codex requires paginated history support; version 0.159.3 was verified earlier.
Codex conversations share the supplied account/runtime app-server while keeping
separate threads and Stop controls.

For OpenCode, install version 1.18.31 and set `ASSISTANT_ENGINE=opencode` with the
same integration configuration as the API path. JSKIT owns its loopback server,
private credential home, instruction hook and history handling. Preserve
`.assistant/native/opencode` beneath `ASSISTANT_WORKDIR` with application storage.

Native engines require a POSIX host. `ASSISTANT_WORKDIR` defaults to this directory
and must stay stable across restarts. Use a separate storage directory when
trying a different engine: saved conversations retain their engine and identity.
The example leaves native coding tools disabled. Goal controls appear only when
the runtime advertises them. Authorized model selection and native replacement
remain application policy; this example does not add a browser engine selector.

## Delivery, realtime and voice ownership

`server.js` calls `registerFastifyConversations` with its runtime, `appConfig`,
environment, explicit request authentication and bootstrap labels. This is
configurable shorthand for the existing JSKIT feature and HTTP/action/realtime
providers. The starter does not assemble those providers or wrap their router.
It still creates its file storage and runtime, initializes its five identities,
chooses models and checks the local Origin itself. It closes its runtime when
Fastify closes; the helper closes its hosting first.

No database runtime, Knex or migrations are used. Conversation
read/send/cancel/inspection/goal routes and socket subscriptions belong to the
supplied feature. Applications already hosted by JSKIT register `AssistantFeature`
on their existing host and shared connection instead of using the standalone
helper. Lower-level route/action/subscription facilities remain available for
custom hosts. The only example-specific data connection is its authorized speech
proxy.

`main.js` uses `bootClientModules`, `ShellWebClientProvider` and
`RealtimeClientProvider` for real placement, bootstrap and connection recovery.
`main.js` also creates one application HTTP/API client using the local server's
Origin policy. `Conversation.vue` renders `AssistantConversationClientElement`
with that shared client, the subject key from bootstrap and
`clear-draft-on="accepted"`. Its `composer-tools` slot receives the same retained
`runtime` used by the element and passes it to the voice button. The component
owns loading, errors, draft and delivery state; the example has no polling,
event parser, receipt map or adapter implementation.

`App.vue` binds the retained runtime to the existing
voice controller and `projectConversationVoiceState`. Stable spoken turn IDs
survive transient-to-saved output; voice uses the same send/cancel operations.
The standard component also exposes `focus()` to reopen the original text card.
Use `useAssistantConversation()` with `AssistantConversationElement` only when
custom presentation needs the lower-level adapter; the starter needs only the
standard component and its slot.

Closing one text card releases its observer without disconnecting its peers or
stopping server work. Reopening reads current state. Reconnect subscribes and
reads; it never resends a message. Lost delivery remains **Check delivery** until
canonical history or explicit inspection proves acceptance. Inspection uses the
supplied POST `/api/assistant/home/conversations/:conversationId/deliveries/:messageId/inspect`
and cannot dispatch another prompt. Provider failures remain errors, not saved
assistant answers. Interrupted or uncertain native work is not silently replayed.
A failed process cleanup blocks further work; restore its execution host and
retry Stop. An unknown process after a hard crash needs host-level cleanup.

This is a loopback, single-user example, not a hosted authentication system.
Writes and socket/voice handshakes require `APP_ORIGIN` (default
`http://127.0.0.1:5176`). Ordinary GETs may omit Origin; a supplied foreign Origin
is rejected. The helper applies this same host guard to canonical routes, actions
and conversation subscriptions. Server-only context identity permits
only the five browser targets; no actor, scope or room comes from request bodies.
Runtime authorization rechecks that host context for operations and observations.
The client's `local-user` scope comes from application bootstrap and is not a
fabricated authenticated actor. Local events carry no authenticated actor.
A hosted application supplies its authenticated request/action policy instead.

## A headless task in the same process

Optionally start the server with a direct task:

```sh
npm run server -- --headless "Give me three short planning questions."
```

Use the same environment configuration as above. The server opens the separate
`headless` target through the same runtime and file store, calls `send()` and
`wait()` directly, and prints its result. No internal HTTP request, browser
subscription or extra store is involved. Browser access to this target is denied.
The task runs only when explicitly requested on that server invocation; startup
does not retry previous unfinished work. Leave the flag off on ordinary restart.
Do not start another server against the same file directory.

## Verification

`npm run build` checks the client build. Focused integration checks must exercise
the actual server and browser with fresh packed dependencies, including five
subscriptions on one socket, independent close/Stop, origin and target denial,
reconnect and inspection without replay, retained voice/text targeting, and the
headless path. Source migration is not evidence that those candidate checks passed.
Physical microphone, speaker and mobile hands-free behavior need real-device
checks; browser fixture responses do not establish real model or speech behavior.
