#!/usr/bin/env node
// material-web's postinstall: stops Vuetify's idle loaders reading layout as they mount.
// https://github.com/vuetifyjs/vuetify/issues/23393 (open). Remove once a fixed Vuetify is pinned.
//
// Since Vuetify 4.3.0 every field (VTextField, VTextarea, VSelect, VAutocomplete, VCombobox, VNumberInput, VFileInput)
// renders an idle VProgressLinear, which, like VProgressCircular and the labs VLoadingIndicator, calls @vuetify/v0's
// useElementIntersection(root). Its default `immediate: true` calls root.getBoundingClientRect() on mount for a first
// entry that hard-codes isIntersecting: false, so the read tells it nothing; the IntersectionObserver sends its own
// first entry anyway. When anything writes to the page between two fields mounting, each read forces a layout: 300
// fields took about 15 s to mount instead of 0.4 s. This script passes `{ immediate: false }` to those three calls and
// to no other, in the copies of Vuetify the project installed:
// - lib/, which `vuetify`, `vuetify/components`, `vuetify/labs/*` and the auto-imports resolve to;
// - the dist/ bundles that `vuetify/dist/vuetify.js` and `vuetify/dist/vuetify-labs.js` resolve to (.esm.js on import,
//   .cjs on require), and the UMD builds at those paths, which a tool that ignores `exports` loads for them.
// dist/vuetify.min.js stays as published: no export names it (only the `./*` catch-all, which reaches every file), it is
// the CDN script build, and its minified names would need a second, looser matcher.
// It changes a file only where it finds exactly the calls it expects, and nothing at all in a Vuetify where any is
// missing or different (fixed upstream, or rewritten). It never fails an install: every outcome is one line, exit 0.
import { realpathSync } from "node:fs";
import { chmod, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ISSUE = "vuetifyjs/vuetify#23393";
// What the patch adds inside each call. The comment marks a call as patched here, so a second run changes nothing and
// a Vuetify that passes the option itself reads as changed, not as patched.
const PATCH = ", { immediate: false } /* @jskit-ai/material-web: vuetifyjs/vuetify#23393 */";
const LOADERS = Object.freeze(["VProgressLinear", "VProgressCircular", "VLoadingIndicator"]);
const CORE_LOADERS = LOADERS.slice(0, 2);
// Each file the patch changes, relative to the Vuetify package, with the loaders it defines.
const TARGETS = Object.freeze({
  "lib/components/VProgressLinear/VProgressLinear.js": ["VProgressLinear"],
  "lib/components/VProgressCircular/VProgressCircular.js": ["VProgressCircular"],
  "lib/labs/VLoadingIndicator/VLoadingIndicator.js": ["VLoadingIndicator"],
  "dist/vuetify.esm.js": CORE_LOADERS,
  "dist/vuetify.cjs": CORE_LOADERS,
  "dist/vuetify.js": CORE_LOADERS,
  "dist/vuetify-labs.esm.js": LOADERS,
  "dist/vuetify-labs.cjs": LOADERS,
  "dist/vuetify-labs.js": LOADERS
});
const CALL = "useElementIntersection(";
const CALL_HEAD = /^useElementIntersection\([A-Za-z_$][\w$]*/u;

/**
 * Where component `name` calls useElementIntersection in `source`: its definition runs from its one `name: '<name>'`
 * line to the next line at its `const <name> = ...` indentation that is not a closing bracket (the next statement).
 * It must hold exactly one call, on one variable, as published (`patched: false`) or as patched here (`patched: true`).
 * @param {string} source
 * @param {string} name
 * @returns {{ end?: number, patched: boolean } | string} the published call's closing parenthesis, or what differs
 */
function findLoaderCall(source, name) {
  const definitions = [...source.matchAll(new RegExp(`^([ \\t]*)name: ['"]${name}['"],$`, "gmu"))];
  if (definitions.length !== 1) return `${definitions.length} definitions of ${name}`;
  const [{ index: start, 1: indent }] = definitions;
  const nextStatement = new RegExp(`^${indent.replace(/ {2}$/u, "")}[^\\s})\\]]`, "gmu");
  nextStatement.lastIndex = start + indent.length;
  const definition = source.slice(start, nextStatement.exec(source)?.index ?? source.length);
  const at = definition.indexOf(CALL);
  if (at < 0 || definition.indexOf(CALL, at + 1) >= 0) return `${name} does not call useElementIntersection exactly once`;
  const call = definition.slice(at);
  const head = CALL_HEAD.exec(call)?.[0] ?? "";
  if (head && call.startsWith(")", head.length)) return { end: start + at + head.length, patched: false };
  if (head && call.startsWith(`${PATCH})`, head.length)) return { patched: true };
  return `${name} calls useElementIntersection with other arguments`;
}

/**
 * The patched text of one Vuetify file that defines `loaders`.
 * @param {string} source
 * @param {ReadonlyArray<string>} loaders
 * @returns {{ source: string, patched: number } | { changed: string }} `patched` counts the calls patched now
 */
function patchSource(source, loaders) {
  const calls = [];
  for (const name of loaders) {
    const call = findLoaderCall(source, name);
    if (typeof call === "string") return { changed: call };
    calls.push(call);
  }
  const pending = calls.filter((call) => !call.patched).sort((left, right) => right.end - left.end);
  let text = source;
  for (const { end } of pending) text = `${text.slice(0, end)}${PATCH}${text.slice(end)}`;
  return { source: text, patched: pending.length };
}

// Writes beside the file and renames it into place: an interrupted install leaves the old file, and a file
// hard-linked from a package store is replaced in this project only.
async function replaceFile(file, text) {
  const { mode } = await stat(file);
  const temporary = `${file}.jskit-${process.pid}.tmp`;
  try {
    await writeFile(temporary, text, "utf8");
    await chmod(temporary, mode);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Patches the Vuetify package in `directory`, or changes nothing in it when any target file differs from what the
 * patch expects.
 * @param {string} directory
 * @returns {Promise<{ version: string, patched: string[] } | { version: string, changed: string }>}
 */
async function patchVuetify(directory) {
  const { version } = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  const files = [];
  for (const [file, loaders] of Object.entries(TARGETS)) {
    const source = await readFile(path.join(directory, file), "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const result = source === null ? { changed: "missing" } : patchSource(source, loaders);
    if (result.changed) return { version, changed: `${file}: ${result.changed}` };
    if (result.patched > 0) files.push({ file, source: result.source });
  }
  for (const { file, source } of files) await replaceFile(path.join(directory, file), source);
  return { version, patched: files.map(({ file }) => file) };
}

async function isFile(file) {
  return stat(file).then((stats) => stats.isFile(), () => false);
}

async function nearestVuetify(start) {
  for (let directory = path.resolve(start); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", "vuetify");
    if (await isFile(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(directory) === directory) return null;
  }
}

// The copies nested in the packages under `nodeModules` (<package>/node_modules/vuetify, at any depth), which those
// packages import instead of the app's. Linked packages (workspaces) are not followed.
async function nestedVuetify(nodeModules) {
  const copies = [];
  const entries = (directory) => readdir(directory, { withFileTypes: true }).then(
    (found) => found.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")),
    () => []
  );
  for (const entry of await entries(nodeModules)) {
    const packages = entry.name.startsWith("@")
      ? (await entries(path.join(nodeModules, entry.name))).map((scoped) => path.join(entry.name, scoped.name))
      : [entry.name];
    for (const name of packages) {
      const inner = path.join(nodeModules, name, "node_modules");
      if (await isFile(path.join(inner, "vuetify", "package.json"))) copies.push(path.join(inner, "vuetify"));
      copies.push(...await nestedVuetify(inner));
    }
  }
  return copies;
}

/**
 * The Vuetify copies the project uses: the one each start directory resolves `vuetify` to, and the copies nested under
 * that one's node_modules, each once.
 * @param {ReadonlyArray<string>} starts
 * @returns {Promise<string[]>}
 */
async function findVuetifyCopies(starts) {
  const copies = new Map();
  for (const start of starts) {
    const found = await nearestVuetify(start);
    if (!found) continue;
    for (const copy of [found, ...await nestedVuetify(path.dirname(found))]) {
      const real = await realpath(copy);
      if (!copies.has(real)) copies.set(real, copy);
    }
  }
  return [...copies.values()];
}

/**
 * Patches the Vuetify of the project being installed (INIT_CWD, and npm's project root) and reports one line per copy.
 * Never throws: an error is reported in one line too.
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, log?: (line: string) => void }} [options]
 */
async function main({ env = process.env, cwd = process.cwd(), log = console.log } = {}) {
  const prefix = "@jskit-ai/material-web:";
  const failed = (error) => {
    log(`${prefix} could not patch Vuetify's idle loaders for ${ISSUE}: ${String(error?.message || error).split("\n")[0]}`);
  };
  try {
    const project = env.INIT_CWD || cwd;
    for (const directory of await findVuetifyCopies([project, env.npm_config_local_prefix].filter(Boolean))) {
      const where = path.relative(project, directory) || directory;
      const result = await patchVuetify(directory).catch((error) => ({ error }));
      const vuetify = `Vuetify ${result.version} (${where})`;
      if (result.error) failed(result.error);
      else if (result.changed) log(`${prefix} ${vuetify} does not have the idle-loader code patched for ${ISSUE} (${result.changed}); left it unchanged.`);
      else if (result.patched.length > 0) log(`${prefix} patched the idle loaders of ${vuetify} in ${result.patched.length} files for ${ISSUE}.`);
      else log(`${prefix} the idle loaders of ${vuetify} are already patched for ${ISSUE}.`);
    }
  } catch (error) {
    failed(error);
  }
}

function isEntrypoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  await main();
  process.exitCode = 0;
}

export { ISSUE, LOADERS, PATCH, TARGETS, findVuetifyCopies, main, patchSource, patchVuetify };
