import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { toPosixPath } from "./files.mjs";
import { lintSkipped } from "./lint-ignores.mjs";

// The files `jskit check`'s data part (data-access.mjs) reads: the app's own source and Vue components, but what its
// ESLint config ignores outside server source (lint-ignores.mjs), which no lint reads either; and the source of its
// installed @jskit-ai packages. With them, each app source file's ESLint config, which data/lint-config judges, and the
// paths it skipped, which it lists.

const FRAMEWORK_DIRECTORY = path.join("node_modules", "@jskit-ai");
const SOURCE_FILE = /\.[cm]?js$/u;
const VUE_FILE = /\.vue$/u;
const APP_FILE = /\.(?:[cm]?js|vue)$/u;
const SKIPPED_FILE = /\.(?:test|spec|vitest)\.[cm]?js$/u;
// Code that defines no table resource or system scope an app runs: dependencies, anywhere; and, at the root of the app or
// of one of its packages (PACKAGE_DIRECTORY), build output, tests and fixtures, migrations and seeds, and the examples,
// templates and documentation JSKIT packages carry.
const SKIPPED_ROOT_DIRECTORIES = new Set([
  "dist", "build", "coverage", "test", "tests", "__tests__", "e2e", "fixtures", "test-results", "migrations", "seed",
  "seeds", "templates", "patterns", "examples", "docs", "site", "skills", "test-support", "src/test"
]);
const PACKAGE_DIRECTORY = /^(?:packages|tooling)\/[^/]+\/(.+)$/u;
const skipsDirectory = (name) => path.posix.basename(name) === "node_modules" ||
  SKIPPED_ROOT_DIRECTORIES.has(PACKAGE_DIRECTORY.exec(name)?.[1] ?? name);

async function walk(root, directory, files, pattern = SOURCE_FILE) {
  let entries;
  try {
    entries = await readdir(path.join(root, directory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
    throw error;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = directory ? path.join(directory, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !skipsDirectory(toPosixPath(relative))) await walk(root, relative, files, pattern);
    } else if (entry.isFile() && pattern.test(entry.name) && !SKIPPED_FILE.test(entry.name)) {
      files.push(relative);
    }
  }
}

// The installed @jskit-ai packages outside the app's own tree (a workspace's linked packages are read as app source),
// each as { directory, real }: where the app sees it and where it is.
async function frameworkPackages(root) {
  let entries;
  try {
    entries = await readdir(path.join(root, FRAMEWORK_DIRECTORY), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const packages = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const directory = path.join(FRAMEWORK_DIRECTORY, entry.name);
    const real = await realpath(path.join(root, directory)).catch(() => "");
    const inside = path.relative(root, real);
    const appSource = real && !inside.startsWith("..") && !path.isAbsolute(inside) && !inside.split(path.sep).includes("node_modules");
    if (real && !appSource) packages.push({ directory, real });
  }
  return packages;
}

// The app's source files and Vue components but those its ESLint config ignores outside server source (lintSkipped),
// and the source files of its installed @jskit-ai packages (framework: true): `sources`, each { file, absolute,
// framework }, and `vue`, each { file, absolute }, which data/search-q reads for the list screens they show. With each
// app source file's ESLint config (`lint`, lintConfigs) and the paths of the files skipped (`skipped`, skippedPaths).
async function sourceFiles(root) {
  const appFiles = [];
  await walk(root, "", appFiles, APP_FILE);
  const names = appFiles.map(toPosixPath);
  const { lint, skipped, paths } = await lintSkipped(root, names);
  const read = names.filter((file) => !skipped.has(file)).map((file) => ({ file, absolute: path.join(root, file) }));
  const sources = read.filter(({ file }) => SOURCE_FILE.test(file)).map((entry) => ({ ...entry, framework: false }));
  for (const { directory, real } of await frameworkPackages(root)) {
    const files = [];
    await walk(real, "", files);
    sources.push(...files.map((file) => ({ file: path.join(directory, file), absolute: path.join(real, file), framework: true })));
  }
  return {
    sources,
    vue: read.filter(({ file }) => VUE_FILE.test(file)),
    lint: { ...lint, configs: lint.configs.filter(({ file }) => SOURCE_FILE.test(file)) },
    skipped: paths
  };
}

export { sourceFiles };
