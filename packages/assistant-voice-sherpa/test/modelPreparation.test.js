import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const modelInstaller = path.join(repoRoot,'tooling/prepare-models.sh');
const modelSources = path.join(repoRoot,'models/voice-models.json');
const recognizerBpeVocab = path.join(repoRoot,'models/streaming-zipformer-en-2023-06-26.bpe.vocab');
const recognizerHotwords = path.join(repoRoot,'models/voice-hotwords.txt');
const voiceCli = path.join(repoRoot,'bin/jskit-assistant-voice.js');

test("voice CLI runs when invoked through the active release symlink", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-voice-cli-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const linkedCli = path.join(root, "vibe64-online-voice.js");
  await symlink(voiceCli, linkedCli);

  const result = spawnSync(process.execPath, [linkedCli, "--help"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /JSKIT assistant voice service/u);
});

test("voice model installation reuses an exact verified pack without downloading", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-voice-pack-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, "stt"));
  const modelFile = path.join(root, "stt/tokens.txt");
  const modelBytes = Buffer.from("token\n");
  await writeFile(modelFile, modelBytes);
  await writeFile(path.join(root, "sources.json"), await readFile(modelSources));
  await writeFile(path.join(root, "voice-models.json"), `${JSON.stringify({
    files: [{
      bytes: modelBytes.byteLength,
      path: "stt/tokens.txt",
      sha256: crypto.createHash("sha256").update(modelBytes).digest("hex")
    }],
    schema: "vibe64.voice-models.v1"
  })}\n`);

  await writeFile(path.join(root, "stt/hotwords.txt"), await readFile(recognizerHotwords));
  await writeFile(path.join(root, "stt/bpe.vocab"), await readFile(recognizerBpeVocab));
  const result = spawnSync("bash", [modelInstaller], {
    encoding: "utf8",
    env: {
      ...process.env,
      JSKIT_VOICE_DOWNLOAD_CACHE: path.join(root, "downloads"),
      JSKIT_VOICE_MODELS_ROOT: root,
      JSKIT_VOICE_NODE_BIN: process.execPath
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified 1 voice model file/u);
  assert.match(result.stdout, /Reusing verified voice models/u);
  assert.equal((await stat(root)).mode & 0o777, 0o755);
});

