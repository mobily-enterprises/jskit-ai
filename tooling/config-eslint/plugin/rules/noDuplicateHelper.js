import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createReporter, ruleMeta } from "../support.js";

// Directories that hold no server source (or another package's), as readable-check skips them.
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "test", "tests", "client", "components", "pages", "shared"]);
const SOURCE_FILE = /\.m?js$/u;
const TEST_FILE = /\.test\./u;

// Parsed helpers of the files a lint run has read, by path; reread when a file changes.
const helpersByFile = new Map();

// A small helper is a top-level function declaration spanning fewer than twelve
// lines. Two are the same when their parameters and bodies are, whatever their names.
function topLevelHelpers(program, text) {
  return program.body
    .filter((node) => node.type === "FunctionDeclaration" && node.loc.end.line - node.loc.start.line < 12)
    .map((node) => {
      const start = node.params[0]?.range[0] ?? node.body.range[0];
      const body = `${node.params.length}:${text.slice(start, node.range[1]).replace(/\s+/gu, " ")}`;
      return { name: node.id.name, line: node.loc.start.line, key: createHash("sha1").update(body).digest("hex") };
    });
}

function packageDirectoryOf(file) {
  const start = path.dirname(file);
  for (let directory = start; ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, "package.json"))) {
      return directory;
    }
    if (directory === path.dirname(directory)) {
      return start;
    }
  }
}

// The package's server tree (`src/server`, or a kernel-style `server`) holds the
// file's siblings; a package without one compares its whole directory.
function comparisonRoot(file, packageDirectory) {
  const segments = path.relative(packageDirectory, path.dirname(file)).split(path.sep).filter(Boolean);
  const serverIndex = segments.indexOf("server");
  return serverIndex < 0 ? packageDirectory : path.join(packageDirectory, ...segments.slice(0, serverIndex + 1));
}

function sourceFilesUnder(directory, files = []) {
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
        sourceFilesUnder(next, files);
      }
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(next);
    }
  }
  return files;
}

function parseHelpers(file, context) {
  let stats;
  try {
    stats = statSync(file);
  } catch {
    return [];
  }
  const cached = helpersByFile.get(file);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.helpers;
  }
  let helpers = [];
  try {
    const text = readFileSync(file, "utf8");
    const { parser, ecmaVersion, sourceType, parserOptions } = context.languageOptions;
    const options = { ...parserOptions, ecmaVersion, sourceType, range: true, loc: true, tokens: true, comment: true, filePath: file };
    const program = typeof parser.parseForESLint === "function" ? parser.parseForESLint(text, options).ast : parser.parse(text, options);
    helpers = topLevelHelpers(program, text);
  } catch {
    // A file that does not parse is reported by its own lint run.
  }
  helpersByFile.set(file, { mtimeMs: stats.mtimeMs, size: stats.size, helpers });
  return helpers;
}

// Paths in the order readable-check walks them: directory by directory, by name.
function compareCopies(left, right) {
  const leftSegments = left.file.split(path.sep);
  const rightSegments = right.file.split(path.sep);
  for (let index = 0; index < Math.min(leftSegments.length, rightSegments.length); index += 1) {
    if (leftSegments[index] !== rightSegments[index]) {
      return leftSegments[index] < rightSegments[index] ? -1 : 1;
    }
  }
  return leftSegments.length - rightSegments.length || left.line - right.line;
}

// One copy of each pure helper per package, imported directly. Every copy after
// the first, in path order, is reported.
const noDuplicateHelper = Object.freeze({
  meta: ruleMeta("Disallow a small top-level helper that repeats one in another file of the same package.", {
    duplicateHelper: "{{name}}() repeats {{first}}. Keep one copy in the package and import it."
  }),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-duplicate-helper");
    return {
      Program(program) {
        const file = context.filename;
        const own = topLevelHelpers(program, sourceCode.text);
        if (!own.length || !path.isAbsolute(file)) {
          return;
        }
        const packageDirectory = packageDirectoryOf(file);
        const copiesByKey = new Map(own.map((helper) => [helper.key, []]));
        for (const helper of own) {
          copiesByKey.get(helper.key).push({ ...helper, file });
        }
        for (const other of sourceFilesUnder(comparisonRoot(file, packageDirectory))) {
          if (other === file) {
            continue;
          }
          for (const helper of parseHelpers(other, context)) {
            copiesByKey.get(helper.key)?.push({ ...helper, file: other });
          }
        }
        for (const copies of copiesByKey.values()) {
          if (new Set(copies.map((copy) => copy.file)).size < 2) {
            continue;
          }
          copies.sort(compareCopies);
          const [first] = copies;
          for (const copy of copies.slice(1).filter((candidate) => candidate.file === file)) {
            const node = program.body.find((statement) => statement.type === "FunctionDeclaration" && statement.loc.start.line === copy.line);
            report(node, "duplicate-helper", "duplicateHelper", {
              name: copy.name,
              first: `${path.relative(context.cwd, first.file).split(path.sep).join("/")}:${first.line}`
            });
          }
        }
      }
    };
  }
});

export { noDuplicateHelper };
