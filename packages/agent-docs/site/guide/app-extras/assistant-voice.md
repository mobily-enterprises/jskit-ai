# Voice conversations

`@jskit-ai/assistant-voice` adds push-to-talk, hands-free conversation, captions,
transcript review, streamed playback and interruption to an application's existing
conversations. One controller and one modal live above the routed screens. The
application keeps its agent, history, message admission and authorization.

The optional `@jskit-ai/assistant-voice-sherpa` package supplies native speech
recognition, synthesis and explicit model preparation. Installing the browser
package does not install native inference or download models.

## Application integration

Install `@jskit-ai/assistant-voice` in a Vue 3/Vuetify application. Mount
`VoiceConversationHost` once inside the root `v-app`, and create its controller
in that root's setup scope:

```js
import { onScopeDispose } from "vue";
import { createVoiceConversationController, VoiceConversationHost }
  from "@jskit-ai/assistant-voice/client";

const voice = createVoiceConversationController({
  connectSpeech: binding => `/api/conversations/${encodeURIComponent(binding.id)}/voice`
});
onScopeDispose(() => { void voice.dispose(); });
```

```vue
<VoiceConversationHost :controller="voice" />
```

For the ordinary setup, use the [standard Assistant integration](./assistant.md).
`AssistantConversationClientElement` supplies the same retained `runtime` to its
`composer-tools` slot. The five-chat example in
`@jskit-ai/assistant-voice/examples/conversation` uses
`useAssistantConversationFactory()` to keep a voice-held reader of that same
runtime and its current adapter. It projects canonical turns with
`projectConversationVoiceState`, and forwards
text and Stop through `runtime.send()` and `runtime.cancel()`. The application
supplies the speech URL, target label and text-view navigation; it does not build
another transcript, delivery ledger or realtime subscription.

### Custom conversation binding

Applications with an existing authorized conversation reader can instead supply
this binding contract to the same voice controller:

```js
await voice.open({ conversation: {
  id: conversationId,
  label: "Planning",
  get state() { return store.conversations[conversationId]; },
  get available() { return store.canUse(conversationId); },
  captureContext: () => ({ conversationId }),
  submitText: (text, { messageId, context }) =>
    store.send(context.conversationId, { text, messageId }),
  cancelWork: () => store.stop(conversationId)
} });
```

The store and its operations are application-owned. `state` exposes `messages`,
an optional `streamingReply`, and `status: "working"` while the agent is running.
Each message has a stable `id`, `role` and `text`. A streaming answer and its saved
replacement use the same ID. Supply user and assistant content; exclude tool
output, reasoning and private operational details.

`submitText` resolves when the application's normal server operation accepts the
message. Reject failures and deduplicate retries by `messageId` in that operation.
Voice preserves the captured destination and message identity; it does not create
another history or infer whether an uncertain server request was accepted.

Optional `openText()` opens the application's text conversation. It adds Talk and
Text controls at the top of the modal. Selecting Text calls that operation and
minimizes voice while capture and playback retain their current state. An
application can open this modal as its default conversation view; opening never
starts the microphone.

Optional synchronous `retain()` and `release()` keep a conversation reader alive
outside its screen. A binding's `available` value must reflect access loss.
Include the current identity scope in the binding ID when IDs can overlap between
people; dispose the controller on identity replacement. Server authorization is
still required for every message and speech connection.

### Retained conversation presentation

A binding may expose `get adapter()` returning its existing
`AssistantConversationElement` adapter. `VoiceConversationHost` reads that getter
for the current presentation. It renders the full core transcript and typed
composer, including the adapter's delivery, questions, attachments and goal
controls. Supply the live retained adapter; do not capture one computed snapshot
or rebuild a transcript from voice `state.messages`.

The five-chat example acquires its voice reader through
`useAssistantConversationFactory()` with the original runtime's conversation,
actor, endpoint, target/host surface and workspace identity. That reader shares
the runtime, realtime subscription and typed draft with the text card. Closing
the text card leaves the voice reader active; ending voice releases it through
the existing binding lifecycle. Reader presentation does not create another
conversation or submit a message.

