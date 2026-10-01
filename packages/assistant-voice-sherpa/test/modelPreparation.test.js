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
