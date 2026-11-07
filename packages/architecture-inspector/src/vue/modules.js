import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseJavaScript } from "@babel/parser";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { collectNodes, directoryPrefixes, hashBytes, isCanonicalPath } from "./syntax.js";

// The project's declared sources: reading each once against its declared
// hash, parsing scripts and Vue single-file components, and resolving imports
// to project files or package entry points.

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_RESOURCE_HOPS = 64;
const SCRIPT_FILE_PATTERN = /\.(?:[cm]?js|jsx|tsx?|vue)$/u;
const RESOLVE_EXTENSIONS = Object.freeze([".vue", ".js", ".ts", "/index.js", "/index.ts"]);

// Framework sources whose declarations this inspector reads statically.
const SOURCES = Object.freeze({
  crudContract: "@jskit-ai/resource-crud-core/shared/crudContract",
  tableResource: "@jskit-ai/resource-core/shared/tableResource",
  crudJsonApiFeature: "@jskit-ai/crud-core/server/defineCrudJsonApiFeature",
  kernelFeatures: "@jskit-ai/kernel/server/features",
  kernelHttp: "@jskit-ai/kernel/server/http",
  crudListScreen: "@jskit-ai/http-web/client/components/CrudListScreen",
  crudAddEditScreen: "@jskit-ai/http-web/client/components/CrudAddEditScreen",
  crudComposables: "@jskit-ai/http-web/client/composables",
  filesystemRouter: "vue-router/vite",
  registeredRouter: "vue-router"
});

function warn(inspection, code, message, source) {
  inspection.output.diagnostics.push({ code, message, ...(source ? { path: source } : {}) });
}

// Reads one indexed, hash-matching source file once and records it as an
// input. Symbolic links, changed sources and oversized files are refused.
async function readDeclaredSource(inspection, filePath) {
  const { files, output, projectRoot, sources } = inspection;
  if (sources.has(filePath)) {
    return sources.get(filePath);
  }
  for (const directory of directoryPrefixes(filePath)) {
    if (inspection.checkedDirectories.has(directory)) {
      continue;
    }
    if ((await lstat(path.join(projectRoot, directory))).isSymbolicLink()) {
      throw new Error("Architecture inspection cannot follow symbolic links.");
    }
    inspection.checkedDirectories.add(directory);
  }
  const bytes = await readFile(path.join(projectRoot, filePath));
  if (bytes.length > MAX_SOURCE_BYTES || hashBytes(bytes) !== files.get(filePath).hash) {
    throw new Error(`Source changed or exceeded inspection bounds: ${filePath}`);
  }
  output.inputs.push({ path: filePath, hash: files.get(filePath).hash });
  sources.set(filePath, bytes);
  return bytes;
}

// A JSKIT application serves its own HTTP operations, so without an explicit
// scope the root manifest's package name identifies them. A manifest that is
// absent, unnamed or not JSON leaves HTTP observations unconfigured.
async function projectHttpScope(inspection) {
  if (!inspection.files.has("package.json")) {
    return "";
  }
  const bytes = await readDeclaredSource(inspection, "package.json");
  try {
    const { name } = JSON.parse(bytes.toString("utf8"));
    return typeof name === "string" ? name.trim() : "";
  } catch {
    return "";
  }
}

function utf8Source(bytes, filePath) {
  const source = bytes.toString("utf8");
  if (!Buffer.from(source).equals(bytes)) {
    throw new Error(`Source is not UTF-8: ${filePath}`);
  }
  return source;
}

// Reads one indexed source file once and parses its scripts. Non-script files
// are recorded as inputs without parsing.
async function loadModule(inspection, filePath) {
  const { files, modules } = inspection;
  if (modules.has(filePath)) {
    return modules.get(filePath);
  }
  if (!files.has(filePath)) {
    return null;
  }
  const bytes = await readDeclaredSource(inspection, filePath);
  if (!SCRIPT_FILE_PATTERN.test(filePath)) {
    modules.set(filePath, null);
    return null;
  }
  const module = {
    path: filePath,
    source: utf8Source(bytes, filePath),
    hash: files.get(filePath).hash,
    bindings: new Map(),
    constants: new Set(),
    imports: new Map(),
    nodes: [],
    exports: new Map(),
    descriptor: null
  };
  modules.set(filePath, module);
  for (const unit of scriptUnits(inspection, module)) {
    indexScriptUnit(inspection, module, unit);
  }
  return module;
}

function scriptUnits(inspection, module) {
  if (!module.path.endsWith(".vue")) {
    return [{ source: module.source, offset: 0, setup: false }];
  }
  const parsed = parseSfc(module.source, { filename: module.path, sourceMap: false });
  if (parsed.errors.length) {
    warn(inspection, "VUE_PARSE_FAILED", "The component could not be parsed completely.", module.path);
    return [];
  }
  module.descriptor = parsed.descriptor;
  const units = [];
  const scripts = [parsed.descriptor.script, parsed.descriptor.scriptSetup].filter(Boolean);
  for (const script of scripts) {
    if (script.src) {
      warn(inspection, "VUE_EXTERNAL_SCRIPT", "External component scripts need another inspection adapter.", module.path);
      continue;
    }
    units.push({ source: script.content, offset: script.loc.start.offset, setup: script === parsed.descriptor.scriptSetup });
  }
  return units;
}

