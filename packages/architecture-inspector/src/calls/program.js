import path from "node:path";
import ts from "typescript";
import { parse as parseSfc } from "@vue/compiler-sfc";

const SCRIPT_EXTENSIONS = Object.freeze({
  ".js": ts.Extension.Js,
  ".mjs": ts.Extension.Mjs,
  ".cjs": ts.Extension.Cjs,
  ".jsx": ts.Extension.Jsx,
  ".ts": ts.Extension.Ts,
  ".tsx": ts.Extension.Tsx
});
const LIBRARIES = Object.freeze(["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"]);
const COMPILER_OPTIONS = Object.freeze({
  allowJs: true,
  checkJs: false,
  noEmit: true,
  strict: false,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  skipLibCheck: true,
  skipDefaultLibCheck: true,
  allowArbitraryExtensions: true,
  allowImportingTsExtensions: true,
  maxNodeModuleJsDepth: 0,
  types: [],
  lib: LIBRARIES
});

// A Vue component's script blocks at their original offsets; template and
// style text become spaces so every position matches the component file.
function vueScriptText(source, filePath) {
  const { descriptor, errors } = parseSfc(source, { filename: filePath, sourceMap: false });
  if (errors.length) {
    return null;
  }
  const characters = source.replace(/[^\n]/gu, " ").split("");
  let extension = ".js";
  for (const script of [descriptor.script, descriptor.scriptSetup].filter((entry) => entry && !entry.src)) {
    const start = script.loc.start.offset;
    for (let index = 0; index < script.content.length; index += 1) {
      characters[start + index] = script.content[index];
    }
    if (script.lang === "ts" || script.lang === "tsx") {
      extension = `.${script.lang}`;
    } else if (script.lang === "jsx" && extension === ".js") {
      extension = ".jsx";
    }
  }
  return { text: characters.join(""), extension };
}

// One TypeScript program over the declared, hash-verified project
// scripts only. Imports resolve through the inspector's own resolver
// (relative, aliases, declared package entry points); everything else, including
// every node_modules package, stays outside the program. TypeScript's default
// libraries remain so builtin calls are recognised and dropped.
function loadCallProgram({ projectRoot, sources, resolveImport }) {
  const virtual = new Map();
  const realToVirtual = new Map();
  let complete = true;
  for (const [file, source] of sources) {
    const absolute = path.join(projectRoot, file);
    let text = source;
    let name = absolute;
    if (file.endsWith(".vue")) {
      const script = vueScriptText(source, file);
      if (!script) {
        complete = false;
        continue;
      }
      text = script.text;
      name = `${absolute}${script.extension}`;
    } else if (!SCRIPT_EXTENSIONS[path.extname(file)]) {
      continue;
    }
    virtual.set(name, { file, text });
    realToVirtual.set(file, name);
  }

  const libraryDirectory = path.dirname(ts.getDefaultLibFilePath(COMPILER_OPTIONS));
  const isLibraryFile = (name) => path.dirname(name) === libraryDirectory && /^lib\.[\w.]*\.d\.ts$/u.test(path.basename(name));
  const resolutions = new Map();
  function resolveModule(specifier, containing) {
    const from = virtual.get(containing)?.file;
    if (!from) {
      return undefined;
    }
    const key = `${path.posix.dirname(from)}\0${specifier}`;
    if (!resolutions.has(key)) {
      const target = resolveImport(from, specifier);
      const name = target && realToVirtual.get(target);
      const extension = name && SCRIPT_EXTENSIONS[path.extname(name)];
      resolutions.set(key, extension ? { resolvedFileName: name, extension, isExternalLibraryImport: false } : undefined);
    }
    return resolutions.get(key);
  }

  const host = {
    getSourceFile(name, languageVersion) {
      const text = virtual.get(name)?.text ?? (isLibraryFile(name) ? ts.sys.readFile(name) : undefined);
      return text === undefined ? undefined : ts.createSourceFile(name, text, languageVersion);
    },
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    writeFile: () => {},
    getCurrentDirectory: () => projectRoot,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => virtual.has(name) || (isLibraryFile(name) && ts.sys.fileExists(name)),
    readFile: (name) => virtual.get(name)?.text ?? (isLibraryFile(name) ? ts.sys.readFile(name) : undefined),
    directoryExists: (name) => name === libraryDirectory || name === projectRoot || name.startsWith(`${projectRoot}${path.sep}`),
    getDirectories: () => [],
    realpath: (name) => name,
    resolveModuleNameLiterals: (literals, containing) =>
      literals.map((literal) => ({ resolvedModule: resolveModule(literal.text, containing) })),
    resolveTypeReferenceDirectiveReferences: (references) =>
      references.map(() => ({ resolvedTypeReferenceDirective: undefined }))
  };
  const program = ts.createProgram({ rootNames: [...virtual.keys()], options: COMPILER_OPTIONS, host });
  const sourceFiles = new Map();
  for (const sourceFile of program.getSourceFiles()) {
    const file = virtual.get(sourceFile.fileName)?.file;
    if (file) {
      sourceFiles.set(file, sourceFile);
    }
  }
  return {
    ts,
    complete,
    program,
    checker: program.getTypeChecker(),
    sourceFiles,
    fileOf: (node) => virtual.get(node.getSourceFile().fileName)?.file ?? null,
    isLibrary: (node) => program.isSourceFileDefaultLibrary(node.getSourceFile()),
    programFiles: program.getSourceFiles().map((sourceFile) =>
      virtual.get(sourceFile.fileName)?.file ?? path.relative(projectRoot, sourceFile.fileName))
  };
}

export { loadCallProgram };
