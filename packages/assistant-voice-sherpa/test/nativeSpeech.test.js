import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createSherpaSpeechEngine } from "../src/sherpaSpeechEngine.js";

const modelsRoot = process.env.JSKIT_VOICE_TEST_MODELS;

// A Piper (VITS) model samples its speech's pitch and timing at random (noise scales 0.667 and 0.8), so each synthesis,
// and the transcript of it, differs: one run in fourteen heard "the latest diversion". Near-zero scales (sherpa-onnx
// reads 0 as its default) give the same speech, and so the same transcript, on every run. Without a configured
// synthesizer, the engine's own default model, written out here.
const STEADY = { noiseScale: 1e-6, noiseScaleW: 1e-6 };
const steady = synthesizer => synthesizer.model?.vits
  ? { ...synthesizer, model: { ...synthesizer.model, vits: { ...synthesizer.model.vits, ...STEADY } } }
  : synthesizer;
function steadySpeech(configuration) {
  if (configuration.synthesizers) {
    return { ...configuration,
      synthesizers: Object.fromEntries(Object.entries(configuration.synthesizers).map(([id, synthesizer]) => [id, steady(synthesizer)])) };
  }
  return { ...configuration, synthesizer: steady(configuration.synthesizer || { maxNumSentences: 1, model: { numThreads: 1, provider: "cpu",
    vits: { dataDir: path.join(modelsRoot, "tts", "espeak-ng-data"), model: path.join(modelsRoot, "tts", "model.onnx"),
      tokens: path.join(modelsRoot, "tts", "tokens.txt") } } }) };
}

test("real installed models synthesize configured voices, retain the last spoken word and cancel output", { skip: !modelsRoot, timeout: 120000 }, async t => {
  const configuration = steadySpeech(JSON.parse(await readFile(path.join(modelsRoot, "speech.json"), "utf8")));
  const loadStarted = performance.now();
  const engine = await createSherpaSpeechEngine({ modelsRoot, configuration, recognitionWorkers: 1, synthesisWorkers: 1 });
  t.after(() => engine.close());
  t.diagnostic(JSON.stringify({ modelLoadMs: Math.round(performance.now() - loadStarted), parentRss: process.memoryUsage().rss }));
  const choices = process.env.JSKIT_VOICE_TEST_VOICES?.split(",") || [engine.voices[0].id, engine.voices.at(-1).id];
  let lastRecording;
  for (const voiceId of new Set(choices)) {
    const frames = []; const started = performance.now(); const cpuStarted = process.cpuUsage(); let firstAudioMs;
    const result = await engine.synthesize("The project is ready. Please check the latest version.", { voiceId,
      onAudio(frame) { firstAudioMs ??= Math.round(performance.now() - started); frames.push(frame); } });
    const speechMs = Math.round(performance.now() - started);
    const cpu = process.cpuUsage(cpuStarted);
    assert.equal(result.cancelled, false);
    const pcm = Buffer.concat(frames); assert.ok(pcm.length > 24000);
    const mono16k = Buffer.alloc(Math.floor(pcm.length / 2 * 16000 / result.sampleRate) * 2);
    for (let i = 0; i < mono16k.length / 2; i++) {
      const position = i * result.sampleRate / 16000; const left = Math.floor(position); const right = Math.min(left + 1, pcm.length / 2 - 1);
      mono16k.writeInt16LE(Math.round(pcm.readInt16LE(left * 2) * (1 - position + left) + pcm.readInt16LE(right * 2) * (position - left)), i * 2);
    }
    // The recording ends where its last word does (its trailing silence, under 1% of full scale, cut), as one does
    // when the person stops it on that word. No extra input silence: finish() must flush the model's last word itself.
    let end = mono16k.length / 2;
    while (end > 0 && Math.abs(mono16k.readInt16LE((end - 1) * 2)) < 328) end -= 1;
    const spoken = mono16k.subarray(0, end * 2);
    const recognition = engine.createListeningSession();
    for (let i = 0; i < spoken.length; i += 3200) await recognition.acceptPcm(spoken.subarray(i, i + 3200));
    const transcript = await recognition.finish();
    assert.match(transcript, /project.*ready/iu); assert.match(transcript, /latest version/iu);
    lastRecording = mono16k;
    t.diagnostic(JSON.stringify({ voiceId, firstAudioMs, speechMs, parentCpuMs: Math.round((cpu.user + cpu.system) / 1000),
      audioSeconds: pcm.length / 2 / result.sampleRate, parentRss: process.memoryUsage().rss }));
  }
  const controller = new AbortController(); let chunks = 0;
  const cancelled = await engine.synthesize("Stop after this sentence. This later sentence must not play.", {
    signal: controller.signal, onAudio() { chunks += 1; controller.abort(); }
  });
  assert.equal(cancelled.cancelled, true); assert.equal(chunks, 1);
  const resumed = await engine.synthesize("The voice connection is ready again.");
  assert.equal(resumed.cancelled, false);
  assert.ok(resumed.samples > 22050, "synthesis recreates a cancelled worker");

  const endpoints = [];
  const continuous = engine.createListeningSession({ continuous: true, onEndpoint: text => endpoints.push(text) });
  // A continuously open microphone must not turn silence into new requests,
  // either before speech or after committing the previous utterance.
  for (let i = 0; i < 100; i++) await continuous.acceptPcm(Buffer.alloc(3200));
  assert.deepEqual(endpoints, [], "initial silence must not produce words");
  for (let i = 0; i < lastRecording.length; i += 3200) await continuous.acceptPcm(lastRecording.subarray(i, i + 3200));
  for (let i = 0; i < 40 && endpoints.length === 0; i++) await continuous.acceptPcm(Buffer.alloc(3200));
  assert.equal(endpoints.length, 1);
  await continuous.reset();
  for (let i = 0; i < 100; i++) await continuous.acceptPcm(Buffer.alloc(3200));
  assert.equal(endpoints.length, 1, "silence after a committed utterance must not produce another request");
  assert.equal(await continuous.finish(), "");
});