test("voice model CLI builds a repeatable manifest that the verifier checks against the files", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-voice-contract-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const files = [
    ["sources.json", Buffer.from('{"packRevision":2}\n')],
    ["stt/tokens.txt", Buffer.from("token\n")],
    ["tts/espeak-ng-data/voices/test", Buffer.from([0, 1, 128, 255])]
  ];
  for (const [relativePath, bytes] of files) {
    const file = path.join(root, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  const manifestPath = path.join(root, "voice-models.json");
  await writeFile(manifestPath, "stale manifest\n");
  const builder = path.join(repoRoot, "tooling/build-voice-model-contract.mjs");
  const verifier = path.join(repoRoot, "tooling/verify-voice-models.mjs");
  const built = spawnSync(process.execPath, [builder, root], { encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /Recorded 3 voice model files/u);
  const manifest = await readFile(manifestPath, "utf8");
  assert.deepEqual(JSON.parse(manifest), {
    createdBy: "@jskit-ai/assistant-voice-sherpa/prepare",
    files: files.map(([relativePath, bytes]) => ({
      bytes: bytes.length,
      path: relativePath,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    })),
    schema: "vibe64.voice-models.v1"
  });
  const rebuilt = spawnSync(process.execPath, [builder, root], { encoding: "utf8" });
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.equal(await readFile(manifestPath, "utf8"), manifest);

  const verified = spawnSync(process.execPath, [verifier, root], { encoding: "utf8" });
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /Verified 3 voice model files/u);
  await writeFile(path.join(root, "stt/tokens.txt"), "other\n");
  const corrupted = spawnSync(process.execPath, [verifier, root], { encoding: "utf8" });
  assert.notEqual(corrupted.status, 0);
  assert.match(corrupted.stderr, /Voice model file hash does not match its contract: stt\/tokens\.txt/u);
});

test("voice model assets provide a bounded tokenizer-backed technical vocabulary", async () => {
  const [sources, vocabulary, hotwords] = await Promise.all([
    readFile(modelSources, "utf8").then(JSON.parse),
    readFile(recognizerBpeVocab, "utf8"),
    readFile(recognizerHotwords, "utf8")
  ]);
  const phrases = hotwords.trim().split("\n");

  assert.equal(sources.packRevision, 3);
  assert.equal(vocabulary.split("\n").filter(Boolean).length, 500);
  assert.ok(phrases.length > 20 && phrases.length < 64);
  assert.ok(!phrases.includes("VIBE SIXTY FOUR"));
  assert.ok(phrases.includes("JSKIT"));
  assert.ok(phrases.includes("JAY ESS KIT"));
  assert.ok(phrases.includes("POSTGRESQL"));
  assert.ok(phrases.every((phrase) => phrase === phrase.toUpperCase()));
});

test("preparation installs every voice archive and preserves the old pack if an added voice fails verification", async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-piper-pack-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const seed = path.join(root, "seed");
  await mkdir(seed);
  const models = [];
  for (const [id, kind] of [["recognizer", "stt"], ["female", "tts"], ["male", "tts"]]) {
    const source = path.join(root, id);
    await mkdir(source);
    await writeFile(path.join(source, "model"), `${id}\n`);
    const archive = `${id}.tar.bz2`;
    const packed = spawnSync("tar", ["-cjf", path.join(seed, archive), "-C", root, `${id}/model`], { encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    const bytes = await readFile(path.join(seed, archive));
    models.push({ id, kind, archive, archiveSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      url: `https://invalid.example/${archive}`, files: { [`${id}/model`]: `${kind}/${id}.onnx` } });
  }
  const manifest = { models, configuration: { defaultVoice: "female", voices: [{ id: "female" }, { id: "male" }] } };
  const sources = path.join(root, "sources.json");
  await writeFile(sources, JSON.stringify(manifest));
  const installed = path.join(root, "installed");
  const env = { ...process.env, JSKIT_VOICE_MODELS_ROOT: installed, JSKIT_VOICE_SOURCES_FILE: sources,
    JSKIT_VOICE_NODE_BIN: process.execPath, JSKIT_VOICE_ARCHIVE_SEED_ROOT: seed,
    JSKIT_VOICE_DOWNLOAD_CACHE: path.join(root, "downloads"), JSKIT_VOICE_RETAIN_DOWNLOADS: "0" };
  const prepared = spawnSync("bash", [modelInstaller], { env, encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  for (const model of models) {
    assert.equal(await readFile(path.join(installed, model.kind, `${model.id}.onnx`), "utf8"), `${model.id}\n`);
    await assert.rejects(stat(path.join(root, "downloads", model.archive)), { code: "ENOENT" });
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(installed, "speech.json"), "utf8")), manifest.configuration);
  const previous = await readFile(path.join(installed, "voice-models.json"), "utf8");
  models.at(-1).archiveSha256 = "0".repeat(64);
  await writeFile(sources, JSON.stringify(manifest));
  const rejected = spawnSync("bash", [modelInstaller], { env, encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Archive hash mismatch for male/u);
  assert.equal(await readFile(path.join(installed, "voice-models.json"), "utf8"), previous);
});

test("raw ONNX preparation preserves source bytes, adds declared metadata and CPU configuration, and reuses the verified pack", async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-kokoro-q8-pack-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const seed = path.join(root, "seed");
  await mkdir(seed);
  const raw = Buffer.from([8, 9, 18, 0]);
  await writeFile(path.join(seed, "model_q8f16.onnx"), raw);
  const manifest = {
    models: [{ id: "q8f16", kind: "tts", format: "file", archive: "model_q8f16.onnx",
      archiveSha256: crypto.createHash("sha256").update(raw).digest("hex"),
      url: "https://invalid.example/model_q8f16.onnx", files: { "model_q8f16.onnx": "tts/model_q8f16.onnx" } }],
    onnxMetadata: { "tts/model_q8f16.onnx": { sample_rate: "24000" } },
    textFiles: { "tts/cpu.conf": "SessionConfig.optimization.disable_specified_optimizers=NchwcTransformer\n" },
    configuration: { synthesizer: { model: { provider: "cpu:${MODELS_ROOT}/tts/cpu.conf" } } }
  };
  const sources = path.join(root, "sources.json");
  await writeFile(sources, JSON.stringify(manifest));
  const installed = path.join(root, "installed");
  const env = { ...process.env, JSKIT_VOICE_MODELS_ROOT: installed, JSKIT_VOICE_SOURCES_FILE: sources,
    JSKIT_VOICE_NODE_BIN: process.execPath, JSKIT_VOICE_ARCHIVE_SEED_ROOT: seed,
    JSKIT_VOICE_DOWNLOAD_CACHE: path.join(root, "downloads"), JSKIT_VOICE_RETAIN_DOWNLOADS: "1" };
  // The production recognizer owns these directories in normal packs.
  const sourceDir = path.join(root, "recognizer");
  await mkdir(sourceDir);
  await writeFile(path.join(sourceDir, "tokens.txt"), "token\n");
  const archive = path.join(seed, "recognizer.tar.bz2");
  assert.equal(spawnSync("tar", ["-cjf", archive, "-C", root, "recognizer/tokens.txt"]).status, 0);
  manifest.models.unshift({ id: "recognizer", kind: "stt", archive: "recognizer.tar.bz2",
    archiveSha256: crypto.createHash("sha256").update(await readFile(archive)).digest("hex"),
    url: "https://invalid.example/recognizer.tar.bz2", files: { "recognizer/tokens.txt": "stt/tokens.txt" } });
  await writeFile(sources, JSON.stringify(manifest));
  const prepared = spawnSync("bash", [modelInstaller], { env, encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  const bytes = await readFile(path.join(installed, "tts/model_q8f16.onnx"));
  assert.deepEqual(bytes.subarray(0, raw.length), raw, "all original graph and weight bytes are unchanged");
  assert.deepEqual(bytes.subarray(raw.length), Buffer.from([0x72, 20, 10, 11, ...Buffer.from("sample_rate"), 18, 5, ...Buffer.from("24000")]));
  assert.equal(await readFile(path.join(installed, "tts/cpu.conf"), "utf8"), manifest.textFiles["tts/cpu.conf"]);
  const reused = spawnSync("bash", [modelInstaller], { env, encoding: "utf8" });
  assert.equal(reused.status, 0, reused.stderr);
  assert.match(reused.stdout, /Reusing verified voice models/u);
  assert.deepEqual(await readFile(path.join(installed, "tts/model_q8f16.onnx")), bytes, "repetition never appends metadata twice");
  manifest.models.at(-1).archiveSha256 = "0".repeat(64);
  await writeFile(sources, JSON.stringify(manifest));
  const rejected = spawnSync("bash", [modelInstaller], { env, encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Archive hash mismatch/u);
  assert.deepEqual(await readFile(path.join(installed, "tts/model_q8f16.onnx")), bytes, "bad replacement retains the working model");
});

test("Kokoro q8f16 preset pins the exact model and exposes English speaker IDs through the existing voice catalogue", async () => {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "models/voice-models-kokoro-q8f16.json"), "utf8"));
  const model = manifest.models.find(entry => entry.id === "kokoro-v1_0-q8f16");
  assert.equal(model.archive, "model_q8f16.onnx");
  assert.equal(model.format, "file");
  assert.equal(model.archiveSha256, "04c658aec1b6008857c2ad10f8c589d4180d0ec427e7e6118ceb487e215c3cd0");
  assert.match(model.url, /1939ad2a8e416c0acfeecc08a694d14ef25f2231\/onnx\/model_q8f16\.onnx$/u);
  assert.equal(manifest.configuration.synthesizer.model.kokoro.model, "${MODELS_ROOT}/tts/kokoro-q8f16/model_q8f16.onnx");
  assert.equal(manifest.configuration.synthesizer.model.provider, "cpu:${MODELS_ROOT}/tts/kokoro-q8f16/kokoro-cpu.conf");
  assert.match(manifest.textFiles["tts/kokoro-q8f16/kokoro-cpu.conf"], /^SessionConfig\.optimization\.disable_specified_optimizers=NchwcTransformer\n$/u);
  assert.equal(manifest.configuration.voices.length, 28);
  assert.equal(manifest.configuration.voices.find(voice => voice.id === "am_michael").speakerId, 16);
  assert.equal(manifest.configuration.voices.find(voice => voice.id === "bf_emma").speakerId, 21);
  assert.ok(manifest.configuration.voices.every(voice => voice.speakerId < Number(manifest.onnxMetadata["tts/kokoro-q8f16/model_q8f16.onnx"].n_speakers)));
});

test("model staging rejects unsafe metadata/configuration paths and never creates an absent ONNX model", async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-kokoro-stage-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const extracted = path.join(root, "extracted");
  await mkdir(extracted);
  await writeFile(path.join(extracted, "model.onnx"), Buffer.from([8, 9]));
  const base = { models: [{ id: "model", files: { "model.onnx": "tts/model.onnx" } }] };
  for (const [index, patch, error] of [
    [0, { onnxMetadata: { "../escaped.onnx": { key: "value" } } }, /stay inside/u],
    [1, { textFiles: { "../escaped.conf": "text" } }, /stay inside/u],
    [2, { onnxMetadata: { "tts/missing.onnx": { key: "value" } } }, /ENOENT/u],
    [3, { onnxMetadata: { "tts/model.onnx": { key: 3 } } }, /must be strings/u],
    [4, { textFiles: { "tts/model.onnx": "overwrite" } }, /EEXIST/u]
  ]) {
    const manifest = path.join(root, `manifest-${index}.json`);
    const staged = path.join(root, `staged-${index}`);
    await writeFile(manifest, JSON.stringify({ ...base, ...patch }));
    const result = spawnSync(process.execPath, [path.join(repoRoot, "tooling/stage-voice-models.mjs"), manifest, extracted, staged], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
  }
  await assert.rejects(stat(path.join(root, "escaped.onnx")), { code: "ENOENT" });
  await assert.rejects(stat(path.join(root, "escaped.conf")), { code: "ENOENT" });
  await assert.rejects(stat(path.join(root, "staged-2/tts/missing.onnx")), { code: "ENOENT" });
});


test("ONNX metadata rejects copied symlinks and symlinked parents without modifying external files", async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-kokoro-symlink-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const extracted = path.join(root, "extracted");
  const external = path.join(root, "external");
  await mkdir(extracted);
  await mkdir(external);
  const original = Buffer.from([8, 9, 18, 0]);
  await writeFile(path.join(external, "model.onnx"), original);
  await symlink(path.join(external, "model.onnx"), path.join(extracted, "link.onnx"));
  await mkdir(path.join(extracted, "directory"));
  await symlink(external, path.join(extracted, "directory/alias"));
  for (const [id, mapping, target, expected] of [
    ["file", { "link.onnx": "tts/model.onnx" }, "tts/model.onnx", /regular model file/u],
    ["parent", { directory: "tts" }, "tts/alias/model.onnx", /inside its staged pack/u]
  ]) {
    const manifest = path.join(root, `${id}.json`);
    await writeFile(manifest, JSON.stringify({ models: [{ id, files: mapping }], onnxMetadata: { [target]: { sample_rate: "24000" } } }));
    const result = spawnSync(process.execPath, [path.join(repoRoot, "tooling/stage-voice-models.mjs"), manifest, extracted, path.join(root, id)], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.deepEqual(await readFile(path.join(external, "model.onnx")), original);
  }
  for (const [id, relative] of [["config", "tts/alias/cpu.conf"], ["nested-config", "tts/alias/new-directory/cpu.conf"]]) {
    const manifest = path.join(root, `${id}.json`);
    await writeFile(manifest, JSON.stringify({ models: [{ id: "parent", files: { directory: "tts" } }],
      textFiles: { [relative]: "configuration\n" } }));
    const result = spawnSync(process.execPath, [path.join(repoRoot, "tooling/stage-voice-models.mjs"), manifest, extracted, path.join(root, id)], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /inside their staged pack/u);
  }
  await assert.rejects(stat(path.join(external, "cpu.conf")), { code: "ENOENT" });
  await assert.rejects(stat(path.join(external, "new-directory")), { code: "ENOENT" });
});

test("combined preset reuses the original Piper and Kitten catalogue and adds namespaced Kokoro without changing defaults", async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-all-voices-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const piper = JSON.parse(await readFile(path.join(repoRoot, "models/voice-models-piper.json"), "utf8"));
  const kitten = JSON.parse(await readFile(path.join(repoRoot, "models/voice-models-kitten.json"), "utf8"));
  const kokoro = JSON.parse(await readFile(path.join(repoRoot, "models/voice-models-kokoro-q8f16.json"), "utf8"));
  const expected = { ...piper, models: [...piper.models, ...kitten.models.filter(model => model.kind === "tts"), ...kokoro.models.filter(model => model.kind === "tts")],
    configuration: { ...piper.configuration, voices: [...kitten.configuration.voices, ...piper.configuration.voices,
      ...kokoro.configuration.voices.map(voice => ({ ...voice, modelId: "kokoro" }))],
    synthesizers: { ...piper.configuration.synthesizers, ...kitten.configuration.synthesizers, kokoro: kokoro.configuration.synthesizer }, outputSampleRate: 22050 },
    onnxMetadata: kokoro.onnxMetadata, textFiles: kokoro.textFiles };
  const destinations = expected.models.flatMap(model => Object.values(model.files));
  assert.equal(new Set(destinations).size, destinations.length, "model families never overwrite each other's source files");
  assert.equal(expected.configuration.voices.length, 41);
  assert.equal(new Set(expected.configuration.voices.map(voice => voice.id)).size, 41);
  assert.equal(expected.configuration.defaultVoice, "cori");
  assert.equal(expected.configuration.voices.find(voice => voice.id === "kitten_bella").speed, 1.15);
  assert.equal(expected.configuration.voices.find(voice => voice.id === "kitten_jasper").modelId, "kitten");
  await mkdir(path.join(root, "stt"));
  const bytes = Buffer.from("token\n");
  await writeFile(path.join(root, "stt/tokens.txt"), bytes);
  await writeFile(path.join(root, "stt/hotwords.txt"), await readFile(recognizerHotwords));
  await writeFile(path.join(root, "stt/bpe.vocab"), await readFile(recognizerBpeVocab));
  await writeFile(path.join(root, "sources.json"), JSON.stringify(expected, null, 2) + "\n");
  await writeFile(path.join(root, "voice-models.json"), JSON.stringify({ schema: "vibe64.voice-models.v1",
    files: [{ bytes: bytes.length, path: "stt/tokens.txt", sha256: crypto.createHash("sha256").update(bytes).digest("hex") }] }));
  const result = spawnSync(process.execPath, [voiceCli, "prepare", "--models-root", root, "--pack", "piper-kitten-kokoro-q8f16"], {
    encoding: "utf8", env: { ...process.env, JSKIT_VOICE_DOWNLOAD_CACHE: path.join(root, "downloads"), JSKIT_VOICE_SOURCES_FILE: "" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Reusing verified voice models/u);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "sources.json"), "utf8")), expected);
});