Optional `binding.conversationId` carries the logical conversation ID, separately
from the scoped `binding.id`. The controller still compares `binding.id` to reveal
or switch targets; adding the logical ID does not change that equality or captured
recording destinations. Bindings without an adapter retain the original portrait
and latest-word/latest-answer caption presentation while their consumers migrate.
Headless controller/session use requires no adapter or mounted view.

`VoiceConversation` accepts `adapter`, `session`, `disabled`, and controlled
`avatarSize`, and emits `update:avatarSize`. `VoiceConversationHost` forwards that
preference and event. Supply `v-model:avatar-size` from the application's existing
preference owner. Its avatar slot receives the original visual state plus the
core slot's requested `size` and effective `height`; temporary clamping preserves
the preference.

`VoiceConversationControls` reuses the session's original Talk/Pause gesture,
speaker, Stop speaking, error and recording review operations. `compact` places
48px voice actions beside the ordinary composer tools and bounds the independent
review textarea. Captured words stay explicitly Not sent until normal admission;
review edits do not replace the typed draft. While capture, transcription or review
needs resolving, the canonical typed composer stays editable and its Send is
disabled. Finish the recording, then send or discard its reviewed words before
sending the typed draft. This presentation guard keeps the original adapter's
actions, attachments and questions. Send retries keep the recording's
UUID and captured destination; Discard uses the original cleanup operation.

For custom compositions, its optional `toolsTarget` is a DOM element belonging
to the local composer-tools slot. One controls instance moves its buttons there
with Vue Teleport, while review and errors remain in composer-feedback. Keep
that target mounted with the composer; there is no global portal or second
gesture/session owner. With no target, the controls render together in place.

The host's optional `conversation` slot receives `{ binding, session, disabled }`
and replaces its primary body. Settings, target-switch guards, minimizing,
reopening and controller lifetime stay with the same host. An application can
render its retained conversation in this slot; the slot does not acquire a
runtime or change capture and playback policy.

## Interaction ownership

Opening voice shows its controls without acquiring the microphone. The single
Talk button connects automatically: tap for hands-free, hold for push-to-talk,
and release to send. Tap Pause to pause hands-free capture. Hands-free can listen
while answers play. The browser
requires microphone permission and a secure origin, including recognized localhost
origins for development.

Opening the same binding ID reveals the existing modal. Minimizing or changing
the visible screen preserves its destination. Opening another target first
releases the old audio. Unfinished words must be sent or explicitly discarded
before switching. A send in progress cannot be discarded to switch targets.

Microphone and speaker choices are independent. Opening or restoring a voice
view starts neither direction. Sound defaults off unless the application supplies
`defaults.readAloud: true`. Tap or hold Talk starts capture without changing that
choice; Pause or ending live capture leaves queued/current playback intact.
Ordinary typed or spoken steering also leaves playback intact. An explicit
silence command, Stop speaking, switching the speaker off, or releasing the voice
target interrupts it.

The speaker button changes the requested preference. Its optional
`binding.onReadAloudChange(value)` callback runs only for that explicit change,
never for preference hydration, microphone actions or navigation. The application
owns storing it for the correct authenticated user. `defaults.readAloud` initializes
a new session; it is not a second preference store. Sound on applies to future
outputs and does not replay history. If browser playback is blocked, the speaker
choice stays on and **Enable sound** retries unlocking it. Microphone permission
and capture continue independently, including while sound unlock is pending.

Stop speaking cancels playback and queued speech. Stop agent work calls the
binding's separate `cancelWork` operation. `end()` releases voice after pending
words are resolved; `dispose()` always releases it. Reconnection does not replay
messages, resend captured audio or automatically restart the microphone.

Bindings may supply `defaults.mode` (`push-to-talk` or `hands-free`),
`defaults.reviewBeforeSend`, `defaults.voiceId`, and boolean `defaults.readAloud`. Recordings started through
`startHeldRecording()` require review; the modal's push-to-talk gesture uses
`reviewBeforeSend`. The Talk/Pause microphone icon and speaker toggle show their states. The
Voice settings cog loads the service's installed voices without recording.
Pause finalizes the current utterance before muting, including buffered audio,
and applies the recording's review preference. Resume starts a fresh recording.
The review panel stays hidden during automatic admission; failed admission keeps
the words and message identity available for review and retry.
The retained-adapter view scrolls the shared full history while its composer and
voice controls remain available. In the original caption presentation, the
portrait and controls stay fixed while captions scroll. A voice selection affects the next reply; streamed
phrases of a reply retain the original speaker. Voice does not change the agent's
reasoning model.

