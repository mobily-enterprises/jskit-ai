import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// The source files of one package, for the rules that compare a file with its
// package: the nearest directory with a package.json, or a pattern's example
// directory (an `example` directory beside a PATTERN.md), which is an
// application of its own.

// Directories that hold no package source: dependencies, builds, tests, client
// code, scaffolding templates, and pattern examples with their generated copies.
const SKIPPED_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "coverage", "test", "tests", "client", "components", "pages", "templates", "patterns"
]);
const SOURCE_FILE = /\.m?js$/u;
const TEST_FILE = /\.test\./u;
// The agent skill bundle's generated copies of package-owned patterns; their
// sources are checked.
const GENERATED_MIRROR = /(^|\/)skills\/jskit\/references\/patterns(\/|$)/u;

function toPosixPath(file) {
  return file.split(path.sep).join("/");
}

function isGeneratedMirror(file) {
  return GENERATED_MIRROR.test(toPosixPath(file));
}

function isPackageDirectory(directory) {
  return existsSync(path.join(directory, "package.json")) ||
    (path.basename(directory) === "example" && existsSync(path.join(path.dirname(directory), "PATTERN.md")));
}

function packageRootOf(file) {
  const start = path.dirname(file);
  for (let directory = start; ; directory = path.dirname(directory)) {
    if (isPackageDirectory(directory)) {
      return directory;
    }
    if (directory === path.dirname(directory)) {
      return start;
    }
  }
}

// The source files under a directory of a package, without entering another
// package.
function packageSourceFiles(directory, files = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name) && !isPackageDirectory(next)) {
        packageSourceFiles(next, files);
      }
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(next);
    }
  }
  return files;
}

/**
 * What a rule reads from each other file of a lint run, by path, read again
 * when the file changes. A file that does not read or parse gives `unreadable`;
 * its own lint run reports it.
 * @template T
 * @param {(text: string, file: string, context: import("eslint").Rule.RuleContext) => T} read
 * @param {T} unreadable
 * @returns {(file: string, context: import("eslint").Rule.RuleContext) => T}
 */
function createSourceMemo(read, unreadable) {
  const byFile = new Map();
  return function readSource(file, context) {
    let stats;
    try {
      stats = statSync(file);
    } catch {
      return unreadable;
    }
    const cached = byFile.get(file);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.value;
    }
    let value;
    try {
      value = read(readFileSync(file, "utf8"), file, context);
    } catch {
      value = unreadable;
    }
    byFile.set(file, { mtimeMs: stats.mtimeMs, size: stats.size, value });
    return value;
  };
}

export { createSourceMemo, isGeneratedMirror, packageRootOf, packageSourceFiles, toPosixPath };
