# Assistant voice with Sherpa

Optional local recognition and synthesis for `@jskit-ai/assistant-voice`.
The native npm dependency is `sherpa-onnx-node`; models are prepared explicitly.
No native dependency or model download is added to applications that only install
the browser/proxy package.

## Prepare and serve

Install `@jskit-ai/assistant-voice-sherpa`. Preparation requires Bash, tar with
bzip2, sha256sum, Node and curl (unless all pinned archives are already cached).
This extraction has been exercised on Linux x64 with Node 26. See the native
package's supported platforms before choosing another deployment target.

```sh
npx jskit-assistant-voice prepare --models-root /srv/speech/models --pack cori
npx jskit-assistant-voice verify --models-root /srv/speech/models
npx jskit-assistant-voice serve --models-root /srv/speech/models --credentials-file /srv/speech/credentials.json
```

The service is run by its host, and each application is a client of it with its
own token. The host lists its clients in the credentials file (the format is in
`@jskit-ai/assistant-voice`'s README, Speech service), holding each token's
SHA-256 only, and rewrites it to add, rotate or remove a client; the service
picks a change up within a second, without a restart, and ends a removed
token's sessions. Each client's server keeps its own token and hands it to its
authenticated proxy (`resolveVoiceProxyConfig({ endpoint, accessTokenFile })`);
no token belongs in browser configuration. `createVoiceClientToken()` and
`voiceTokenSha256(token)` from `@jskit-ai/assistant-voice/server` make a token
and its hash.

The service defaults to `127.0.0.1:3092`, with its WebSocket at `/v1/voice`, its
catalogue at `/v1/catalogue`, its voices at `/voices` and readiness at `/health`.
It writes one JSON line per connection, credentials change and refused
credentials file to standard output (the access log). `serve` options, each
also an environment variable:

| Option | Environment | Default |
| --- | --- | --- |
| `--credentials-file PATH` (required) | `JSKIT_VOICE_CREDENTIALS_FILE` | |
| `--hotwords-file PATH` | `JSKIT_VOICE_HOTWORDS_FILE` | none |
| `--spellings-file PATH` | `JSKIT_VOICE_SPELLINGS_FILE` | none |
| `--workers N` | `JSKIT_VOICE_WORKERS` | one per CPU |
| `--recognition-workers N`, `--synthesis-workers N` | `JSKIT_VOICE_RECOGNITION_WORKERS`, `JSKIT_VOICE_SYNTHESIS_WORKERS` | `--workers` |
| `--max-connections N` | `JSKIT_VOICE_MAX_CONNECTIONS` | 8 per recognition worker |
| `--max-connections-per-client N` | `JSKIT_VOICE_MAX_CONNECTIONS_PER_CLIENT` | 2 per recognition worker |
| `--max-queued-speech N` | `JSKIT_VOICE_MAX_QUEUED_SPEECH` | 4 per synthesis worker |
| `--host ADDRESS`, `--port NUMBER` | `JSKIT_VOICE_HOST`, `JSKIT_VOICE_PORT` | `127.0.0.1`, `3092` |
| `--config FILE` | `JSKIT_VOICE_CONFIG` | the pack's `speech.json` |
| `--stt-threads N`, `--stt-active-paths N`, `--tts-threads N` | `JSKIT_VOICE_STT_THREADS`, `JSKIT_VOICE_STT_ACTIVE_PATHS`, `JSKIT_VOICE_TTS_THREADS` | 1, 16, 1 |

Recognition runs in a pool of processes, each with one recognizer, and a
recording stays on the process it started on. Synthesis runs in a pool of
processes, each keeping one voice model loaded. A worker that stops is replaced
for the next request, and the requests it held fail.

The hotwords file adds the host's words to JSKIT's 48, which bias recognition
towards them: one phrase per line (letters, digits, apostrophes and spaces, at
most 100 characters, optionally ` :SCORE`), blank lines and `#` comments
skipped, at most 1000. The spellings file says how heard phrases are written,
one `spoken phrase => Written form` per line:

```text
# Product spellings
vibe sixty four => Vibe64
merc => Merc
```

A spoken phrase is 1 to 100 letters, digits, apostrophes and spaces in any case;
a written form is 1 to 100 characters with no control characters; blank lines
and `#` comments are skipped; at most 1000 phrases, each once. A host's spellings
are added to JSKIT's own (JSKIT, Node.js, PostgreSQL, WebSocket and others) and
replace JSKIT's on a clash. `serve` refuses a file it cannot read, naming the
file, the line and why. The catalogue's recognition model counts both
(`hotwords`, `spellings`). Hotwords make a phrase likelier to be heard; a
spelling only writes it. A host checks a file before writing it with
`parseRecognitionHotwords(text)` and `parseRecognitionSpellings(text)` from
`@jskit-ai/assistant-voice/shared/protocol`, the rules `serve`, the engine and
the stand-in apply.

`runVoiceCli(argv, { createEngine, recognitionVocabulary })` runs the same
commands from code. `createEngine(options)` receives what
`createSherpaSpeechEngine` takes; a host's tests pass
`createStandInSpeechEngine` from `@jskit-ai/assistant-voice/stand-in` to run the
real service with no model. For `serve` it resolves to `{ address, close() }`.

Preparation verifies archive hashes, stages exact model files/configuration,
records file hashes and atomically replaces the model directory. Repeating the
same preparation reuses a verified pack. Stop the service before replacing its
pack, verify, then restart. Normal serving loads models without rehashing them on
every restart. `--download-cache PATH` and `--retain-downloads 1` permit offline
reuse. A pack's hotwords are always JSKIT's; a host adds its own when serving.

## Models and voices

`--pack cori` (the default) uses the existing single Cori voice and English
streaming Zipformer recognizer. `--pack piper` keeps that recognizer and offers
five Piper medium voices at 22,050 Hz:

| Voice | Sound |
| --- | --- |
| Cori (default) | Female, British English |
| Alba | Female, Scottish English |
| Joe | Male, American English |
| Bryce | Male, American English |
| Northern English | Male, British English |

Each Piper voice has a separate model. The service checks every model's metadata
once at start, then each synthesis worker loads the default model. A reply goes
to an idle worker that already has its model, else to an idle worker that loads
it: that worker's process exits before its replacement loads, which releases the
old model and native inference caches. The recognition processes and audio
connections stay running. The first reply that needs a model change includes
model-loading time; later replies on that worker reuse it. Each worker keeps one
model resident, so up to one model per synthesis worker is in RAM: measure the
memory budget with the worker count you run. Workers serve every connection, so
replies from different conversations can also require a model change.

For embedded use, `await createSherpaSpeechEngine(options)` validates the models
and returns the engine. Call `await engine.close()` when its owner shuts down.
The supplied CLI handles both startup failure and shutdown. Cancellation kills
unfinished native synthesis, including a replacement model still loading, and
waits for its process to exit before the worker takes another reply. A completed
load no longer observes its requesting signal, so a later cancellation cannot
close a warm worker reused by another request. The next request recreates a
cancelled worker if needed.

`--pack kokoro` uses Kokoro 1.0 with named female
Heart, Bella and Emma voices, and male Michael, Adam, George and Daniel voices.
The service advertises these IDs/labels; the browser selects a speaker per reply.
Built-in voice labels include their model family: Piper, Kitten, Kokoro or Kokoro
q8f16. Voice IDs and speaker choices remain stable when labels change.
Model weights are not included in the npm artifact.

`--pack kokoro-q8f16` offers all 28 American/British English Kokoro voices with
`model_q8f16.onnx` from the pinned Kokoro 1.0 ONNX Community revision. The 86 MB
mixed int8/fp16 file is SHA-256 checked before staging. Preparation appends only
Sherpa's required ONNX metadata; every original graph/weight byte remains intact.
The installed file keeps its `model_q8f16.onnx` name and its prepared hash is
recorded in the existing integrity manifest. The pack retains Sherpa's pinned
voice table, tokenizer, lexicons, eSpeak data and licenses. It does not load the
full-size Kokoro model. All these English voices share one model at
24,000 Hz; voice selection uses the same settings catalogue and per-reply ID.

The preset ships a CPU provider configuration disabling only ONNX Runtime's
`NchwcTransformer`, which crashes while loading this mixed-precision graph on
x64 with the pinned native runtime. Other graph optimizations remain enabled.
Do not remove this configuration when supplying a custom `serve --config` file.
Measure latency on your server: smaller weights do not guarantee faster CPU
inference or real-time speech. Capture, duplex admission, playback and cancellation
continue through the existing controller and synthesis process.

`--pack piper-kitten-kokoro-q8f16` keeps all five Piper voices and eight Kitten
voices, then adds those 28 Kokoro voices to one catalogue (41 choices). It retains
Piper's Cori default, existing voice IDs and Kitten Bella's 1.15× speed. Kokoro's
files and CPU configuration live beneath `tts/kokoro-q8f16`; Piper and Kitten
files are never overwritten. Each synthesis worker switches models between
replies and releases the previous model before loading another, and stays
loaded while idle. Replies selecting a loaded model reuse it, including another
speaker in the same Kitten/Kokoro model. Cancellation terminates the worker
immediately; its next reply loads a new one. This saves model startup time but
does not reduce the inference required to generate speech. Each worker keeps one
model resident.
Output keeps the existing combined pack's 22,050 Hz rate through the same
resampler. The standalone presets remain available.

`--pack kitten` offers **Bella, Luna, Rosie and Kiki** (female) and
**Jasper, Bruno, Hugo and Leo** (male) from Kitten TTS Micro 0.8. All eight share
one model and retain its native 24,000 Hz output. Bella uses a 1.15× speech speed;
the other voices use normal speed. Kitten does not identify British or Australian
accents in its voice catalogue.
`--pack piper-kitten` combines the five Piper choices with those eight Kitten voices,
listing Kitten first and keeping Cori as the default. It uses Sherpa's resampler inside the synthesis worker
to deliver every voice at 22,050 Hz. Selecting another engine does not replace the
audio connection. Each synthesis worker keeps one model resident, including when
switching between Piper and Kitten. Measure Kitten's latency on the target CPU before
choosing it as a default.

Operators may edit a separate speech configuration JSON and pass `serve --config
FILE` (or `JSKIT_VOICE_CONFIG`). Without an override, serving reads the prepared
pack's `speech.json`. Native `recognizer` and `synthesizer` configuration objects
are forwarded to Sherpa after replacing `${MODELS_ROOT}` in paths. Other fields:

```json
{
  "voices": [
    { "id": "am_michael", "label": "Michael · male · American English", "language": "en-US", "speakerId": 16 },
    { "id": "bf_emma", "label": "Emma · female · British English", "language": "en-GB", "speakerId": 21 }
  ],
  "defaultVoice": "am_michael",
  "recognizerTailPaddingSeconds": 1,
  "recognizerMinimumRms": 0.001,
  "recognitionVocabulary": { "acme labs": "Acme Labs" }
}
```

`recognitionVocabulary` maps literal recognized phrases to application spellings.
It applies only when making all-uppercase recognition readable; mixed-case text
is left intact. The CLI host may supply default vocabulary through its options;
an explicit speech configuration vocabulary replaces those defaults, and
`serve --spellings-file` adds to either, winning on a clash. This does not
change the recognizer's hotwords or load another model.

Each voice may set `speed` between `0.5` and `2` (default `1`). For example,
`"speed": 1.15` increases its synthesis pace by about 15% without changing the
playback sample rate. The setting belongs to that voice; it does not carry over
when another voice is selected.

Merge this example into the Kokoro pack's configuration, retaining its synthesizer
model paths. Speaker IDs are specific to the selected model. Unknown IDs and
invalid/duplicate catalogue entries fail explicitly. Voices do not change a
conversation's reasoning model. Tail padding supplies recognizer lookahead when a
recording ends immediately after a word; it does not wait for wall-clock silence.
Its default is 0.75 seconds, the least that keeps the last word when a recording
ends on it with the default pack (0.45 seconds dropped it: "the latest version"
was heard as "the latest vers"); an explicit value from 0 to 3 seconds overrides it.
The RMS floor is disabled by default (`0`), preserving native silence handling
and finalization. An explicit positive value up to 0.1 gates the initial input;
`0.001` (−60 dBFS) is the opt-in example above. After onset, all frames reach the
recognizer until the utterance ends. With a floor enabled, finalizing an utterance
that never reached the floor returns no words without feeding native lookahead.
This is an input-level check, not a classifier for speech versus noise.
Every sample fed to the recognizer, the lookahead included, gets noise of at
most one 16-bit step (a dither, from a fixed sequence, so the same recording
gives the same words): exact zeros, a muted microphone's digital silence, made
the default pack hear words that were never said.

The synthesis worker has a separate 60-second operation watchdog for model load
and generation. A timeout fails the operation and releases the worker process;
it is a worker lifecycle safeguard, not the microphone's recording limit or an
extension of the original recognition timing policy.

For separate models, use `synthesizers: { modelId: nativeConfiguration }` instead
of `synthesizer`, and give each voice a matching `modelId`. Speaker IDs are checked
against that voice's model. Set `outputSampleRate` (8,000–48,000 Hz) to normalize
different native rates inside the worker. Without it, all models must use the same
output sample rate for the shared audio connection. `models/voice-models-piper.json` contains the complete
five-voice example. The service selects a model per synthesis request; changing a
voice does not redirect an in-flight reply or another conversation.

For other models, `prepare --sources-file FILE` accepts the source manifest shape
shown in `models/voice-models-piper.json`: recognition and synthesis archives, pinned
SHA-256 values, explicit source/destination file mappings and native configuration.
A source entry's optional `format: "file"` stages its pinned download without
archive extraction; the default is `tar.bz2`. `archive`/`archiveSha256` still name
and authenticate that download. The optional `onnxMetadata` object maps staged
`.onnx` paths to string metadata entries, appended after the unchanged source
bytes. `textFiles` maps staged paths to literal native configuration text;
it cannot overwrite a mapped source file. These outputs are covered by the
same prepared-file integrity manifest and atomic replacement as archived models.
Paths in mappings must stay inside their extracted/staged roots. Model compatibility
still needs native inference validation; a matching hash is only integrity proof.

Worker and thread counts, recognition paths, connection and synthesis-queue
limits are explicit CLI/environment options (the table above). Configuration objects can also
set native thread counts. Benchmark both first audio latency and sustained audio
production on the deployment machine before selecting a pack. A higher quality
voice can consume more CPU and respond more slowly.

## Upstream terms and evidence

Models and phonemizer data have their own terms, separate from this package:

- [Zipformer English model](https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26) declares Apache-2.0.
- [Cori model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/cori/medium/MODEL_CARD) describes the LibriVox public-domain dataset; the Piper repository declares MIT.
- [Alba speech corpus](https://doi.org/10.7488/ds/2506): Valentini-Botinhao, Cassia; Yamagishi, Junichi (2019), University of Edinburgh, CC BY 4.0. The Piper model was trained from this corpus; preparation preserves its source notice.
- [Joe model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/joe/medium/MODEL_CARD) declares CC0 source recordings. [Bryce's model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/bryce/medium/MODEL_CARD) declares public-domain recordings supplied by the speaker.
- [Northern English Male model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/northern_english_male/medium/MODEL_CARD) identifies OpenSLR 83 regional UK recordings under CC BY-SA 4.0. Preparation retains the model card.
- [Kokoro model](https://huggingface.co/hexgrad/Kokoro-82M) declares Apache-2.0. Preparation retains the downloaded model's LICENSE.
- [Kitten TTS Micro 0.8](https://huggingface.co/KittenML/kitten-tts-micro-0.8) declares Apache-2.0. Preparation retains its LICENSE and Sherpa conversion notes. Bella is speaker 1 and Jasper is speaker 0 in Sherpa's prepared voice table.
- The archives also contain [eSpeak NG data](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING), with GPL terms. Preserve applicable upstream notices when distributing a prepared pack.

`models/` records pinned source archives; `sources.json` and `voice-models.json`
record what was installed. The optional native test synthesizes and recognizes
real audio, including male/female cases and cancellation:

```sh
JSKIT_VOICE_TEST_MODELS=/srv/speech/models npm test --workspace packages/assistant-voice-sherpa -- test/nativeSpeech.test.js
```

Physical microphone, speaker, echo and interruption acceptance is still required
for a full duplex application. Generated-audio round trips cannot establish it.
