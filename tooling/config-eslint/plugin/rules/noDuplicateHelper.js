import { createHash } from "node:crypto";
import path from "node:path";
import { createSourceMemo, isGeneratedMirror, packageRootOf, packageSourceFiles, toPosixPath } from "../packageSources.js";
import { createReporter, ruleMeta } from "../support.js";

const FUNCTION_VALUES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

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
// A named no-op (an empty body) is not one: its name is all it says.
function topLevelHelpers(program, text) {
  return topLevelFunctions(program)
    .filter(({ node, fn }) => node.loc.end.line - node.loc.start.line < 12 && !(fn.body.type === "BlockStatement" && fn.body.body.length === 0))
    .map(({ node, name, fn }) => {
      const parameters = fn.params.length ? text.slice(fn.params[0].range[0], fn.params.at(-1).range[1]) : "";
      const body = text.slice(...fn.body.range);
      const block = fn.body.type === "BlockStatement" ? body : `{ return ${body}; }`;
      const shape = `${fn.async ? "async " : ""}${fn.generator ? "* " : ""}${fn.params.length}:${parameters}:${block}`;
      return { node, name, line: node.loc.start.line, key: createHash("sha1").update(shape.replace(/\s+/gu, " ")).digest("hex") };
    });
}

// The package's server tree (`src/server`, or a kernel-style `server`) holds the
// file's siblings; a package without one compares its whole directory.
function comparisonRoot(file, packageDirectory) {
  const segments = path.relative(packageDirectory, path.dirname(file)).split(path.sep).filter(Boolean);
  const serverIndex = segments.indexOf("server");
  return serverIndex < 0 ? packageDirectory : path.join(packageDirectory, ...segments.slice(0, serverIndex + 1));
}

// The small helpers of another file of the package, parsed as this lint run parses.
const helpersOf = createSourceMemo((text, file, context) => {
  const { parser, ecmaVersion, sourceType, parserOptions } = context.languageOptions;
  const options = { ...parserOptions, ecmaVersion, sourceType, range: true, loc: true, tokens: true, comment: true, filePath: file };
  // readable-check: allow method-probe - platform object: an ESLint parser provides parseForESLint, or only parse
  const program = typeof parser.parseForESLint === "function" ? parser.parseForESLint(text, options).ast : parser.parse(text, options);
  return topLevelHelpers(program, text).map(({ name, line, key }) => ({ name, line, key }));
}, Object.freeze([]));

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
  }, "one-helper-per-package"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-duplicate-helper");
    return {
      Program(program) {
        const file = context.filename;
        const own = topLevelHelpers(program, sourceCode.text);
        if (!own.length || !path.isAbsolute(file) || isGeneratedMirror(file)) {
          return;
        }
        const packageDirectory = packageRootOf(file);
        const copiesByKey = new Map(own.map((helper) => [helper.key, []]));
        for (const helper of own) {
          copiesByKey.get(helper.key).push({ ...helper, file });
        }
        for (const other of packageSourceFiles(comparisonRoot(file, packageDirectory))) {
          if (other === file) {
            continue;
          }
          for (const helper of helpersOf(other, context)) {
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
