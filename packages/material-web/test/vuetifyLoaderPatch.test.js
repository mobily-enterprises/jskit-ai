import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PATCH, TARGETS, main, patchSource, patchVuetify } from "../scripts/patch-vuetify-loaders.mjs";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
// Vuetify 4.3.3's three loader modules as published (sha-256 checked against its npm tarball); the test install holds
// the Vuetify JSKIT pins, whole.
const FIXTURE_4_3_3 = fileURLToPath(new URL("./fixtures/vuetify-4.3.3/", import.meta.url));
// Vuetify's other callers of useElementIntersection, which the patch leaves alone, in lib and in every bundle.
const OTHER_CALLS = Object.freeze({
  "lib/components/VOtpInput/VOtpInput.js": "useElementIntersection(inputRef)",
  "lib/components/VAlert/autoDismiss.js": "useElementIntersection(rootEl)",
  "lib/components/VInfiniteScroll/VInfiniteScroll.js": "useElementIntersection(el)",
  "lib/components/VParallax/VParallax.js": "useElementIntersection(el)"
});
const UNTOUCHED = Object.freeze([...Object.keys(OTHER_CALLS), "dist/vuetify.min.js"]);
const LINE = "@jskit-ai/material-web:";

async function installedVuetify() {
  for (let directory = PACKAGE_ROOT; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", "vuetify");
    if (await stat(path.join(candidate, "package.json")).then(() => true, () => false)) return candidate;
    assert.notEqual(path.dirname(directory), directory, "the test install has no vuetify");
  }
}

// The installed Vuetify's files as Vuetify publishes them: the install may have patched them already.
async function publishedVuetify() {
  const vuetify = await installedVuetify();
  const files = {};
  for (const file of ["package.json", ...Object.keys(TARGETS), ...UNTOUCHED]) {
    files[file] = (await readFile(path.join(vuetify, file), "utf8")).replaceAll(PATCH, "");
  }
  return files;
}

async function writeVuetify(directory, files) {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), text);
  }
}

async function readVuetify(directory, files) {
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(path.join(directory, file), "utf8")])));
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jskit-vuetify-loaders-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function runPatch(project) {
  const lines = [];
  await main({ env: { INIT_CWD: project }, cwd: project, log: (line) => lines.push(line) });
  return lines;
}

const count = (text, part) => text.split(part).length - 1;

test("the patch passes { immediate: false } to the three loaders' calls in lib and every bundle, and to no other call", async (t) => {
  const published = await publishedVuetify();
  const vuetify = path.join(await temporaryDirectory(t), "node_modules", "vuetify");
  await writeVuetify(vuetify, published);

  const result = await patchVuetify(vuetify);
  assert.deepEqual(result.patched, Object.keys(TARGETS));
  const now = await readVuetify(vuetify, Object.keys(published));
  for (const [file, loaders] of Object.entries(TARGETS)) {
    assert.equal(count(now[file], `useElementIntersection(root${PATCH})`), loaders.length, file);
    assert.equal(count(now[file], PATCH), loaders.length, file);
    assert.equal(now[file].replaceAll(PATCH, ""), published[file], `${file}: only the loaders' calls change`);
    assert.deepEqual(patchSource(now[file], loaders), { source: now[file], patched: 0 }, `${file}: every loader is patched`);
    if (file.startsWith("dist/")) {
      for (const call of new Set(Object.values(OTHER_CALLS))) {
        assert.equal(count(now[file], call), count(published[file], call), `${file} keeps ${call}`);
      }
    }
  }
  for (const file of UNTOUCHED) assert.equal(now[file], published[file], `${file} is left alone`);
});

test("Vuetify 4.3.3's loader modules, as published, take the same patch", async () => {
  for (const [file, loaders] of Object.entries(TARGETS).filter(([file]) => file.startsWith("lib/"))) {
    const published = await readFile(path.join(FIXTURE_4_3_3, file), "utf8");
    const result = patchSource(published, loaders);
    assert.equal(result.patched, 1, file);
    assert.equal(count(result.source, `useElementIntersection(root${PATCH})`), 1, file);
    assert.equal(result.source.replaceAll(PATCH, ""), published, file);
  }
});

test("a second run changes nothing, and a reinstalled Vuetify is patched again", async (t) => {
  const published = await publishedVuetify();
  const project = await temporaryDirectory(t);
  const vuetify = path.join(project, "node_modules", "vuetify");
  await writeVuetify(vuetify, published);
  const version = JSON.parse(published["package.json"]).version;

  assert.deepEqual(await runPatch(project), [
    `${LINE} patched the idle loaders of Vuetify ${version} (node_modules/vuetify) in 9 files for vuetifyjs/vuetify#23393.`
  ]);
  const patched = await readVuetify(vuetify, Object.keys(TARGETS));
  const times = await Promise.all(Object.keys(TARGETS).map(async (file) => (await stat(path.join(vuetify, file))).mtimeMs));
  assert.deepEqual(await runPatch(project), [
    `${LINE} the idle loaders of Vuetify ${version} (node_modules/vuetify) are already patched for vuetifyjs/vuetify#23393.`
  ]);
  assert.deepEqual(await readVuetify(vuetify, Object.keys(TARGETS)), patched);
  assert.deepEqual(await Promise.all(Object.keys(TARGETS).map(async (file) => (await stat(path.join(vuetify, file))).mtimeMs)), times);

  await writeVuetify(vuetify, published);
  assert.match((await runPatch(project)).join("\n"), /^@jskit-ai\/material-web: patched the idle loaders of Vuetify .* in 9 files/u);
  assert.deepEqual(await readVuetify(vuetify, Object.keys(TARGETS)), patched);
});

