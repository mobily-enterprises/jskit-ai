import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sha256File, verifyVoiceModelContract } from '../src/voiceModelContract.js';
import { createSherpaSpeechEngine, positiveActivePathCount } from '../src/sherpaSpeechEngine.js';
import { createRecognitionSession, warmRecognizer } from '../src/recognitionSession.js';

// The recognition process interface, run in this process on a stand-in native
// recognizer, so a test sees the configuration and recordings the engine gives it.
function inProcessRecognizer(recognizer, options = {}) {
  let running = true;
  return {
    get running() { return running; },
    runtime: { version: "test" },
    openRecording(callbacks) {
      const session = createRecognitionSession(recognizer, { ...options, ...callbacks });
      return {
        acceptPcm: async frame => session.acceptPcm(frame),
        finish: async () => session.finish(),
        reset: async () => session.reset(),
        isEndpoint: async () => session.isEndpoint(),
        cancel: () => session.cancel(),
        get acceptedSamples() { return session.acceptedSamples; }
      };
    },
    async warmup() { warmRecognizer(recognizer); },
    async close() { running = false; }
  };
}

function recognizerFrom(OnlineRecognizer, seen = () => null) {
  return async (config, { options }) => {
    seen(config, options);
    return inProcessRecognizer(new OnlineRecognizer(config), options);
  };
}

class SilentRecognizer {}

const singleWorkers = { recognitionWorkers: 1, synthesisWorkers: 1 };

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
  const modelsRoot = path.resolve("/tmp/jskit-voice-models");
  const engine = await createSherpaSpeechEngine({
    ...singleWorkers,
    modelsRoot,
    configuration: { recognitionVocabulary: { "acme labs": "Acme Labs" } },
    recognizerActivePaths: 16,
    synthesizerThreads: 2,
    createSynthesizer: async config => {
      synthesizerConfig = config;
      return { sampleRate: 22050, numSpeakers: 1, running: true, async close() {} };
    },
    createRecognizer: recognizerFrom(OnlineRecognizer)
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
  await listening.acceptPcm(Buffer.alloc(320));
  assert.equal(resets, 1, "silence resets the recording budget without becoming a turn");
  result = "I MEANT SUGAR";
  await listening.acceptPcm(Buffer.alloc(320));
  await listening.acceptPcm(Buffer.alloc(320));
  assert.deepEqual(endpoints, ["I meant sugar"], "one stable endpoint is offered once");
  assert.equal(await listening.reset(), "I meant sugar");
  assert.equal(listening.acceptedSamples, 0);
  result = "A SECOND TURN";
  await listening.acceptPcm(Buffer.alloc(320));
  assert.deepEqual(endpoints, ["I meant sugar", "A second turn"]);
  await listening.reset();
  result = "ACME LABS USES SQL";
  await listening.acceptPcm(Buffer.alloc(320));
  assert.equal(endpoints.at(-1), "Acme Labs uses SQL");
  assert.equal(await listening.finish(), "Acme Labs uses SQL");
  assert.equal(waveforms.at(-1).samples.length, 12000, "default finalization feeds 0.75 seconds of lookahead");
  listening.cancel();
  assert.equal(await listening.isEndpoint(), false);
  result = "";
  assert.equal(await engine.createListeningSession().finish(), "");
  assert.equal(waveforms.at(-1).samples.length, 12000, "default empty finalization still feeds native lookahead");
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
    ...singleWorkers,
    modelsRoot: path.resolve("/tmp/jskit-voice-models"),
    configuration: { recognizerMinimumRms: 0.001, recognizerTailPaddingSeconds: 1 },
    createSynthesizer: async () => ({ sampleRate: 22050, numSpeakers: 1, running: true, async close() {} }),
    createRecognizer: recognizerFrom(OnlineRecognizer)
  });
  const endpoints = [];
  const listening = engine.createListeningSession({ continuous: true, onEndpoint: text => endpoints.push(text) });
  const speechFrame = Buffer.alloc(320);
  for (let i = 0; i < speechFrame.length; i += 2) speechFrame.writeInt16LE(1000, i);
  const quietFrame = Buffer.alloc(320);
  for (let i = 0; i < quietFrame.length; i += 2) quietFrame.writeInt16LE(20, i);
  await listening.acceptPcm(Buffer.alloc(320));
  await listening.acceptPcm(quietFrame);
  assert.equal(resets, 0, "silence cannot start a native utterance with an explicit floor");
  assert.equal(listening.acceptedSamples, 0);
  assert.equal(waveforms.length, 0);
  result = "I MEANT SUGAR";
  await listening.acceptPcm(speechFrame);
  await listening.acceptPcm(Buffer.alloc(320));
  await listening.acceptPcm(quietFrame);
  assert.equal(listening.acceptedSamples, 480, "all silence and quiet frames are retained after onset");
  assert.deepEqual(endpoints, ["I meant sugar"], "one stable endpoint is offered once");
  assert.equal(await listening.reset(), "I meant sugar");
  assert.equal(listening.acceptedSamples, 0);
  result = "A SECOND TURN";
  await listening.acceptPcm(Buffer.alloc(320));
  assert.deepEqual(endpoints, ["I meant sugar"], "a native hallucination from silence is not a new utterance");
  await listening.acceptPcm(speechFrame);
  assert.deepEqual(endpoints, ["I meant sugar", "A second turn"]);
  assert.equal(await listening.finish(), "A second turn");
  assert.equal(waveforms.at(-1).samples.length, 16000, "explicit one-second lookahead remains supported");
  const framesBeforeEmptyFinish = waveforms.length;
  assert.equal(await engine.createListeningSession().finish(), "");
  assert.equal(waveforms.length, framesBeforeEmptyFinish, "an explicit floor suppresses empty native finalization");
  assert.equal(finishes, 1);
});

