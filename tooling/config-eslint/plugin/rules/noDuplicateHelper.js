import { createHash } from "node:crypto";
import path from "node:path";
import vueParser from "vue-eslint-parser";
import {
  clientSourceFiles,
  createSourceMemo,
  isGeneratedMirror,
  isServerOrSharedFile,
  packageRootOf,
  packageSourceFiles,
  toPosixPath
} from "../packageSources.js";
import { createReporter, isClientLint, ruleMeta } from "../support.js";
import { scriptSetupRanges } from "../vueSources.js";

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
// A named no-op (an empty body) or a named constant answer (`return null`,
// `return true`) is not one: its name is all it says.
function isNamedNoOp(fn) {
  const statements = fn.body.type === "BlockStatement" ? fn.body.body : [{ type: "ReturnStatement", argument: fn.body }];
  if (statements.length === 0) return true;
  const [statement] = statements;
  return statements.length === 1 && statement.type === "ReturnStatement" &&
    (!statement.argument || statement.argument.type === "Literal" || (statement.argument.type === "Identifier" && statement.argument.name === "undefined"));
}

const inside = (range, [start, end]) => range[0] >= start && range[1] <= end;

// Whether a function is a component's small closure over its own state: at most two statements, written in the
// component's <script setup>, and every name it reads from outside itself a binding that <script setup> declares, not
// an import or a global. Two pages that reload their own resources the same way share no helper: sharing it would
// take a one-function module that receives each page's state as arguments. A plain module has no <script setup>, so
// none of its functions is one.
function componentClosures(scopeManager, setupRanges) {
  const declaredInSetup = (variable) => variable?.defs.length > 0 &&
    variable.defs.every((definition) => definition.type !== "ImportBinding" && setupRanges.some((range) => inside(definition.name.range, range)));
  return (fn) => {
    const statements = fn.body.type === "BlockStatement" ? fn.body.body.length : 1;
    if (statements > 2 || !scopeManager || !setupRanges.some((range) => inside(fn.range, range))) return false;
    const free = scopeManager.acquire(fn)?.through || [];
    return free.length > 0 && free.every((reference) => declaredInSetup(reference.resolved));
  };
}

function topLevelHelpers(program, text, isComponentClosure) {
  return topLevelFunctions(program)
    .filter(({ node, fn }) => node.loc.end.line - node.loc.start.line < 12 && !isNamedNoOp(fn) && !isComponentClosure(fn))
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

// The small helpers of another file of the package, parsed as this lint run parses; a Vue component's <script> blocks
// are parsed by vue-eslint-parser, with the scopes that tell its closures over <script setup> state.
const helpersOf = createSourceMemo((text, file, context) => {
  const { ecmaVersion, sourceType, parserOptions } = context.languageOptions;
  const component = file.endsWith(".vue");
  const parser = component ? vueParser : context.languageOptions.parser;
  const options = { ...parserOptions, ecmaVersion, sourceType, range: true, loc: true, tokens: true, comment: true, filePath: file,
    ...(component ? { eslintScopeManager: true } : {}) };
  // readable-check: allow method-probe - platform object: an ESLint parser provides parseForESLint, or only parse
  const parsed = typeof parser.parseForESLint === "function" ? parser.parseForESLint(text, options) : { ast: parser.parse(text, options) };
  const closures = component ? componentClosures(parsed.scopeManager, scriptSetupRanges({ parserServices: parsed.services })) : () => false;
  return topLevelHelpers(parsed.ast, text, closures).map(({ name, line, key }) => ({ name, line, key }));
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
// the first, in path order, is reported. In client code the comparison covers
// the whole package, Vue components included, and a client copy of a server or
// shared helper is always the one reported: logic both need lives in src/shared.
const noDuplicateHelper = Object.freeze({
  meta: ruleMeta("Disallow a small top-level helper, function or arrow, that repeats one in another file of the same package.", {
    duplicateHelper: "{{name}}() repeats {{first}}. Keep one copy in the package and import it.",
    clientCopy: "{{name}}() repeats {{first}}. Import that copy; a helper client and server code share lives in the package's src/shared."
  }, "one-helper-per-package"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-duplicate-helper");
    const client = isClientLint(context);
    return {
      Program(program) {
        const file = context.filename;
        const own = topLevelHelpers(program, sourceCode.text, componentClosures(sourceCode.scopeManager, scriptSetupRanges(sourceCode)));
        if (!own.length || !path.isAbsolute(file) || isGeneratedMirror(file)) {
          return;
        }
        const packageDirectory = packageRootOf(file);
        const copiesByKey = new Map(own.map((helper) => [helper.key, []]));
        for (const helper of own) {
          copiesByKey.get(helper.key).push({ ...helper, file });
        }
        const others = client ? clientSourceFiles(packageDirectory) : packageSourceFiles(comparisonRoot(file, packageDirectory));
        for (const other of others) {
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
          const serverCopy = client && !isServerOrSharedFile(file, packageDirectory)
            ? copies.find((copy) => isServerOrSharedFile(copy.file, packageDirectory))
            : null;
          const [first] = copies;
          const reported = serverCopy ? copies.filter((candidate) => candidate.file === file) : copies.slice(1).filter((candidate) => candidate.file === file);
          for (const copy of reported) {
            const original = serverCopy || first;
            report(copy.node, "duplicate-helper", serverCopy ? "clientCopy" : "duplicateHelper", {
              name: copy.name,
              first: `${toPosixPath(path.relative(context.cwd, original.file))}:${original.line}`
            });
          }
        }
      }
    };
  }
});

export { noDuplicateHelper };
