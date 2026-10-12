import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sha256File, verifyVoiceModelContract } from '../src/voiceModelContract.js';
import { createSherpaSpeechEngine, positiveActivePathCount } from '../src/sherpaSpeechEngine.js';

test("streaming recognition uses bounded beam search and its installed technical vocabulary", async () => {
  let recognizerConfig = null;
  let synthesizerConfig = null;
  let result = "";
  let resets = 0;
  const waveforms = [];
  let finishes = 0;
  class OnlineRecognizer {
    constructor(config) {
      recognizerConfig = config;
    }
    createStream() { return { acceptWaveform(frame) { waveforms.push(frame); }, inputFinished() { finishes += 1; } }; }
    isReady() { return false; }
    getResult() { return { text: result }; }
    isEndpoint() { return true; }
    reset() { resets += 1; result = ""; }
  }
  const modelsRoot = path.resolve("/tmp/vibe64-voice-models");
  const engine = await createSherpaSpeechEngine({
    modelsRoot,
    configuration: { recognitionVocabulary: { "acme labs": "Acme Labs" } },
    recognizerActivePaths: 16,
    synthesizerThreads: 2,
    createSynthesizer: async config => {
      synthesizerConfig = config;
      return { sampleRate: 22050, numSpeakers: 1, running: true, async close() {} };
    },
    sherpa: {
      OnlineRecognizer,
      gitSha1: "test",
      onnxruntimeVersion: "test",
      version: "test"
    }
  });

  assert.equal(recognizerConfig.decodingMethod, "modified_beam_search");
  assert.equal(synthesizerConfig.model.numThreads, 2);
  assert.equal(synthesizerConfig.model.provider, "cpu");
  assert.equal(synthesizerConfig.numThreads, undefined);
  assert.equal(recognizerConfig.maxActivePaths, 16);
  assert.equal(recognizerConfig.hotwordsScore, 1.5);
  assert.equal(recognizerConfig.hotwordsFile, path.join(modelsRoot, "stt", "hotwords.txt"));
  assert.equal(recognizerConfig.modelConfig.modelingUnit, "bpe");
  assert.equal(recognizerConfig.modelConfig.bpeVocab, path.join(modelsRoot, "stt", "bpe.vocab"));
  assert.equal(positiveActivePathCount(0), 16);
  assert.equal(positiveActivePathCount(65), 16);
  assert.equal(recognizerConfig.enableEndpoint, 1);
  const endpoints = [];
  const listening = engine.createListeningSession({ continuous: true, onEndpoint: text => endpoints.push(text) });
  listening.acceptPcm(Buffer.alloc(320));
  assert.equal(resets, 1, "silence resets the recording budget without becoming a turn");
  result = "I MEANT SUGAR";
  listening.acceptPcm(Buffer.alloc(320));
  listening.acceptPcm(Buffer.alloc(320));
  assert.deepEqual(endpoints, ["I meant sugar"], "one stable endpoint is offered once");
  assert.equal(listening.reset(), "I meant sugar");
  assert.equal(listening.acceptedSamples, 0);
  result = "A SECOND TURN";
  listening.acceptPcm(Buffer.alloc(320));
  assert.deepEqual(endpoints, ["I meant sugar", "A second turn"]);
  listening.reset();
  result = "ACME LABS USES SQL";
  listening.acceptPcm(Buffer.alloc(320));
  assert.equal(endpoints.at(-1), "Acme Labs uses SQL");
  assert.equal(listening.finish(), "Acme Labs uses SQL");
  assert.equal(waveforms.at(-1).samples.length, 7200, "default finalization preserves the original 0.45-second lookahead");
  listening.cancel();
  assert.equal(listening.isEndpoint(), false);
  result = "";
  assert.equal(engine.createListeningSession().finish(), "");
  assert.equal(waveforms.at(-1).samples.length, 7200, "default empty finalization still feeds native lookahead");
  assert.equal(finishes, 2);
});