function indexScriptUnit(inspection, module, unit) {
  try {
    const ast = parseJavaScript(unit.source, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx"],
      createImportExpressions: true
    });
    const records = collectNodes(ast);
    for (const record of records) {
      Object.assign(record, { offset: unit.offset, setup: unit.setup });
      module.nodes.push(record);
      indexDeclaration(module, record.node, record.parent?.node);
    }
  } catch {
    warn(inspection, "JAVASCRIPT_PARSE_FAILED", "A script needs unsupported syntax or could not be parsed.", module.path);
  }
}

function indexDeclaration(module, node, parent) {
  if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
    // A name bound twice in one module is ambiguous, so it resolves to nothing.
    module.bindings.set(node.id.name, module.bindings.has(node.id.name) ? undefined : node.init);
    if (parent?.kind === "const") {
      module.constants.add(node.id.name);
    }
  }
  if (node.type === "ExportNamedDeclaration") {
    for (const specifier of node.specifiers) {
      if (specifier.type === "ExportSpecifier") {
        const exported = specifier.exported.name || specifier.exported.value;
        const local = specifier.local.name || specifier.local.value;
        module.exports.set(exported, { local, source: node.source?.value });
      }
    }
    if (node.declaration?.type === "VariableDeclaration") {
      for (const entry of node.declaration.declarations) {
        if (entry.id.type === "Identifier") {
          module.exports.set(entry.id.name, { local: entry.id.name });
        }
      }
    }
    if (node.declaration?.type === "FunctionDeclaration" && node.declaration.id) {
      module.exports.set(node.declaration.id.name, { local: node.declaration.id.name });
    }
  }
  if (node.type === "ImportDeclaration") {
    for (const specifier of node.specifiers) {
      module.imports.set(specifier.local.name, {
        source: node.source.value,
        imported: specifier.imported?.name || "default",
        node
      });
    }
  }
}

// Resolves an import specifier to an indexed project file through relative
// paths, project-root paths, declared aliases and declared package entry points.
function resolveImport(inspection, from, specifier) {
  const { aliases, files } = inspection;
  if (typeof specifier !== "string") {
    return null;
  }
  let base;
  if (specifier.startsWith(".")) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  } else if (specifier.startsWith("/")) {
    base = specifier.slice(1);
  } else {
    const alias = Object.keys(aliases)
      .sort((a, b) => b.length - a.length)
      .find((key) => specifier === key || specifier.startsWith(key + "/"));
    if (alias) {
      base = path.posix.join(aliases[alias], specifier.slice(alias.length));
    }
  }
  if (!base) {
    const packageEntry = resolvePackageEntryFile(inspection, from, specifier);
    if (packageEntry) {
      return packageEntry;
    }
  }
  if (!isCanonicalPath(base)) {
    return null;
  }
  const candidates = [base, ...RESOLVE_EXTENSIONS.map((extension) => base + extension)];
  return candidates.find((candidate) => files.has(candidate)) || null;
}

function resolvePackageEntryFile(inspection, from, specifier) {
  const dependency = resolvePackageImport(inspection, from, specifier);
  if (!dependency || dependency.record.opaque) {
    return null;
  }
  const entryFiles = dependency.record.entryPoints
    .map((entry) => packageEntryTarget(entry, dependency.importPath))
    .filter((file) => file && inspection.files.has(file));
  const candidates = [...new Set(entryFiles)];
  return candidates.length === 1 ? candidates[0] : null;
}

// The file an entry point serves for an import path: its own file for an
// exact subpath, or a "./name/*" pattern's file with the matched part put in
// place of its "*", as Node resolves subpath patterns.
function packageEntryTarget(entry, importPath) {
  if (entry.importPath === importPath) {
    return entry.file;
  }
  const star = entry.importPath.indexOf("*");
  if (star < 0 || entry.importPath.indexOf("*", star + 1) >= 0 || !entry.file.includes("*")) {
    return null;
  }
  const prefix = entry.importPath.slice(0, star);
  const suffix = entry.importPath.slice(star + 1);
  if (importPath.length <= prefix.length + suffix.length || !importPath.startsWith(prefix) || !importPath.endsWith(suffix)) {
    return null;
  }
  return entry.file.replace("*", importPath.slice(prefix.length, importPath.length - suffix.length));
}

// The declared package an import names, chosen by the nearest manifest that
// contains the importing file.
function resolvePackageImport(inspection, from, specifier) {
  if (typeof specifier !== "string" || specifier.startsWith(".") || specifier.startsWith("/")) {
    return null;
  }
  const namesPackage = (entry) => specifier === entry.name || specifier.startsWith(`${entry.name}/`);
  const containsFile = (declaration) => {
    const parent = path.posix.dirname(declaration.manifest);
    return parent === "." || from.startsWith(`${parent}/`);
  };
  const candidates = inspection.packages
    .flatMap((entry) =>
      (entry.declarations || [{ manifest: entry.manifest }])
        .filter((declaration) => containsFile(declaration) && namesPackage(entry))
        .map((declaration) => ({ record: entry, manifest: declaration.manifest }))
    )
    .sort((a, b) => b.manifest.length - a.manifest.length);
  const record = candidates[0]?.record;
  if (!record) {
    return null;
  }
  return { record, importPath: specifier === record.name ? "." : `.${specifier.slice(record.name.length)}` };
}

export {
  MAX_RESOURCE_HOPS,
  SCRIPT_FILE_PATTERN,
  SOURCES,
  loadModule,
  projectHttpScope,
  readDeclaredSource,
  resolveImport,
  resolvePackageImport,
  utf8Source,
  warn
};