test("a Vuetify whose loaders are fixed or rewritten is left exactly as it is, with one line naming #23393", async (t) => {
  const published = await publishedVuetify();
  const lib = "lib/components/VProgressLinear/VProgressLinear.js";
  const labs = "dist/vuetify-labs.esm.js";
  const variants = {
    "fixed upstream": [lib, (text) => text.replace("useElementIntersection(root)", "useElementIntersection(root, { immediate: false })"),
      `${lib}: VProgressLinear calls useElementIntersection with other arguments`],
    "a loader calling it twice": [labs, (text) => text.replace(/useElementIntersection\(root\);(?=\n\s*const elapsed)/u, "$&\n    useElementIntersection(root);"),
      `${labs}: VLoadingIndicator does not call useElementIntersection exactly once`],
    "a loader gone": [labs, (text) => text.replace("name: 'VLoadingIndicator',", "name: 'VLoadingDots',"),
      `${labs}: 0 definitions of VLoadingIndicator`],
    "a bundle gone": ["dist/vuetify.cjs", () => null, "dist/vuetify.cjs: missing"]
  };
  for (const [variant, [file, change, reason]] of Object.entries(variants)) {
    const project = await temporaryDirectory(t);
    const vuetify = path.join(project, "node_modules", "vuetify");
    const files = { ...published, [file]: change(published[file]) };
    assert.notEqual(files[file], published[file], variant);
    if (files[file] === null) delete files[file];
    await writeVuetify(vuetify, files);

    const version = JSON.parse(published["package.json"]).version;
    assert.deepEqual(await runPatch(project), [
      `${LINE} Vuetify ${version} (node_modules/vuetify) does not have the idle-loader code patched for vuetifyjs/vuetify#23393 ` +
      `(${reason}); left it unchanged.`
    ], variant);
    assert.deepEqual(await readVuetify(vuetify, Object.keys(files)), files, `${variant}: no file changed`);
  }
});

test("Vuetify's copies nested under other packages are patched with the one INIT_CWD resolves to, and no other", async (t) => {
  const published = await publishedVuetify();
  const root = await temporaryDirectory(t);
  const project = path.join(root, "app");
  const copies = ["node_modules/vuetify", "node_modules/@scope/widgets/node_modules/vuetify", "node_modules/table/node_modules/vuetify"];
  for (const copy of copies) await writeVuetify(path.join(project, copy), published);
  await writeVuetify(path.join(root, "elsewhere", "node_modules", "vuetify"), published);
  await mkdir(path.join(project, "packages", "main"), { recursive: true });

  const lines = await runPatch(path.join(project, "packages", "main"));
  assert.equal(lines.length, 3, lines.join("\n"));
  for (const copy of copies) {
    assert.ok(lines.some((line) => line.includes(`(${path.join("..", "..", copy)}) in 9 files`)), `${copy}: ${lines.join("\n")}`);
    assert.equal(count(await readFile(path.join(project, copy, "dist/vuetify-labs.esm.js"), "utf8"), PATCH), 3, copy);
  }
  assert.equal(count(await readFile(path.join(root, "elsewhere/node_modules/vuetify/dist/vuetify.esm.js"), "utf8"), PATCH), 0);
});

test("the postinstall never fails an install: no Vuetify, an unreadable file or a broken package.json is one line or none, exit 0", async (t) => {
  const { postinstall } = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8")).scripts;
  assert.equal(postinstall, "node ./scripts/patch-vuetify-loaders.mjs");
  const install = async (project) => {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["./scripts/patch-vuetify-loaders.mjs"], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, INIT_CWD: project, npm_config_local_prefix: project }
    });
    return { lines: stdout.split("\n").filter(Boolean), stderr };
  };

  const empty = await temporaryDirectory(t);
  assert.deepEqual(await install(empty), { lines: [], stderr: "" });
  assert.deepEqual(await readdir(empty), []);

  const published = await publishedVuetify();
  const unreadable = await temporaryDirectory(t);
  const { "dist/vuetify.cjs": cjs, ...rest } = published;
  assert.ok(cjs);
  await writeVuetify(path.join(unreadable, "node_modules", "vuetify"), { ...rest, "dist/vuetify.cjs/index.js": "" });
  const broken = await temporaryDirectory(t);
  await writeVuetify(path.join(broken, "node_modules", "vuetify"), { ...published, "package.json": "{" });
  for (const project of [unreadable, broken]) {
    const { lines, stderr } = await install(project);
    assert.equal(stderr, "");
    assert.equal(lines.length, 1, lines.join("\n"));
    assert.match(lines[0], /^@jskit-ai\/material-web: could not patch Vuetify's idle loaders for vuetifyjs\/vuetify#23393: /u);
  }
  assert.equal(count(await readFile(path.join(unreadable, "node_modules/vuetify/dist/vuetify.esm.js"), "utf8"), PATCH), 0);
});