test("an explicit RMS floor gates only onset and retains configured final lookahead", async () => {
  let result = "";
  let resets = 0;
  let finishes = 0;
  const waveforms = [];
  class OnlineRecognizer {
    createStream() { return { acceptWaveform(frame) { waveforms.push(frame); }, inputFinished() { finishes += 1; } }; }
    isReady() { return false; }
    getResult() { return { text: result }; }
    isEndpoint() { return true; }
    reset() { resets += 1; result = ""; }
  }
  const engine = await createSherpaSpeechEngine({
    modelsRoot: path.resolve("/tmp/vibe64-voice-models"),
    configuration: { recognizerMinimumRms: 0.001, recognizerTailPaddingSeconds: 1 },
    createSynthesizer: async () => ({ sampleRate: 22050, numSpeakers: 1, running: true, async close() {} }),
    sherpa: { OnlineRecognizer }
  });
  const endpoints = [];
  const listening = engine.createListeningSession({ continuous: true, onEndpoint: text => endpoints.push(text) });
  const speechFrame = Buffer.alloc(320);
  for (let i = 0; i < speechFrame.length; i += 2) speechFrame.writeInt16LE(1000, i);
  const quietFrame = Buffer.alloc(320);
  for (let i = 0; i < quietFrame.length; i += 2) quietFrame.writeInt16LE(20, i);
  listening.acceptPcm(Buffer.alloc(320));
  listening.acceptPcm(quietFrame);
  assert.equal(resets, 0, "silence cannot start a native utterance with an explicit floor");
  assert.equal(listening.acceptedSamples, 0);
  assert.equal(waveforms.length, 0);
  result = "I MEANT SUGAR";
  listening.acceptPcm(speechFrame);
  listening.acceptPcm(Buffer.alloc(320));
  listening.acceptPcm(quietFrame);
  assert.equal(listening.acceptedSamples, 480, "all silence and quiet frames are retained after onset");
  assert.deepEqual(endpoints, ["I meant sugar"], "one stable endpoint is offered once");
  assert.equal(listening.reset(), "I meant sugar");
  assert.equal(listening.acceptedSamples, 0);
  result = "A SECOND TURN";
  listening.acceptPcm(Buffer.alloc(320));
  assert.deepEqual(endpoints, ["I meant sugar"], "a native hallucination from silence is not a new utterance");
  listening.acceptPcm(speechFrame);
  assert.deepEqual(endpoints, ["I meant sugar", "A second turn"]);
  assert.equal(listening.finish(), "A second turn");
  assert.equal(waveforms.at(-1).samples.length, 16000, "explicit one-second lookahead remains supported");
  const framesBeforeEmptyFinish = waveforms.length;
  assert.equal(engine.createListeningSession().finish(), "");
  assert.equal(waveforms.length, framesBeforeEmptyFinish, "an explicit floor suppresses empty native finalization");
  assert.equal(finishes, 1);
});

test("voice model contracts verify every selected file", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-voice-model-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { force: true, recursive: true });
  });
  await mkdir(path.join(root, "stt"));
  const modelFile = path.join(root, "stt", "tokens.txt");
  await writeFile(modelFile, "token\n");
  const contract = {
    files: [{
      bytes: 6,
      path: "stt/tokens.txt",
      sha256: await sha256File(modelFile)
    }],
    schema: "vibe64.voice-models.v1"
  };
  await writeFile(path.join(root, "voice-models.json"), JSON.stringify(contract));
  assert.equal((await verifyVoiceModelContract({ modelsRoot: root })).files.length, 1);
  await writeFile(modelFile, "changed\n");
  await assert.rejects(
    verifyVoiceModelContract({ modelsRoot: root }),
    { code: "voice_model_file_size_mismatch" }
  );
});

test("operator model configuration and named voices reach native synthesis without shared selection state", async () => {
  let recognizer;
  let synthesizer;
  const speakers = [];
  const engine = await createSherpaSpeechEngine({ modelsRoot: "/tmp/custom-speech", configuration: {
    recognizer: { modelConfig: { tokens: "${MODELS_ROOT}/different/tokens.txt" } },
    synthesizer: { model: { kokoro: { model: "${MODELS_ROOT}/tts/model.onnx", voices: "${MODELS_ROOT}/tts/voices.bin" } } },
    voices: [{ id: "male", label: "Male", speakerId: 1 }, { id: "female", label: "Female", speakerId: 0, speed: 1.15 }], defaultVoice: "female"
  }, sherpa: {
    OnlineRecognizer: class { constructor(config) { recognizer = config; } }
  }, createSynthesizer: async config => {
    synthesizer = config;
    return { sampleRate: 24000, numSpeakers: 2, running: true, async close() {},
      async synthesize(text, { speakerId, speed, onAudio = () => null }) { speakers.push({ speakerId, speed }); onAudio(Buffer.alloc(4)); }
    };
  } });
  assert.equal(recognizer.modelConfig.tokens, "/tmp/custom-speech/different/tokens.txt");
  assert.equal(synthesizer.model.kokoro.voices, "/tmp/custom-speech/tts/voices.bin");
  assert.equal(engine.sampleRate, 24000);
  const audio = [];
  await engine.synthesize("Male voice.", { voiceId: "male", onAudio: frame => audio.push(frame) });
  await engine.synthesize("Default voice.");
  await engine.synthesize("Male voice again.", { voiceId: "male" });
  assert.deepEqual(speakers, [{ speakerId: 1, speed: 1 }, { speakerId: 0, speed: 1.15 }, { speakerId: 1, speed: 1 }]);
  assert.equal(audio[0].length, 4);
  await assert.rejects(engine.synthesize("No.", { voiceId: "unknown" }), /not available/u);
  assert.equal(speakers.length, 3);
  assert.equal(engine.defaultVoice, "female");
});