### Output playback observation

Supply optional `binding.onPlayback(event)` before requesting the output:

```js
onPlayback({ conversationId, outputId, phase, reason }) {
  // Store application-owned playback status for this canonical output.
}
```

`conversationId` is the binding's logical `conversationId`, falling back to its
scoped `id` for existing bindings. `outputId` is the canonical assistant output
identity, never the internal synthesis chunk UUID. `phase` is `started`,
`completed`, `interrupted` or `failed`; `reason` is optional and generic, such as
`muted`, `cancelled`, `disconnected`, `playback-error` or `no-audio`.

Start is observed from the running audio clock reaching scheduled PCM, or a
natural end of a very short sound. Text arrival, synthesis requests and future
scheduled audio do not claim playback. Completion requires the canonical output
to be final and its server stream, queued frames and scheduled audio to drain
successfully. The existing bounded speech projection still limits each output
to 4,000 source characters; reaching that limit is not canonical finalization.
A queued output cancelled before audio begins emits interrupted without started.
A final projection with no speakable text, or declined playback, retires as
interrupted with `no-audio`; it does not claim a start or completion.
A disappearing unfinished output is interrupted. Each output starts at most once
and has one terminal outcome; delayed audio from an old epoch cannot change it.
Silent text mode emits no invented audio receipts.

Observers cannot control scheduling or cleanup. Synchronous exceptions and
rejected observer promises are isolated. Keep application actions, teaching cues
and any interpretation of these generic receipts in the consuming application.

`ConversationDialog` is the shared Vue frame for voice and application Text views.
It fixes header/tab geometry, uses full screen below 600 pixels, and switches
without content or backdrop transitions. It accepts `title`, `mode`, `showModes`, `minimizable` and
`closeLabel`; `update:modelValue`, `update:mode` and `minimize` report actions.
The host's X calls `end({ discard: true })`; minus preserves capture/playback.
Both `VoiceConversationHost` and `ConversationDialog` accept an optional
`activator` DOM element. A click over that launcher while the dialog is open
minimizes it; the backdrop cannot turn that gesture into an audio shutdown.
An application can replace the host's default floating reopen control through
the `reopen` slot and use `controller.reveal()` from its own header indicator.

The host's `avatar` slot receives `state`, `mouthLevel`, `mouthPose`, `avatar` and
`binding`. `VoiceAvatar` and `useVoiceAvatar` supply generic presentation; an
application may provide artwork without acquiring audio ownership.

## Authorized speech connection

Register the WebSocket plugin on the application's Fastify server, then expose a
proxy route through `@jskit-ai/assistant-voice/server`:

```js
registerVoiceProxyRoute(fastify, {
  route: "/api/conversations/:id/voice",
  proxyConfig: resolveVoiceProxyConfig({ endpoint, accessTokenFile }),
  async authorize(request) {
    await checkOrigin(request);
    await requireConversationAccess(request.user, request.params.id);
  }
});
```

Import `registerVoiceProxyRoute` and `resolveVoiceProxyConfig` from that server
entrypoint. The endpoint and protected token file are operator inputs. The
application supplies the illustrated origin and conversation checks; authorization
runs before connecting upstream. No service key or token belongs in browser code.
A speech grant does not authorize access to a conversation or execution of tools.

Register the WebSocket plugin before starting the supplied realtime provider.
The existing realtime attachment hands only `/socket.io` WebSocket upgrades to
Socket.IO, so Fastify does not close that connection as an unknown speech route.
Other upgrades remain with their application routes and authorization. The
application does not need a separate upgrade handler.

`createVoiceDaemon({ engine, accessKey, ... })` supplies the bounded service.
The engine owns recognition and asynchronous synthesis. A host may supply its
own `authorize(token)` and `handleRequest(request, response)` grant policy.
Principals contain `tenant` and optional `parentTenant`; connection limits apply
to both. `revokeTenant(id)` terminates existing sessions and queued work. The
host's authorizer must also reject subsequent use of a revoked grant.

## Native service and configurable voices

