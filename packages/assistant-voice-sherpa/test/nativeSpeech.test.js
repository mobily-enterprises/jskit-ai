import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createSherpaSpeechEngine } from "../src/sherpaSpeechEngine.js";

const modelsRoot = process.env.JSKIT_VOICE_TEST_MODELS;
test("real installed models synthesize configured voices, retain the last spoken word and cancel output", { skip: !modelsRoot, timeout: 120000 }, async t => {
  const configuration = JSON.parse(await readFile(path.join(modelsRoot, "speech.json"), "utf8"));
  const loadStarted = performance.now();
  const engine = await createSherpaSpeechEngine({ modelsRoot, configuration });
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
    const recognition = engine.createListeningSession();
    for (let i = 0; i < mono16k.length; i += 3200) recognition.acceptPcm(mono16k.subarray(i, i + 3200));
    // No extra input silence: finish() must flush the model's last word itself.
    const transcript = recognition.finish();
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
  for (let i = 0; i < 100; i++) continuous.acceptPcm(Buffer.alloc(3200));
  assert.deepEqual(endpoints, [], "initial silence must not produce words");
  for (let i = 0; i < lastRecording.length; i += 3200) continuous.acceptPcm(lastRecording.subarray(i, i + 3200));
  for (let i = 0; i < 40 && endpoints.length === 0; i++) continuous.acceptPcm(Buffer.alloc(3200));
  assert.equal(endpoints.length, 1);
  continuous.reset();
  for (let i = 0; i < 100; i++) continuous.acceptPcm(Buffer.alloc(3200));
  assert.equal(endpoints.length, 1, "silence after a committed utterance must not produce another request");
  assert.equal(continuous.finish(), "");
});
