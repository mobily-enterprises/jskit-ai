import path from "node:path";
import { createSourceMemo, isGeneratedMirror, packageRootOf, packageSourceFiles, toPosixPath } from "../packageSources.js";
import { createReporter, ruleMeta } from "../support.js";

// The JSDoc tags whose braces hold a type.
const TYPE_TAG = /@(?:param|arg|argument|type|typedef|returns?|property|prop|satisfies|this|yields|throws|callback|template)\s*\{/gu;
const JSDOC_BLOCK = /\/\*\*[\s\S]*?\*\//gu;
const INDEX_CHAIN = /^(?:\s*\[\s*(?:"[^"]*"|'[^']*'|\d+)\s*\])+/u;
// A named type, optionally imported, indexed by string keys: `X["y"]`,
// `import("…").X["y"]["z"]`.
const INDEXED_TYPE = /(?<![\w$.])(?:import\(\s*(?:"[^"]+"|'[^']+')\s*\)\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\s*\[\s*(?:"[^"]*"|'[^']*')\s*\])+/gu;
const TYPES_MODULE = /^types\.m?js$/u;

// The text between a `{` at `start` and its matching `}`.
function balanced(text, start, open, close) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\"" || character === "'") {
      const end = text.indexOf(character, index + 1);
      index = end < 0 ? text.length : end;
    } else if (character === open) {
      depth += 1;
    } else if (character === close && (depth -= 1) === 0) {
      return index;
    }
  }
  return -1;
}

// The spelled-out types a reader would want named: `ReturnType<…>` with any
// index chain, and named types indexed by string keys.
function repeatableTypes(type) {
  const found = [];
  let masked = type;
  for (let index = type.indexOf("ReturnType<"); index >= 0; index = type.indexOf("ReturnType<", index + 1)) {
    const close = balanced(type, index + "ReturnType".length, "<", ">");
    if (close < 0) {
      break;
    }
    const chain = INDEX_CHAIN.exec(type.slice(close + 1))?.[0] || "";
    const end = close + 1 + chain.length;
    found.push({ offset: index, text: type.slice(index, end) });
    masked = masked.slice(0, index) + " ".repeat(end - index) + masked.slice(end);
    index = end - 1;
  }
  for (const match of masked.matchAll(INDEXED_TYPE)) {
    found.push({ offset: match.index, text: match[0] });
  }
  return found;
}

const IMPORT_DECLARATION = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})?\s*from\s*["']([^"']+)["']/gu;
const TYPEOF_NAME = /(?<![\w$.])typeof\s+([A-Za-z_$][\w$]*)(?![\w$]|\s*\()/gu;

function moduleKey(specifier, directory) {
  return specifier.startsWith(".") ? path.resolve(directory, specifier).replace(/\.m?js$/u, "") : specifier;
}

// What each imported name of a module's text refers to, as the
// `import("<module>").<export>` a type would spell.
function importedNames(text, directory) {
  const names = new Map();
  for (const [, defaultName, namespaceName, named, specifier] of text.matchAll(IMPORT_DECLARATION)) {
    const module = `import("${moduleKey(specifier, directory)}")`;
    if (defaultName) {
      names.set(defaultName, `${module}.default`);
    }
    if (namespaceName) {
      names.set(namespaceName, module);
    }
    for (const part of (named || "").split(",")) {
      const [exported, local = exported] = part.trim().split(/\s+as\s+/u);
      if (exported) {
        names.set(local, `${module}.${exported}`);
      }
    }
  }
  return names;
}

// A type's text with whitespace removed, one quote style, relative module
// paths made absolute, and `typeof <name>` read as what the name refers to (an
// import, or this file's own binding), so the same type written in two files
// matches and two files' local `createService` do not.
function typeKey(text, file, imports) {
  const directory = path.dirname(file);
  return text.replace(/\s+/gu, " ").replace(/'/gu, "\"")
    .replace(TYPEOF_NAME, (whole, name) => `typeof ${imports.get(name) || `${file}#${name}`}`)
    .replace(/import\("(\.{1,2}\/[^"]+)"\)/gu, (whole, specifier) => `import("${moduleKey(specifier, directory)}")`)
    .replace(/\s+/gu, "");
}

// Each type in a JSDoc comment's text, with its offset in that text.
function commentTypes(text) {
  const found = [];
  for (const tag of text.matchAll(TYPE_TAG)) {
    const open = tag.index + tag[0].length - 1;
    const close = balanced(text, open, "{", "}");
    if (close < 0) {
      continue;
    }
    for (const type of repeatableTypes(text.slice(open + 1, close))) {
      found.push({ offset: open + 1 + type.offset, text: type.text });
    }
  }
  return found;
}

// The type expressions of another file of the package, as keys.
const typeKeysOf = createSourceMemo((text, file) => {
  const imports = importedNames(text, path.dirname(file));
  const keys = new Set();
  for (const block of text.matchAll(JSDOC_BLOCK)) {
    for (const type of commentTypes(block[0])) {
      keys.add(typeKey(type.text, file, imports));
    }
  }
  return keys;
}, new Set());

// A type used in two or more files of a package is named once, in its types.js,
// and imported by that name: every copy must otherwise change together.
const namedRepeatedType = Object.freeze({
  meta: ruleMeta("Disallow spelling out the same ReturnType<…> or indexed JSDoc type in several files of a package.", {
    repeatedType: "{{type}} is also written in {{other}}. Name it once in the package's types.js and import that name."
  }, "capability-types"),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "named-repeated-type");
    return {
      Program() {
        const file = context.filename;
        if (!path.isAbsolute(file) || TYPES_MODULE.test(path.basename(file)) || isGeneratedMirror(file)) {
          return;
        }
        const own = sourceCode.getAllComments()
          .filter((comment) => comment.type === "Block" && comment.value.startsWith("*"))
          .flatMap((comment) => commentTypes(`/*${comment.value}*/`).map((type) => ({ ...type, start: comment.range[0] + type.offset })));
        if (!own.length) {
          return;
        }
        const imports = importedNames(sourceCode.text, path.dirname(file));
        const keyed = own.map((type) => ({ ...type, key: typeKey(type.text, file, imports) }));
        const wanted = new Set(keyed.map((type) => type.key));
        const firstOtherFile = new Map();
        for (const other of packageSourceFiles(packageRootOf(file)).sort()) {
          if (other === file) {
            continue;
          }
          for (const key of typeKeysOf(other, context)) {
            if (wanted.has(key) && !firstOtherFile.has(key)) {
              firstOtherFile.set(key, other);
            }
          }
        }
        for (const type of keyed) {
          const other = firstOtherFile.get(type.key);
          if (!other) {
            continue;
          }
          // The type's own span, which the allow comment on the line before it excuses.
          const loc = { start: sourceCode.getLocFromIndex(type.start), end: sourceCode.getLocFromIndex(type.start + type.text.length) };
          const shown = type.text.replace(/\s+/gu, " ");
          report({ loc }, "repeated-type", "repeatedType", {
            type: shown.length > 120 ? `${shown.slice(0, 117)}...` : shown,
            other: toPosixPath(path.relative(context.cwd, other))
          });
        }
      }
    };
  }
});

export { namedRepeatedType };
