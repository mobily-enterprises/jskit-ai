import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createReporter, ruleMeta } from "../support.js";

// Directories that hold no server source (or another package's), as readable-check skips them.
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "test", "tests", "client", "components", "pages"]);
const SOURCE_FILE = /\.m?js$/u;
const TEST_FILE = /\.test\./u;
// The agent skill bundle's generated copies of package-owned patterns; their
// sources are checked.
const GENERATED_MIRROR = /(^|\/)skills\/jskit\/references\/patterns(\/|$)/u;
const FUNCTION_VALUES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

// Parsed helpers of the files a lint run has read, by path; reread when a file changes.
const helpersByFile = new Map();

function toPosixPath(file) {
  return file.split(path.sep).join("/");
}

// The module's top-level function declarations and `const` arrows or function
// expressions, each with the node a finding is reported on.
function topLevelFunctions(program) {
  return program.body.flatMap((statement) => {
    if (statement.type === "FunctionDeclaration") {
      return [{ node: statement, name: statement.id.name, fn: statement }];
    }
    if (statement.type !== "VariableDeclaration" || statement.kind !== "const") {
      return [];
    }
    return statement.declarations
      .filter((declarator) => declarator.id.type === "Identifier" && FUNCTION_VALUES.has(declarator.init?.type))
      .map((declarator) => ({ node: declarator, name: declarator.id.name, fn: declarator.init }));
  });
}

// A small helper is a top-level function, declared or a `const` arrow, spanning
// fewer than twelve lines. Two are the same when their parameters and bodies
// are, whatever their names; an arrow's expression body reads as its return.
function topLevelHelpers(program, text) {
  return topLevelFunctions(program)
    .filter(({ node }) => node.loc.end.line - node.loc.start.line < 12)
    .map(({ node, name, fn }) => {
      const parameters = fn.params.length ? text.slice(fn.params[0].range[0], fn.params.at(-1).range[1]) : "";
      const body = text.slice(...fn.body.range);
      const block = fn.body.type === "BlockStatement" ? body : `{ return ${body}; }`;
      const shape = `${fn.async ? "async " : ""}${fn.generator ? "* " : ""}${fn.params.length}:${parameters}:${block}`;
      return { node, name, line: node.loc.start.line, key: createHash("sha1").update(shape.replace(/\s+/gu, " ")).digest("hex") };
    });
}

// A package, or a pattern's example application: an `example` directory beside
// a PATTERN.md.
function isPackageDirectory(directory) {
  return existsSync(path.join(directory, "package.json")) ||
    (path.basename(directory) === "example" && existsSync(path.join(path.dirname(directory), "PATTERN.md")));
}

function packageDirectoryOf(file) {
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
      if (!SKIPPED_DIRECTORIES.has(entry.name) && !isPackageDirectory(next) && !GENERATED_MIRROR.test(toPosixPath(next))) {
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
    // readable-check: allow method-probe - platform object: an ESLint parser provides parseForESLint, or only parse
    const program = typeof parser.parseForESLint === "function" ? parser.parseForESLint(text, options).ast : parser.parse(text, options);
    helpers = topLevelHelpers(program, text).map(({ name, line, key }) => ({ name, line, key }));
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
  meta: ruleMeta("Disallow a small top-level helper, function or arrow, that repeats one in another file of the same package.", {
    duplicateHelper: "{{name}}() repeats {{first}}. Keep one copy in the package and import it."
  }),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-duplicate-helper");
    return {
      Program(program) {
        const file = context.filename;
        const own = topLevelHelpers(program, sourceCode.text);
        if (!own.length || !path.isAbsolute(file) || GENERATED_MIRROR.test(toPosixPath(file))) {
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
            report(copy.node, "duplicate-helper", "duplicateHelper", {
              name: copy.name,
              first: `${toPosixPath(path.relative(context.cwd, first.file))}:${first.line}`
            });
          }
        }
      }
    };
  }
});

export { noDuplicateHelper };
