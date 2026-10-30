import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectVueArchitecture } from "../src/inspectVueArchitecture.js";
import { hashText, project } from "./support.js";

const CACHE_FILE = "jskit-calls.json";
const SOURCE = {
  "package.json": "{\"name\":\"demo\"}\n",
  "src/b.js": "export function helper() { return 1; }\n",
  "src/a.js": "import { helper } from \"./b.js\";\nexport function useA() { return helper(); }\n",
  "src/c.js": "function own() { return 2; }\nexport function useC() { return own(); }\n"
};

async function cacheDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jskit-calls-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function inspect(root, input) {
  return inspectVueArchitecture({ projectRoot: root, input, calls: true });
}

// Marks every cached call record of the given files, so a later run shows
// which files it reused.
async function mark(directory, files) {
  const location = path.join(directory, CACHE_FILE);
  const cache = JSON.parse(await readFile(location, "utf8"));
  for (const file of files) {
    for (const record of cache.files[file].calls) {
      record.callee = `reused ${file}`;
    }
  }
  await writeFile(location, JSON.stringify(cache));
}

function callees(result) {
  return Object.fromEntries(result.calls.map((call) => [call.evidence[0].path, call.callee]));
}

async function change(root, input, file, text) {
  await writeFile(path.join(root, file), text);
  return { ...input, files: input.files.map((entry) => entry.path === file ? { path: file, hash: hashText(text) } : entry) };
}

test("an unchanged rerun reuses every record and matches a cold run", async (t) => {
  const { root, input } = await project(t, SOURCE);
  const directory = await cacheDirectory(t);
  const cold = await inspect(root, input);
  const first = await inspect(root, { ...input, cacheDirectory: directory });
  assert.deepEqual(first, cold);
  assert.deepEqual(await readdir(directory), [CACHE_FILE]);
  assert.deepEqual(await inspect(root, { ...input, cacheDirectory: directory }), cold);
  await mark(directory, ["src/a.js", "src/b.js", "src/c.js"]);
  assert.deepEqual(callees(await inspect(root, { ...input, cacheDirectory: directory })),
    { "src/a.js": "reused src/a.js", "src/c.js": "reused src/c.js" });
});

test("one changed file re-resolves it and its direct importers only", async (t) => {
  const { root, input } = await project(t, SOURCE);
  const directory = await cacheDirectory(t);
  await inspect(root, { ...input, cacheDirectory: directory });
  await mark(directory, ["src/a.js", "src/b.js", "src/c.js"]);
  const changed = await change(root, input, "src/b.js", "export const before = 1;\nexport function helper() { return 1; }\n");
  const warm = await inspect(root, { ...changed, cacheDirectory: directory });
  assert.deepEqual(callees(warm), { "src/a.js": "helper", "src/c.js": "reused src/c.js" });
  const cold = await inspect(root, changed);
  assert.deepEqual(warm.calls.find((call) => call.callee === "helper"), cold.calls.find((call) => call.callee === "helper"));
  assert.deepEqual(warm.calls.find((call) => call.callee === "helper").targets, ["fn:src/b.js#2:8"]);
  assert.deepEqual(warm.functions, cold.functions);
});

test("a cached call whose target disappeared is resolved again", async (t) => {
  const { root, input } = await project(t, {
    ...SOURCE,
    "src/d.js": "import { helper } from \"./e.js\";\nexport function useD() { return helper(); }\n",
    "src/e.js": "export { helper } from \"./b.js\";\n"
  });
  const directory = await cacheDirectory(t);
  await inspect(root, { ...input, cacheDirectory: directory });
  await mark(directory, ["src/d.js"]);
  // d.js imports e.js, which is unchanged; the target moved in b.js.
  const changed = await change(root, input, "src/b.js", "\nexport function helper() { return 1; }\n");
  const warm = await inspect(root, { ...changed, cacheDirectory: directory });
  assert.deepEqual(warm.calls.find((call) => call.evidence[0].path === "src/d.js").targets, ["fn:src/b.js#2:8"]);
  assert.equal(warm.calls.find((call) => call.evidence[0].path === "src/d.js").callee, "helper");
});

test("a changed manifest, Stack hash or option rebuilds every file", async (t) => {
  const { root, input } = await project(t, SOURCE);
  const directory = await cacheDirectory(t);
  for (const variant of [
    async () => ({ input: await change(root, input, "package.json", "{\"name\":\"demo\",\"version\":\"2.0.0\"}\n") }),
    async () => ({ input: { ...input, stackHash: "sha256:other" } }),
    async () => ({ input, options: { httpScope: "shop" } })
  ]) {
    await inspect(root, { ...input, cacheDirectory: directory });
    await mark(directory, ["src/a.js", "src/c.js"]);
    const { input: next, options = {} } = await variant();
    const result = await inspectVueArchitecture({ projectRoot: root, input: { ...next, cacheDirectory: directory }, calls: true, ...options });
    assert.deepEqual(callees(result), { "src/a.js": "helper", "src/c.js": "own" });
    await writeFile(path.join(root, "package.json"), SOURCE["package.json"]);
  }
});

test("an absent, relative, in-project or corrupt cache gives a cold run", async (t) => {
  const { root, input } = await project(t, SOURCE);
  const cold = await inspect(root, input);
  const directory = await cacheDirectory(t);
  const absent = path.join(directory, "missing");
  assert.deepEqual(await inspect(root, { ...input, cacheDirectory: absent }), cold);
  assert.deepEqual(await readdir(directory), []);
  assert.deepEqual(await inspect(root, { ...input, cacheDirectory: "cache" }), cold);
  assert.deepEqual(await inspect(root, { ...input, cacheDirectory: path.join(root, "src") }), cold);
  assert.equal((await readdir(path.join(root, "src"))).includes(CACHE_FILE), false);
  await writeFile(path.join(directory, CACHE_FILE), "{not json");
  assert.deepEqual(await inspect(root, { ...input, cacheDirectory: directory }), cold);
  assert.equal(JSON.parse(await readFile(path.join(directory, CACHE_FILE), "utf8")).schema, "jskit.architecture-calls-cache.v1");
});
