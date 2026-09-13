# ElevenLabs

Import `elevenlabsProvider` from `@jskit-ai/connectors-catalog/server/elevenlabs`.
This connector discovers voices/models, generates audio and creates Instant Voice Clones.

## Set up access

1. Select the intended ElevenLabs workspace. Choose **Developers** in the
   sidebar and open **API Keys**.
2. Create a named key. Keep restrictions enabled and grant read access to the
   User read and Voices read. Add Models read and Text to Speech for synthesis; Voices write is required only for cloning.
3. Set an available credit limit and expiry appropriate for the application.
   Copy the key when created; the full value is not displayed later.
4. Store the value outside source as `ELEVENLABS_API_KEY`. The configuration slot
   uses provider `elevenlabs`, mode `shared` or `assistant`, empty `scopes`, and
   `authentication: { "method": "api-key", "secretRef": "env:ELEVENLABS_API_KEY" }`.
5. Save and choose **Connect account / Verify again**, or call `connectApiKey` from your CLI host. **Check connection** only reads saved status. Verification reads the account without generating audio; it does not prove speech/cloning permissions.
   Edit/revoke keys through the key's **•••** menu. See
   [API-key setup](https://elevenlabs.io/docs/help-center/technical/how-do-i-authorize-myself-using-an-api-key).

## Runtime and AI composition

`account.read` uses `GET /v1/user` as the authenticated verification request.
`voices.list` uses `GET /v2/voices`, with `search`, `page_size` (1–100, default
10), and `next_page_token`. Results preserve the pagination envelope, including
`has_more` and `next_page_token`. Requests carry `xi-api-key`. See
[Account](https://elevenlabs.io/docs/api-reference/user/get) and
[Voices](https://elevenlabs.io/docs/api-reference/voices/search).

Compose the [API-key source pattern](../patterns/api-key-connection/PATTERN.md)
with this provider and an application authorizer. Keep resource ownership in
the application. A CLI edits the same portable JSON as Vibe64; neither requires
a database to store connection state.

## Provisioning automation and capacity

An AI can prepare source/configuration and wire these operations once a key
is provided; generation and cloning require explicit application authorization. This pass has not verified automated key/service-account issuance
for every plan; use console-assisted setup for the initial credential. Dedicated
service accounts can isolate resources where available, but that alone does not
prove separate workspace credits. See [Provider security guidance](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/security).

The application owner supplies its workspace/service credential through private
Env and verifies the actual billing and concurrency boundaries. Retain provider
key limits. Two key names in one workspace do not create independent capacity.

Fixtures cover both endpoints, the custom header, cursor encoding, page limits,
encrypted file restart, rotation and permission/rate-limit failures. No real
ElevenLabs requests or audio generation were performed.

## Speech and Instant Voice Cloning

- `models.list`: `GET /v1/models`; choose a model with `can_do_text_to_speech`.
- `speech.create`: `POST /v1/text-to-speech/{voiceId}`; required `voiceId`,
  `model_id` and `text` (1–5000 characters). Optional `language_code` and bounded
  `voice_settings` (stability, similarity_boost, style, use_speaker_boost, speed).
  Output choices: mp3_44100_128 (default), mp3_22050_32, pcm_16000, ulaw_8000.
  The result contains `bodyBase64`, `contentType`, `size`; decode it on the
  backend and return audio through an authorized route. PCM/µ-law are raw formats,
  not universally browser-playable files. MP3 is suitable for an HTML audio player.
- `voices.clone`: `POST /v1/voices/add`, multipart `files` plus `name`, optional
  `description` and `remove_background_noise` (false by default). The portable
  input supplies 1–5 files as `{name, contentType, base64}`, total at most 16 MiB,
  with canonical base64 and a maximum 12 MiB encoded per file. The app must supply
  `consentConfirmed: true` after obtaining speaker permission; this local flag
  is not sent as a provider field. Response `requires_verification: true` means
  the voice is not yet ready. Complete provider verification; never bypass it.

[Speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert),
[Instant clone API](https://elevenlabs.io/docs/api-reference/voices/ivc/create).
For console cloning, open Voices > Add a new voice > Instant Voice Clone,
provide clear samples, a name and confirm rights. An eligible plan/voice slot
is required; [Instant cloning is available from Starter](https://help.elevenlabs.io/hc/en-us/articles/13313587528849-What-is-My-Voices).

```js
const audio = await connections.invoke({ context, integrationId: "voice",
  operation: "speech.create", input: {
    voiceId: selectedVoiceId, model_id: selectedModelId, text: approvedText
  }
});
const bytes = Buffer.from(audio.bodyBase64, "base64");
// Serve bytes through your app's authenticated audio route, using contentType.
```

The generated app owns authorization, voice selection, samples, storage, credit
limits and playback. Other frameworks use their native HTTP/multipart clients
with the same backend Env key and documented endpoints; no JSKIT runtime or
Vibe64 gateway is needed. API-key setup has no OAuth client or callback URL.

**LIMITATIONS:** Audio is buffered up to 16 MiB; it is not low-latency streaming.
Use native ElevenLabs streaming for live conversation or larger outputs.
Professional Voice Cloning, realtime agents, regional residency and provider
verification workflows are not implemented here. For example, an app can generate
an appointment announcement with an authorized cloned voice, but configuring this
connector does not create a phone agent or let Vibe64's coding assistant use it.
Editor assistant attachment is deferred. A failed or timed-out POST may already
have consumed credits or created a clone; no automatic retry is performed.

Focused fixtures additionally verify playable audio bytes/content type, malformed
and oversized responses, clone multipart/consent/verification status, denied
permissions, rate limiting and uncertain submissions. No live audio, account or
generated app was used.