Install `@jskit-ai/assistant-voice-sherpa` where the service will run. Model
preparation requires Bash, tar with bzip2, sha256sum, Node and curl unless the
archives are cached. Models have separate upstream licenses and are not bundled
in npm. Preparation verifies pinned archives and installed files.

```sh
npx jskit-assistant-voice prepare --models-root /srv/speech/models --pack cori
npx jskit-assistant-voice verify --models-root /srv/speech/models
npx jskit-assistant-voice serve --models-root /srv/speech/models --key-file /run/secrets/speech-key
```

The signing key is an operator-created random secret of at least 32 bytes in a
protected file. `jskit-assistant-voice token --key-file PATH --tenant NAME` emits
an application token; redirect it into a separate protected file. The standalone
token command does not implement a revocation store. Service defaults are
`127.0.0.1:3092`, `/v1/voice` and readiness at `/health`.

The `cori` preparation preset supplies one English voice. `piper` adds Alba
(female, Scottish English), Joe and Bryce (male, American English) and
Northern English (male, British English), retaining
Cori (female, British English) as the default. These are separate Piper medium
models; one synthesis worker retains only the selected model. Changing models
releases the previous worker and its native caches before loading the next, while
recognition and the connection stay running. The first reply after a change
includes loading time. Extra choices require disk space, not resident model RAM.
`kokoro` supplies Heart, Bella,
Emma, Michael, Adam, George and Daniel. All presets use the English streaming
Zipformer recognizer. Operators can supply
`prepare --sources-file FILE` for pinned model archives and `serve --config FILE`
for native recognition/synthesis settings, voice IDs, labels and speaker IDs.
`recognitionVocabulary` maps literal phrases to application spellings, for example
`{ "acme labs": "Acme Labs" }`. It applies when normalizing uppercase recognition;
mixed-case input remains intact. CLI hosts can supply the same option as a
default, overridden by an explicit speech configuration vocabulary.
A voice's optional `speed` sets its synthesis pace from `0.5` to `2`, default `1`.
Multiple native models use a `synthesizers` map and a `modelId` on each voice;
their output sample rates must match unless `outputSampleRate` configures a shared
rate. The worker then uses Sherpa's resampler before sending audio.
`kitten` provides Kitten Micro 0.8 Bella, Luna, Rosie and Kiki (female), and
Jasper, Bruno, Hugo and Leo (male). All eight share one model. Bella uses
`speed: 1.15`; the others use normal speed. Their upstream catalogue does not
identify British or Australian accents.
`piper-kitten` lists Kitten before the five Piper voices, defaults to Cori and
normalizes output to 22,050 Hz. One synthesis model remains resident across
engine changes. The settings cog lists installed voices.
The package README documents the exact source manifest and configuration fields.
Stop the service before replacing its prepared pack, verify it, then restart.

Measure first-audio latency and sustained synthesis on the intended host. Voice
quality, language support and CPU cost depend on the configured models. Browser
echo cancellation and text filtering need physical microphone/speaker testing;
generated audio cannot prove acoustic isolation. The recognizer's configurable
onset RMS floor prevents silence from starting an utterance, but is not a
speech-versus-noise classifier.

The published package's `examples/conversation/` directory contains an independent
five-conversation Vue/Fastify application using the supplied file storage and
retained binding, plus a separately addressed headless task. Model credentials
and an optional speech endpoint are explicit setup inputs. Use it to check
installation, retained targets, interruption and recovery.

### Application-owned voice preferences

`VoiceConversationHost` has an optional `settings` slot for an application-owned
selector. Persist the voice choice in your application, then supply its current
value through reactive `binding.defaults.voiceId`. Changes apply to subsequent
replies. An unavailable ID uses the server default without rewriting the saved
choice; reconnecting can restore it if the voice returns. An empty string selects
the server default. The built-in selector remains local to the voice session.

`readVoiceCatalogue(proxyConfig)` from `/server` retrieves the daemon's authorized
`GET /voices` metadata without reserving an audio connection. Expose it only
through an application-authorized route; credentials stay on the server. The
result contains `voices` (IDs, labels and optional languages) and `defaultVoice`,
matching the WebSocket greeting. Listing voices does not synthesize or load
additional voice models.
