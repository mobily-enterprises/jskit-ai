import path from "node:path";
import { cacheKeys, cacheLocation, readCallCache, writeCallCache } from "./calls/cache.js";
import { inspectCalls } from "./calls/index.js";
import { SCRIPT_FILE_PATTERN, loadModule, projectHttpScope, readDeclaredSource, resolveImport, utf8Source, warn } from "./vue/modules.js";
import { discoverComponents, discoverPages } from "./vue/pages.js";
import { discoverEntryOperations } from "./vue/routes.js";
import { isCanonicalPath, sourceEvidence } from "./vue/syntax.js";

const INPUT_SCHEMA = "jskit.architecture-inspection-input.v1";
const OUTPUT_SCHEMA = "genesis.architecture-observations.v1";
const ADAPTER_ID = "jskit.vue-static.v1";

function validateInput({ projectRoot, input, aliases, apiPrefixAliases }) {
  if (!path.isAbsolute(projectRoot || "") || input?.schema !== INPUT_SCHEMA || !Array.isArray(input.files)) {
    throw new TypeError("An absolute project root and architecture inspection input are required.");
  }
  const files = new Map();
  for (const file of input.files) {
    if (!isCanonicalPath(file.path) || typeof file.hash !== "string" || files.has(file.path)) {
      throw new TypeError("Invalid indexed input file.");
    }
    files.set(file.path, file);
  }
  for (const value of Object.values(aliases)) {
    if (value !== "." && !isCanonicalPath(value)) {
      throw new TypeError("Aliases must resolve within the project.");
    }
  }
  for (const { client, route } of apiPrefixAliases) {
    if (!/^\/[^\s?#]*[^/\s?#]$/u.test(client) || !/^\/[^\s?#]*[^/\s?#]$/u.test(route)) {
      throw new TypeError("API prefix aliases map one absolute path prefix to another, without a trailing slash.");
    }
  }
  const packages = input.packages || [];
  const validPackage = (entry) =>
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    isCanonicalPath(entry.manifest) &&
    Array.isArray(entry.entryPoints);
  if (!Array.isArray(packages) || !packages.every(validPackage)) {
    throw new TypeError("Invalid package boundary input.");
  }
  return { files, packages };
}

function createOutput({ input, calls }) {
  const output = {
    schema: OUTPUT_SCHEMA,
    adapter: ADAPTER_ID,
    inputs: [],
    capabilities: {
      pages: "unconfigured",
      components: "partial",
      imports: "partial",
      entryOperations: "unconfigured",
      operationUses: "unconfigured"
    },
    pages: [],
    registrations: [],
    components: [],
    componentUses: [],
    entryOperations: [],
    operationUses: [],
    imports: [],
    diagnostics: []
  };
  if (calls) {
    Object.assign(output, { functions: [], calls: [], entryPoints: [] });
  }
  if (input.packageIdentity) {
    output.packageIdentity = input.packageIdentity;
  }
  return output;
}

function importSpecifierName(specifier) {
  if (specifier.type === "ImportNamespaceSpecifier") {
    return "*";
  }
  if (specifier.type === "ImportDefaultSpecifier") {
    return "default";
  }
  return specifier.imported.name || specifier.imported.value;
}

function isTypeOnlyImport(node) {
  if (node.importKind === "type") {
    return true;
  }
  return Boolean(node.specifiers.length && node.specifiers.every((specifier) => specifier.importKind === "type"));
}

// Source imports resolved with the same resolver as UI discovery. These are
// imported names, not proof that an operation executes. Opaque packages stay
// with package discovery; no dependency tree is read.
async function collectImports(inspection) {
  for (const file of inspection.files.keys()) {
    if (!SCRIPT_FILE_PATTERN.test(file)) {
      continue;
    }
    const module = await loadModule(inspection, file);
    for (const { node, offset } of module.nodes) {
      if (node.type !== "ImportDeclaration") {
        continue;
      }
      const target = resolveImport(inspection, file, node.source.value);
      if (!target) {
        continue;
      }
      await loadModule(inspection, target);
      inspection.output.imports.push({
        id: `import:${file}:${offset + node.start}`,
        fromFile: file,
        targetFile: target,
        specifier: node.source.value,
        names: node.specifiers.map(importSpecifierName),
        typeOnly: isTypeOnlyImport(node),
        resolution: "resolved",
        evidence: sourceEvidence(module, node, offset)
      });
    }
  }
}

// The page or component record a file defines, for operation uses found in it.
function parentIdForFile(inspection, file) {
  const { output } = inspection;
  return output.pages.find((page) => page.file === file)?.id ||
    output.components.find((component) => component.file === file)?.id ||
    null;
}

// Functions, calls, transport operation uses and action entry points from the
// TypeScript checker over every declared script. With a usable cache
// directory, an unchanged run reuses its earlier result, and otherwise each
// file whose own and directly imported sources are unchanged keeps its calls.
async function discoverCalls(inspection) {
  const { files, output, projectRoot } = inspection;
  const scripts = [...files.keys()].filter((file) => SCRIPT_FILE_PATTERN.test(file));
  const keys = cacheKeys({
    input: inspection.input,
    files,
    imports: output.imports,
    scripts,
    options: {
      aliases: inspection.aliases,
      httpScope: inspection.httpScope,
      apiBasePath: inspection.apiBasePath,
      apiPrefixAliases: inspection.apiPrefixAliases
    }
  });
  const location = await cacheLocation(projectRoot, inspection.input.cacheDirectory);
  const cache = location && await readCallCache(location, keys.key);
  const sources = new Map();
  const hashes = new Map();
  for (const file of scripts) {
    sources.set(file, utf8Source(await readDeclaredSource(inspection, file), file));
    hashes.set(file, files.get(file).hash);
  }
  const run = cache?.run?.key === keys.runKey ? cache.run : await inspectCallsAndCache(inspection, {
    sources,
    hashes,
    keys,
    location,
    reuse: new Map(scripts.filter((file) => cache?.files[file]?.key === keys.fileKeys.get(file)).map((file) => [file, cache.files[file]]))
  });
  for (const [code, message, file] of run.diagnostics) {
    warn(inspection, code, message, file);
  }
  const controllers = new Map(run.controllers);
  for (const entry of output.entryOperations) {
    if (controllers.has(entry.id)) {
      entry.controllerFunctionId = controllers.get(entry.id);
    }
  }
  const filesInOrder = run.order.map((file) => run.files?.[file] || cache.files[file]);
  output.functions.push(...filesInOrder.flatMap((entry) => entry.functions));
  output.calls.push(...filesInOrder.flatMap((entry) => entry.calls));
  output.entryPoints.push(...run.entryPoints);
  output.operationUses.push(...run.operationUses);
  output.capabilities.functions = run.complete ? "complete" : "partial";
  output.capabilities.calls = run.complete && !run.truncated ? "complete" : "partial";
  output.capabilities.entryPoints = "partial";
  if (inspection.httpScope) {
    output.capabilities.operationUses = "partial";
  }
}

// One call pass, written to the cache when one is usable. The run's
// diagnostics are kept so an unchanged rerun reports them again.
async function inspectCallsAndCache(inspection, { sources, hashes, keys, location, reuse }) {
  const diagnostics = [];
  const result = inspectCalls({
    projectRoot: inspection.projectRoot,
    sources,
    hashes,
    resolveImport: (from, specifier) => resolveImport(inspection, from, specifier),
    entryOperations: inspection.output.entryOperations,
    handlerRanges: inspection.handlerRanges,
    transports: Boolean(inspection.httpScope),
    parentIdForFile: (file) => parentIdForFile(inspection, file),
    prefixAliases: inspection.apiPrefixAliases,
    diagnose: (code, message, file) => diagnostics.push([code, message, file]),
    reuse
  });
  const run = {
    key: keys.runKey,
    order: [...result.fileRecords.keys()],
    controllers: [...result.controllers].map(([entry, functionId]) => [entry.id, functionId]),
    entryPoints: result.entryPoints,
    operationUses: result.operationUses,
    complete: result.complete,
    truncated: result.truncated,
    diagnostics
  };
  const files = Object.fromEntries([...result.fileRecords].map(([file, records]) => [file, { key: keys.fileKeys.get(file), ...records }]));
  if (location) {
    await writeCallCache(location, { key: keys.key, run, files });
  }
  return { ...run, files };
}

// Standalone, finite static inspection. No application import, watcher, server,
// Genesis dependency or runtime interpretation is needed to emit neutral JSON.
async function inspectVueArchitecture({
  projectRoot,
  input,
  aliases = {},
  httpScope = "",
  apiBasePath = "",
  calls = false,
  apiPrefixAliases = []
}) {
  const { files, packages } = validateInput({ projectRoot, input, aliases, apiPrefixAliases });
  const inspection = {
    projectRoot,
    input,
    files,
    packages,
    aliases,
    httpScope,
    apiBasePath,
    calls,
    apiPrefixAliases,
    output: createOutput({ input, calls }),
    modules: new Map(),
    sources: new Map(),
    checkedDirectories: new Set(),
    handlerRanges: new Map(),
    routeRegistrations: new Set(),
    components: new Map(),
    pages: new Map()
  };
  inspection.httpScope ||= await projectHttpScope(inspection);
  if (inspection.httpScope) {
    Object.assign(inspection.output.capabilities, { entryOperations: "partial", operationUses: "partial" });
  }
  await discoverPages(inspection, input.uiDiscovery?.discoveries || []);
  await discoverComponents(inspection);
  if (inspection.httpScope) {
    await discoverEntryOperations(inspection);
  }
  await collectImports(inspection);
  if (calls) {
    // The call pass has its own TypeScript syntax trees; the parsed modules
    // are released first so both never stay in memory together.
    inspection.modules.clear();
    await discoverCalls(inspection);
  }
  return inspection.output;
}

export { inspectVueArchitecture };