test("Piper retains one model, releases it before switching and reuses an unchanged voice", async t => {
  const loaded = [];
  const spoken = [];
  const ids = ["cori", "alba", "joe", "bryce"];
  let resident = 0;
  const engine = await createSherpaSpeechEngine({ modelsRoot: "/tmp/piper", configuration: {
    synthesizers: Object.fromEntries(ids.map(id => [id, { model: { vits: { model: `\${MODELS_ROOT}/tts/${id}.onnx` } } }])),
    voices: ids.map(id => ({ id, label: id, modelId: id, speakerId: 0 })), defaultVoice: "cori"
  }, sherpa: { OnlineRecognizer: class {} }, createSynthesizer: async config => {
    assert.equal(resident, 0, "the previous model must have exited before loading its replacement");
    resident += 1;
    const model = config.model.vits.model;
    loaded.push(model);
    let running = true;
    return { sampleRate: 22050, numSpeakers: 1, get running() { return running; },
      async close() { if (running) { await new Promise(resolve => setImmediate(resolve)); running = false; resident -= 1; } },
      async synthesize(text, { speakerId }) { spoken.push({ model, speaker: speakerId }); return { sampleRate: 22050 }; }
    };
  } });
  t.after(() => engine.close());
  const expected = ids.map(id => `/tmp/piper/tts/${id}.onnx`);
  assert.deepEqual(loaded, [...expected.slice(1), expected[0]], "validate each model, finishing with the default");
  assert.equal(resident, 1);
  for (const voiceId of [...ids, ...ids]) assert.equal((await engine.synthesize("Hello.", { voiceId })).sampleRate, 22050);
  await engine.synthesize("Default again.");
  const count = loaded.length;
  await engine.synthesize("Unchanged default.");
  assert.equal(loaded.length, count, "unchanged voices reuse their model");
  assert.deepEqual(spoken.map(entry => entry.model), [...expected, ...expected, expected[0], expected[0]]);
  assert.ok(spoken.every(entry => entry.speaker === 0));
  await assert.rejects(engine.synthesize("No.", { voiceId: "missing" }), /not available/u);
  await engine.close();
  assert.equal(resident, 0);
  await assert.rejects(engine.synthesize("After close."), /closed/u);
});

test("voice model validation releases incompatible models and rejects invalid speakers", async () => {
  const synthesizers = { female: { sampleRate: 22050 }, male: { sampleRate: 24000 } };
  const configuration = { synthesizers, voices: [
    { id: "female", label: "Female", modelId: "female", speakerId: 0 },
    { id: "male", label: "Male", modelId: "male", speakerId: 0 }
  ] };
  let resident = 0;
  const options = { configuration, sherpa: { OnlineRecognizer: class {} }, createSynthesizer: async (config, { outputSampleRate }) => {
    resident += 1;
    return { sampleRate: outputSampleRate || config.sampleRate, numSpeakers: 1, running: true, async close() { resident -= 1; } };
  } };
  for (const speed of [0, 0.49, 2.01, NaN, Infinity, "1.15", null]) {
    configuration.voices[0].speed = speed;
    await assert.rejects(createSherpaSpeechEngine(options), /Voice speed/u);
    assert.equal(resident, 0);
  }
  delete configuration.voices[0].speed;
  await assert.rejects(createSherpaSpeechEngine(options), /same output sample rate/u);
  assert.equal(resident, 0);
  configuration.outputSampleRate = 22050;
  const mixed = await createSherpaSpeechEngine(options);
  assert.equal(mixed.sampleRate, 22050);
  assert.equal(resident, 1);
  await mixed.close();
  assert.equal(resident, 0);
  configuration.outputSampleRate = 0;
  await assert.rejects(createSherpaSpeechEngine(options), /Output sample rate/u);
  delete configuration.outputSampleRate;
  configuration.voices[1].modelId = "missing";
  await assert.rejects(createSherpaSpeechEngine(options), /configured synthesizer model/u);
  configuration.voices[1].modelId = "female";
  configuration.voices[1].speakerId = 1;
  await assert.rejects(createSherpaSpeechEngine(options), /valid model speaker IDs/u);
  assert.equal(resident, 0);
});

