import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// The source files of one package, for the rules that compare a file with its
// package: the nearest directory with a package.json, or a pattern's example
// directory, which is an application of its own.

// Directories that hold no package source: dependencies, builds, tests, client
// code, scaffolding templates, and pattern examples with their generated copies.
const SKIPPED_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "coverage", "test", "tests", "client", "components", "pages", "templates", "patterns"
]);
const SOURCE_FILE = /\.m?js$/u;
const TEST_FILE = /\.test\./u;

function isPatternExample(directory) {
  return path.basename(directory) === "example" && directory.split(path.sep).includes("patterns");
}

function packageRootOf(file) {
  const start = path.dirname(file);
  for (let directory = start; ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, "package.json")) || isPatternExample(directory)) {
      return directory;
    }
    if (directory === path.dirname(directory)) {
      return start;
    }
  }
}

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
      if (!SKIPPED_DIRECTORIES.has(entry.name) && !existsSync(path.join(next, "package.json"))) {
        packageSourceFiles(next, files);
      }
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(next);
    }
  }
  return files;
}

export { packageRootOf, packageSourceFiles };
