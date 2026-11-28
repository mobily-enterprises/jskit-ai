import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toPosixPath } from "./files.mjs";

// What the app's ESLint config ignores, read as `eslint .` reads it, for the parts of `jskit check` that read the app's
// own files: the data part (data-access-files.mjs) and the test-source part (test-sources.mjs). Each leaves out what the
// config ignores outside server source (lintIgnores), which no lint reads either, such as a vendored copy of old code
// kept beside the app, and lists the paths it left out (formatSkipped).

// The root of the app or of one of its packages, where a folder's name says what the whole tree is: a migrations/ or
// test/ folder deeper in server code is server code (as in @jskit-ai/config-eslint's dataAccess.js).
const ROOT = String.raw`(?:(?:packages|tooling)/[^/]+/)?`;
// Server source, which the app's ESLint config may not ignore, as @jskit-ai/config-eslint's base.js and dataAccess.js
// lint it: at a root (ROOT), its files (a root server.js) and its src/ (an app's whole src/, src/jobs/ and its server
// code with it; a package's src/server and src/shared), server/, scripts/, bin/ and config/. Anything else the config
// ignores, a vendored copy of old code or generated output, is not the app's code.
const SERVER_FILE = new RegExp(`^${ROOT}(?:[^/]+$|(?:src|server|scripts|bin|config)/)`, "u");

// A file directly in a directory, for asking ESLint about the directory: its API judges files, not directories.
const DIRECTORY_PROBE = "jskit-directory-probe.js";
// Every file with an extension, as one ESLint lints, so that ESLint gives no config only for a file its config ignores:
// without it, a file type the config has no config for, such as .ts, .vue or package.json, gets none either.
const EVERY_FILE = Object.freeze({ files: ["**/*.*"] });

// The app's ESLint, from the app or else beside this check, set to find each file's config as `eslint` does, with
// its ESLint class; null when neither has one, or the app has no config: then the lint itself cannot run, which fails
// on its own.
async function appEslint(root) {
  for (const base of [path.join(root, "package.json"), fileURLToPath(import.meta.url)]) {
    let resolved;
    try {
      resolved = createRequire(base).resolve("eslint");
    } catch {
      continue;
    }
    const api = await import(pathToFileURL(resolved).href);
    const { ESLint } = api.ESLint ? api : api.default;
    const eslint = new ESLint({ cwd: root, overrideConfig: EVERY_FILE });
    return await eslint.findConfigFile(path.join(root, "package.json")) ? { eslint, ESLint } : null;
  }
  return null;
}

// For a config file, the config whose ignores keep `eslint .`, run at the app's root, out of its directory; undefined
// when it enters it. ESLint enters a directory unless the config of the directory above ignores it, so a parent config
// ignores a nested config's directory whole, and past it the nested config alone judges what it holds. The directory's
// verdict is that of a file directly in it, asked of an ESLint bound to the config above alone.
function configIgnoredBy(root, { eslint, ESLint }) {
  const verdicts = new Map();
  const bound = new Map();
  const boundTo = (configFile) => {
    if (!bound.has(configFile)) {
      bound.set(configFile, new ESLint({ cwd: path.dirname(configFile), overrideConfigFile: configFile, overrideConfig: EVERY_FILE }));
    }
    return bound.get(configFile);
  };
  async function verdict(configFile) {
    const directory = path.dirname(configFile);
    const inside = path.relative(root, directory);
    if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return undefined;
    // The config of the directory above, which ESLint asks before entering this one.
    const above = await eslint.findConfigFile(directory);
    if (!above) return undefined;
    return await ignoredBy(above) ??
      (await boundTo(above).isPathIgnored(path.join(directory, DIRECTORY_PROBE)) ? above : undefined);
  }
  function ignoredBy(configFile) {
    if (!verdicts.has(configFile)) verdicts.set(configFile, verdict(configFile));
    return verdicts.get(configFile);
  }
  return ignoredBy;
}

// The ESLint config of each app file that one governs, read as `eslint .` reads it: each { file, governed, config },
// `governed` the file's path from that config's directory and `config` undefined when the config ignores the file, or
// when a config above ignores the directory of the file's nested config (configIgnoredBy), as `eslint .` never reaches
// it: `governed` is then told from the directory of the config that ignores it. And the first error reading one, after
// which no more are read. None when the app has no ESLint config (appEslint).
async function lintConfigs(root, files) {
  const configs = [];
  const app = await appEslint(root);
  const ignoredBy = app && configIgnoredBy(root, app);
  for (const file of app ? files : []) {
    const absolute = path.join(root, file);
    try {
      const configFile = await app.eslint.findConfigFile(absolute);
      if (!configFile) continue;
      const outer = await ignoredBy(configFile);
      const governed = toPosixPath(path.relative(path.dirname(outer ?? configFile), absolute));
      configs.push({ file, governed, config: outer ? undefined : await app.eslint.calculateConfigForFile(absolute) });
    } catch (error) {
      return { configs, error: { file, message: String(error?.message || error).split("\n")[0] } };
    }
  }
  return { configs };
}

// Code the app's ESLint config ignores that is not server source: no lint reads it, so neither does `jskit check`.
const lintIgnores = ({ governed, config }) => !config && !SERVER_FILE.test(governed);

// The fewest paths that name the app files skipped: for each, the highest directory holding no file that is read, written
// with a trailing "/", or else the file itself.
function skippedPaths(files, skipped) {
  const directories = (file) => file.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"));
  const read = new Set(files.filter((file) => !skipped.has(file)).flatMap(directories));
  return [...new Set([...skipped].map((file) => {
    const directory = directories(file).find((name) => !read.has(name));
    return directory ? `${directory}/` : file;
  }))].sort();
}

/**
 * Of the app files a part reads (relative to root, POSIX), those its ESLint config ignores outside server source
 * (lintIgnores), with each file's config (lintConfigs) and the fewest paths naming the files skipped (skippedPaths).
 * @param {string} root
 * @param {string[]} files
 */
async function lintSkipped(root, files) {
  const lint = await lintConfigs(root, files);
  const skipped = new Set(lint.configs.filter(lintIgnores).map(({ file }) => file));
  return { lint, skipped, paths: skippedPaths(files, skipped) };
}

// The lines a part's report lists the paths it skipped with (lintSkipped), none when it skipped none.
const formatSkipped = (paths) => (paths.length < 1 ? [] : [
  `Skipped, as the app's ESLint config ignores them and they hold no server code (${paths.length}):`,
  ...paths.map((skipped) => `  ${skipped}`)
]);

export { ROOT, formatSkipped, lintIgnores, lintSkipped };