test("a model change cannot replace a worker still synthesizing", async t => {
  let finish;
  let closed = false;
  const engine = await createSherpaSpeechEngine({ sherpa: { OnlineRecognizer: class {} }, createSynthesizer: async () => ({
    running: true, sampleRate: 22050, numSpeakers: 1,
    async close() { closed = true; },
    synthesize() { return new Promise(resolve => { finish = resolve; }); }
  }) });
  t.after(() => engine.close());
  const first = engine.synthesize("First.");
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(engine.synthesize("Second."), /already running/u);
  assert.equal(closed, false);
  finish({ sampleRate: 22050 });
  await first;
});

test("closing while a replacement loads waits for its native owner to exit", async () => {
  let resumeLoad;
  let block = false;
  let resident = 0;
  const engine = await createSherpaSpeechEngine({ configuration: {
    synthesizers: { a: {}, b: {} },
    voices: ["a", "b"].map(id => ({ id, label: id, modelId: id, speakerId: 0 }))
  }, sherpa: { OnlineRecognizer: class {} }, createSynthesizer: async () => {
    if (block) await new Promise(resolve => { resumeLoad = resolve; });
    let running = true;
    resident += 1;
    return { sampleRate: 22050, numSpeakers: 1, get running() { return running; },
      async close() { if (running) { running = false; resident -= 1; } }
    };
  } });
  block = true;
  const switching = assert.rejects(engine.synthesize("Switch.", { voiceId: "b" }), /closed/u);
  await new Promise(resolve => setImmediate(resolve));
  const closing = engine.close();
  resumeLoad();
  await Promise.all([switching, closing]);
  assert.equal(resident, 0);
});


test("aborting replacement loading releases its native worker and the existing shared queue", { timeout: 5_000 }, async t => {
  const { readFile, rm } = await import("node:fs/promises");
  const { createSynthesisProcess } = await import("../src/synthesisProcess.js");
  const { createBoundedSerialQueue } = await import("../../assistant-voice/src/server/voiceDaemon.js");
  const root = await mkdtemp(path.join(os.tmpdir(), "speech-load-abort-"));
  const pidFile = path.join(root, "loading.pid");
  const controller = new AbortController();
  const queue = createBoundedSerialQueue({ maximumQueued: 1 });
  let holdNext = false;
  let heldSignal;
  let engine;
  let pid;
  t.after(async () => {
    controller.abort();
    if (pid) {
      try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    queue.close();
    await engine?.close();
    await rm(root, { recursive: true, force: true });
  });
  engine = await createSherpaSpeechEngine({ configuration: {
    synthesizers: { a: { id: "a" }, b: { id: "b" } },
    voices: ["a", "b"].map(id => ({ id, label: id, modelId: id, speakerId: 0 })),
    defaultVoice: "a"
  }, sherpa: { OnlineRecognizer: class {} }, createSynthesizer: (config, options) => {
    if (holdNext && config.id === "b") {
      holdNext = false;
      heldSignal = options.signal;
      config = { ...config, holdLoadPidFile: pidFile };
    }
    return createSynthesisProcess(config, {
      ...options, workerUrl: new URL("./fixtures/synthesisWorker.js", import.meta.url)
    });
  } });
  holdNext = true;
  const cancelledAudio = [];
  const switching = queue.run(() => engine.synthesize("Cancelled request.", {
    voiceId: "b", signal: controller.signal, onAudio: frame => cancelledAudio.push(frame)
  }));
  for (let tries = 0; tries < 200; tries += 1) {
    try { pid = Number(await readFile(pidFile, "utf8")); break; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "the actual replacement child reached its held load");
  assert.equal(heldSignal, controller.signal, "only the admitted loading request owns this abort signal");
  const nextAudio = [];
  const next = queue.run(() => {
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "the prior worker exited before the next owner runs");
    return engine.synthesize("Independent next request.", { voiceId: "a", onAudio: frame => nextAudio.push(frame) });
  });
  assert.equal(queue.depth, 2, "one held request and one independent queued request");
  controller.abort();
  assert.deepEqual(await switching, { cancelled: true, sampleRate: 22050, samples: 0 });
  assert.deepEqual(cancelledAudio, [], "loading cancellation cannot generate or deliver audio");
  assert.deepEqual(await next, { cancelled: false, sampleRate: 22050, samples: 2 });
  assert.deepEqual(nextAudio, [Buffer.from([1, 0, 2, 0])]);
  assert.equal(queue.depth, 0);
  assert.equal((await engine.synthesize("Reuse the next owner's warm worker.", { voiceId: "a" })).cancelled, false);
});