test("voice model contracts verify every selected file", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-model-"));
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
    schema: "jskit.assistant-voice.models.v1"
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
  const engine = await createSherpaSpeechEngine({ ...singleWorkers, modelsRoot: "/tmp/custom-speech", configuration: {
    recognizer: { modelConfig: { tokens: "${MODELS_ROOT}/different/tokens.txt" } },
    synthesizer: { model: { kokoro: { model: "${MODELS_ROOT}/tts/model.onnx", voices: "${MODELS_ROOT}/tts/voices.bin" } } },
    voices: [{ id: "male", label: "Male", speakerId: 1 }, { id: "female", label: "Female", speakerId: 0, speed: 1.15 }], defaultVoice: "female"
  }, createRecognizer: recognizerFrom(SilentRecognizer, config => { recognizer = config; }), createSynthesizer: async config => {
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
  const engine = await createSherpaSpeechEngine({ ...singleWorkers, modelsRoot: "/tmp/piper", configuration: {
    synthesizers: Object.fromEntries(ids.map(id => [id, { model: { vits: { model: `\${MODELS_ROOT}/tts/${id}.onnx` } } }])),
    voices: ids.map(id => ({ id, label: id, modelId: id, speakerId: 0 })), defaultVoice: "cori"
  }, createRecognizer: recognizerFrom(SilentRecognizer), createSynthesizer: async config => {
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
  const options = { ...singleWorkers, configuration, createRecognizer: recognizerFrom(SilentRecognizer), createSynthesizer: async (config, { outputSampleRate }) => {
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

test("a request waits for a busy synthesis worker instead of replacing it", async t => {
  const finishes = [];
  let closed = false;
  const engine = await createSherpaSpeechEngine({ ...singleWorkers, createRecognizer: recognizerFrom(SilentRecognizer), createSynthesizer: async () => ({
    running: true, sampleRate: 22050, numSpeakers: 1,
    async close() { closed = true; },
    synthesize(text) { return new Promise(resolve => { finishes.push(() => resolve({ text, sampleRate: 22050 })); }); }
  }) });
  t.after(() => engine.close());
  const first = engine.synthesize("First.");
  await new Promise(resolve => setImmediate(resolve));
  const second = engine.synthesize("Second.");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finishes.length, 1, "the second request waits for the only worker");
  assert.equal(closed, false);
  finishes[0]();
  assert.equal((await first).text, "First.");
  await new Promise(resolve => setImmediate(resolve));
  finishes[1]();
  assert.equal((await second).text, "Second.");
  assert.equal(closed, false);
});

test("closing while a replacement loads waits for its native owner to exit", async () => {
  let resumeLoad;
  let block = false;
  let resident = 0;
  const engine = await createSherpaSpeechEngine({ ...singleWorkers, configuration: {
    synthesizers: { a: {}, b: {} },
    voices: ["a", "b"].map(id => ({ id, label: id, modelId: id, speakerId: 0 }))
  }, createRecognizer: recognizerFrom(SilentRecognizer), createSynthesizer: async () => {
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
  const { createBoundedSpeechQueue } = await import("../../assistant-voice/src/server/voiceDaemon.js");
  const root = await mkdtemp(path.join(os.tmpdir(), "speech-load-abort-"));
  const pidFile = path.join(root, "loading.pid");
  const controller = new AbortController();
  const queue = createBoundedSpeechQueue({ maximumQueued: 1 });
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
  engine = await createSherpaSpeechEngine({ ...singleWorkers, configuration: {
    synthesizers: { a: { id: "a" }, b: { id: "b" } },
    voices: ["a", "b"].map(id => ({ id, label: id, modelId: id, speakerId: 0 })),
    defaultVoice: "a"
  }, createRecognizer: recognizerFrom(SilentRecognizer), createSynthesizer: (config, options) => {
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

test("a host's hotwords are added to the prepared pack's, each phrase once, and the catalogue counts them", async t => {
  const modelsRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-hotwords-root-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(modelsRoot, { force: true, recursive: true });
  });
  const { readFile } = await import("node:fs/promises");
  const prepared = await readFile(new URL("../models/voice-hotwords.txt", import.meta.url), "utf8");
  await mkdir(path.join(modelsRoot, "stt"));
  await writeFile(path.join(modelsRoot, "stt", "hotwords.txt"), prepared);
  await writeFile(path.join(modelsRoot, "sources.json"), await readFile(new URL("../models/voice-models.json", import.meta.url)));
  const configurations = [];
  const options = {
    ...singleWorkers,
    modelsRoot,
    createSynthesizer: async () => ({ sampleRate: 22050, numSpeakers: 1, running: true, async close() {} }),
    createRecognizer: recognizerFrom(SilentRecognizer, config => configurations.push(config))
  };
  const plain = await createSherpaSpeechEngine(options);
  await plain.close();
  const preparedLines = prepared.trim().split("\n");
  assert.equal(preparedLines.length, 48);
  assert.equal(configurations[0].hotwordsFile, path.join(modelsRoot, "stt", "hotwords.txt"), "without additions the pack's file is used as it is");
  assert.deepEqual(plain.recognitionModels, [{ id: "streaming-zipformer-en-2023-06-26", hotwords: 48, spellings: 41 }]);

  const engine = await createSherpaSpeechEngine({ ...options, hotwords: ["Mercbot", "  vibe   sixty four :2.5 ", "jskit", "MERCBOT"] });
  const file = configurations[1].hotwordsFile;
  assert.notEqual(path.dirname(file), path.join(modelsRoot, "stt"), "the pack is never written");
  assert.deepEqual((await readFile(file, "utf8")).trim().split("\n"), [...preparedLines, "MERCBOT", "VIBE SIXTY FOUR :2.5"]);
  assert.equal(await readFile(path.join(modelsRoot, "stt", "hotwords.txt"), "utf8"), prepared);
  assert.deepEqual(engine.recognitionModels, [{ id: "streaming-zipformer-en-2023-06-26", hotwords: 50, spellings: 41 }]);
  await engine.close();
  await assert.rejects(readFile(file), { code: "ENOENT" }, "closing removes the merged hotwords");

  for (const hotwords of [["semi;colon"], ["a".repeat(101)], [""], "MERCBOT", Array.from({ length: 1001 }, (_, index) => `WORD ${index}`)]) {
    await assert.rejects(createSherpaSpeechEngine({ ...options, hotwords }), /Hotword/u);
  }
  await assert.rejects(createSherpaSpeechEngine({ ...options, hotwords: ["Mercbot", "Vibe64.com"] }), {
    name: "TypeError",
    message: 'Hotword "Vibe64.com": "." is not allowed; a hotword is 1 to 100 letters, digits, apostrophes and spaces, with an optional " :SCORE".'
  }, "the engine refuses by the rule a host checks with parseRecognitionHotwords");
});

test("each synthesis worker keeps its model, replies for different models run at once, and a reply goes to the worker that has its model", async t => {
  const loads = [];
  const running = [];
  const finishes = new Map();
  const engine = await createSherpaSpeechEngine({
    recognitionWorkers: 1,
    synthesisWorkers: 2,
    configuration: {
      synthesizers: { a: { id: "a" }, b: { id: "b" } },
      voices: [{ id: "a", label: "A", modelId: "a", speakerId: 0 }, { id: "b", label: "B", modelId: "b", speakerId: 0 }]
    },
    createRecognizer: recognizerFrom(SilentRecognizer),
    createSynthesizer: async config => {
      loads.push(config.id);
      let alive = true;
      return { sampleRate: 22050, numSpeakers: 1, get running() { return alive; }, async close() { alive = false; },
        synthesize(text) { running.push(`${config.id}:${text}`); return new Promise(resolve => finishes.set(text, () => resolve({ sampleRate: 22050 }))); } };
    }
  });
  t.after(() => engine.close());
  const started = async count => {
    for (let tries = 0; tries < 50 && running.length < count; tries += 1) await new Promise(resolve => setImmediate(resolve));
  };
  assert.deepEqual(loads, ["b", "a", "a"], "one worker checks every model, finishing with the default; the other loads the default");
  const one = engine.synthesize("one", { voiceId: "b" });
  const two = engine.synthesize("two", { voiceId: "a" });
  await started(2);
  assert.deepEqual([...running].sort(), ["a:two", "b:one"], "two workers synthesize at once");
  // The worker that now has b finishes first, so the one with a was used last.
  finishes.get("one")();
  await one;
  finishes.get("two")();
  await two;
  const loadsBefore = loads.length;
  const three = engine.synthesize("three", { voiceId: "a" });
  await started(3);
  finishes.get("three")();
  await three;
  assert.equal(running.at(-1), "a:three");
  assert.equal(loads.length, loadsBefore, "the reply goes to the idle worker that has its model, not the one idle longest");
  assert.deepEqual(engine.concurrency, { recognition: 1, synthesis: 2 });
});

test("a host's spellings join the configuration's and JSKIT's, and every recording writes with them", async () => {
  const seen = [];
  let result = "";
  class OnlineRecognizer {
    createStream() { return { acceptWaveform() {}, inputFinished() {} }; }
    isReady() { return false; }
    getResult() { return { text: result }; }
    isEndpoint() { return false; }
    reset() {}
  }
  const options = {
    ...singleWorkers,
    configuration: { recognitionVocabulary: { "Acme  Labs": "Acme Labs", merc: "MERC" } },
    createSynthesizer: async () => ({ sampleRate: 22050, numSpeakers: 1, running: true, async close() {} }),
    createRecognizer: recognizerFrom(OnlineRecognizer, (_config, recordingOptions) => seen.push(recordingOptions))
  };
  const engine = await createSherpaSpeechEngine({ ...options, spellings: { Merc: "Merc", "vibe sixty four": "Vibe64", "j s kit": "J.S. Kit" } });
  assert.deepEqual(seen[0].vocabulary, { "acme labs": "Acme Labs", merc: "Merc", "vibe sixty four": "Vibe64", "j s kit": "J.S. Kit" },
    "a host's spelling replaces the configuration's");
  assert.equal(engine.recognitionModels[0].spellings, 41 + 3, "acme labs, merc and vibe sixty four are added; j s kit replaces JSKIT's");
  result = "MERC AND ACME LABS SHIP VIBE SIXTY FOUR WITH J S KIT";
  const listening = engine.createListeningSession();
  await listening.acceptPcm(Buffer.alloc(320, 1));
  assert.equal(await listening.finish(), "Merc and Acme Labs ship Vibe64 with J.S. Kit");
  await engine.close();
  await assert.rejects(createSherpaSpeechEngine({ ...options, spellings: { "semi;colon": "x" } }), /Spelling "semi;colon"/u);
});
