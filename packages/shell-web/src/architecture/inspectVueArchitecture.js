import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseJavaScript } from "@babel/parser";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { createRoutesContext, resolveOptions } from "vue-router/unplugin";

const INPUT_SCHEMA = "vibe64.architecture-inspection-input.v1";
const OUTPUT_SCHEMA = "genesis.architecture-observations.v1";
const ADAPTER_ID = "jskit.vue-static.v1";
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_RESOURCE_HOPS = 64;
const SCRIPT_FILE_PATTERN = /\.(?:[cm]?js|jsx|tsx?|vue)$/u;
const SERVER_FILE_PATTERN = /\.(?:js|mjs|cjs|ts)$/u;
const FUNCTION_NODE_PATTERN = /Function/u;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/u;
const RESOLVE_EXTENSIONS = Object.freeze([".vue", ".js", ".ts", "/index.js", "/index.ts"]);
const UI_ADAPTERS = Object.freeze(["jskit", "vue-filesystem-router", "vue-registered-router"]);
const FILESYSTEM_ROUTER_OPTIONS = Object.freeze(["routesFolder", "extensions", "exclude", "dts", "nestedChildren"]);
const CRUD_RESOURCE_OPERATIONS = Object.freeze(["list", "view", "create", "patch", "delete"]);
const CRUD_CONTROLLER_OPERATIONS = Object.freeze(["list", "view", "create", "update", "delete"]);
const CRUD_SCREEN_TRANSPORT_KEYS = Object.freeze(["screen", "client", "surfaceId", "transport"]);
const CRUD_SCREEN_CLIENT_KEYS = Object.freeze(["client", "surfaceId", "transport", "resource"]);

// Framework sources whose declarations this inspector reads statically.
const SOURCES = Object.freeze({
  crudResource: "@jskit-ai/resource-crud-core/shared/crudResource",
  crudJsonApiFeature: "@jskit-ai/crud-core/server/defineCrudJsonApiFeature",
  kernelFeatures: "@jskit-ai/kernel/server/features",
  crudListScreen: "@jskit-ai/http-web/client/components/CrudListScreen",
  crudAddEditScreen: "@jskit-ai/http-web/client/components/CrudAddEditScreen",
  crudComposables: "@jskit-ai/http-web/client/composables",
  filesystemRouter: "vue-router/vite",
  registeredRouter: "vue-router"
});

function hashBytes(source) {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function isCanonicalPath(value) {
  if (typeof value !== "string" || value.length === 0 || value === ".") {
    return false;
  }
  if (/[\\\0]/u.test(value) || path.posix.isAbsolute(value)) {
    return false;
  }
  return path.posix.normalize(value) === value && !value.split("/").includes("..");
}

function propertyKey(entry) {
  return entry.key.name || entry.key.value;
}

function isStaticObjectProperty(entry) {
  return entry.type === "ObjectProperty" && !entry.computed;
}

function objectProperty(node, key) {
  if (node?.type !== "ObjectExpression") {
    return undefined;
  }
  return node.properties.find((entry) => isStaticObjectProperty(entry) && propertyKey(entry) === key)?.value;
}

function hasOnlyStaticProperties(node) {
  return node.properties.every(isStaticObjectProperty);
}

function isFunctionNode(node) {
  return FUNCTION_NODE_PATTERN.test(node.type);
}

function directoryPrefixes(filePath) {
  const parts = filePath.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

// Every AST node with its ancestor chain, depth first.
function collectNodes(root) {
  const result = [];
  const pending = [{ node: root, ancestors: [] }];
  while (pending.length) {
    const current = pending.pop();
    const { node, ancestors } = current;
    if (!node || typeof node.type !== "string") {
      continue;
    }
    result.push(current);
    for (const value of Object.values(node)) {
      const children = Array.isArray(value) ? value : value?.type ? [value] : [];
      for (const child of children) {
        if (child?.type) {
          pending.push({ node: child, ancestors: [...ancestors, node] });
        }
      }
    }
  }
  return result;
}

// The literal value of an expression, following local bindings; undefined when
// any part is dynamic.
function staticValue(node, bindings, seen = new Set()) {
  if (!node) {
    return undefined;
  }
  if (["StringLiteral", "BooleanLiteral", "NumericLiteral"].includes(node.type)) {
    return node.value;
  }
  if (node.type === "NullLiteral") {
    return null;
  }
  if (node.type === "Identifier" && !seen.has(node.name)) {
    return staticValue(bindings.get(node.name), bindings, new Set([...seen, node.name]));
  }
  if (node.type === "ArrayExpression") {
    const values = node.elements.map((entry) => staticValue(entry, bindings, seen));
    return values.every((value) => value !== undefined) ? values : undefined;
  }
  if (node.type === "ObjectExpression") {
    return staticObjectValue(node, bindings, seen);
  }
  if (node.type === "TemplateLiteral") {
    const values = node.expressions.map((entry) => staticValue(entry, bindings, seen));
    if (values.some((value) => typeof value !== "string")) {
      return undefined;
    }
    return node.quasis.map((entry, index) => entry.value.cooked + (values[index] || "")).join("");
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticValue(node.left, bindings, seen);
    const right = staticValue(node.right, bindings, seen);
    return typeof left === "string" && typeof right === "string" ? left + right : undefined;
  }
  return undefined;
}

function staticObjectValue(node, bindings, seen) {
  const result = {};
  for (const entry of node.properties) {
    if (!isStaticObjectProperty(entry)) {
      return undefined;
    }
    const value = staticValue(entry.value, bindings, seen);
    if (value === undefined) {
      return undefined;
    }
    result[propertyKey(entry)] = value;
  }
  return result;
}

// The node an identifier is bound to locally, or the node itself.
function bindingNode(node, bindings, seen = new Set()) {
  if (node?.type !== "Identifier" || seen.has(node.name) || !bindings.has(node.name)) {
    return node;
  }
  return bindingNode(bindings.get(node.name), bindings, new Set([...seen, node.name]));
}

function isShadowed({ ancestors }, name) {
  return ancestors.some((node) =>
    node.params?.some((parameter) =>
      collectNodes(parameter).some(({ node: binding }) => binding.type === "Identifier" && binding.name === name)
    )
  );
}

function isLocalCall(record, names) {
  const { node } = record;
  return node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    names.has(node.callee.name) &&
    !isShadowed(record, node.callee.name);
}

function importedNames(module, source, imported) {
  const names = [...module.imports]
    .filter(([, entry]) => entry.source === source && entry.imported === imported)
    .map(([name]) => name);
  return new Set(names);
}

function findRecord(module, node) {
  return module.nodes.find((entry) => entry.node === node);
}

function kebabCase(name) {
  return name.replace(/[A-Z]/gu, (letter, index) => `${index ? "-" : ""}${letter.toLowerCase()}`);
}

// The imported local name a template tag refers to, by exact or kebab-case name.
function templateTagImport(module, tag) {
  return [...module.imports.keys()].find((name) => name === tag || kebabCase(name) === tag);
}

function sourcePoint(module, index) {
  const lines = module.source.slice(0, index).split("\n");
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function sourceEvidence(module, node, offset = 0) {
  const sourceEnd = Math.max(1, module.source.length - (module.source.endsWith("\n") ? 1 : 0));
  return [{
    path: module.path,
    hash: module.hash,
    start: sourcePoint(module, offset + (node?.start || 0)),
    end: sourcePoint(module, offset + (node?.end || sourceEnd))
  }];
}

function pageTitle(file) {
  const name = path.posix.basename(file, path.posix.extname(file));
  return name === "index" ? path.posix.basename(path.posix.dirname(file)) : name;
}

function validateInput({ projectRoot, input, aliases }) {
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

function createOutput({ input, httpScope }) {
  const httpCapability = httpScope ? "partial" : "unconfigured";
  const output = {
    schema: OUTPUT_SCHEMA,
    adapter: ADAPTER_ID,
    inputs: [],
    capabilities: {
      pages: "unconfigured",
      components: "partial",
      imports: "partial",
      entryOperations: httpCapability,
      operationUses: httpCapability
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
  if (input.packageIdentity) {
    output.packageIdentity = input.packageIdentity;
  }
  return output;
}

function warn(inspection, code, message, source) {
  inspection.output.diagnostics.push({ code, message, ...(source ? { path: source } : {}) });
}

// Reads one indexed, hash-matching source file once and parses its scripts.
// Non-script files are recorded as inputs without parsing.
async function loadModule(inspection, filePath) {
  const { files, modules, output, projectRoot } = inspection;
  if (modules.has(filePath)) {
    return modules.get(filePath);
  }
  if (!files.has(filePath)) {
    return null;
  }
  for (const directory of directoryPrefixes(filePath)) {
    if ((await lstat(path.join(projectRoot, directory))).isSymbolicLink()) {
      throw new Error("Architecture inspection cannot follow symbolic links.");
    }
  }
  const bytes = await readFile(path.join(projectRoot, filePath));
  if (bytes.length > MAX_SOURCE_BYTES || hashBytes(bytes) !== files.get(filePath).hash) {
    throw new Error(`Source changed or exceeded inspection bounds: ${filePath}`);
  }
  if (!SCRIPT_FILE_PATTERN.test(filePath)) {
    modules.set(filePath, null);
    output.inputs.push({ path: filePath, hash: hashBytes(bytes) });
    return null;
  }
  const source = bytes.toString("utf8");
  if (!Buffer.from(source).equals(bytes)) {
    throw new Error(`Source is not UTF-8: ${filePath}`);
  }
  const module = {
    path: filePath,
    source,
    hash: hashBytes(bytes),
    bindings: new Map(),
    imports: new Map(),
    nodes: [],
    exports: new Map(),
    descriptor: null
  };
  modules.set(filePath, module);
  output.inputs.push({ path: filePath, hash: module.hash });
  for (const unit of scriptUnits(inspection, module)) {
    indexScriptUnit(inspection, module, unit);
  }
  return module;
}

function scriptUnits(inspection, module) {
  if (!module.path.endsWith(".vue")) {
    return [{ source: module.source, offset: 0, setup: false }];
  }
  const parsed = parseSfc(module.source, { filename: module.path });
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
    module.nodes.push(...records.map((record) => ({ ...record, offset: unit.offset, setup: unit.setup })));
    for (const { node } of records) {
      indexDeclaration(module, node);
    }
  } catch {
    warn(inspection, "JAVASCRIPT_PARSE_FAILED", "A script needs unsupported syntax or could not be parsed.", module.path);
  }
}

function indexDeclaration(module, node) {
  if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
    // A name bound twice in one module is ambiguous, so it resolves to nothing.
    module.bindings.set(node.id.name, module.bindings.has(node.id.name) ? undefined : node.init);
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
    .filter((entry) => entry.importPath === dependency.importPath && inspection.files.has(entry.file))
    .map((entry) => entry.file);
  const candidates = [...new Set(entryFiles)];
  return candidates.length === 1 ? candidates[0] : null;
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

// Follows an expression through local bindings, imports and re-exports to a
// literal defineCrudResource declaration.
async function resolveCrudResource(inspection, module, node, seen = new Set()) {
  if (!node || seen.size >= MAX_RESOURCE_HOPS) {
    return null;
  }
  if (node.type === "Identifier") {
    const identity = `${module.path}:${node.name}`;
    if (seen.has(identity)) {
      return null;
    }
    const next = new Set([...seen, identity]);
    const imported = module.imports.get(node.name);
    if (!imported) {
      return resolveCrudResource(inspection, module, module.bindings.get(node.name), next);
    }
    const target = resolveImport(inspection, module.path, imported.source);
    const owner = target && await loadModule(inspection, target);
    return owner ? resolveExportedCrudResource(inspection, owner, imported.imported, next) : null;
  }
  if (node.type !== "CallExpression" || node.callee.type !== "Identifier") {
    return null;
  }
  const factory = module.imports.get(node.callee.name);
  const record = findRecord(module, node);
  const isFactory = factory?.source === SOURCES.crudResource && factory.imported === "defineCrudResource";
  if (!isFactory || !record || isShadowed(record, node.callee.name)) {
    return null;
  }
  const config = bindingNode(node.arguments[0], module.bindings);
  if (config?.type !== "ObjectExpression" || !hasOnlyStaticProperties(config)) {
    return null;
  }
  const namespace = staticValue(objectProperty(config, "namespace"), module.bindings);
  const declaredOperations = objectProperty(config, "crudOperations");
  const operations = declaredOperations ? staticValue(declaredOperations, module.bindings) : [...CRUD_RESOURCE_OPERATIONS];
  if (typeof namespace !== "string" || !namespace.trim()) {
    return null;
  }
  if (!Array.isArray(operations) || !operations.length || !operations.every((name) => CRUD_RESOURCE_OPERATIONS.includes(name))) {
    return null;
  }
  if (objectProperty(config, "operations")) {
    return null;
  }
  return { namespace: namespace.trim(), operations, evidence: sourceEvidence(module, node, record.offset) };
}

async function resolveExportedCrudResource(inspection, module, name, seen) {
  const entry = module.exports.get(name);
  if (!entry) {
    return null;
  }
  if (!entry.source) {
    return resolveCrudResource(inspection, module, { type: "Identifier", name: entry.local }, seen);
  }
  const identity = `${module.path}:export:${name}`;
  if (seen.has(identity) || seen.size >= MAX_RESOURCE_HOPS) {
    return null;
  }
  const target = resolveImport(inspection, module.path, entry.source);
  const owner = target && await loadModule(inspection, target);
  return owner ? resolveExportedCrudResource(inspection, owner, entry.local, new Set([...seen, identity])) : null;
}

function crudOperationKey(inspection, surface, namespace, operation, apiSuffix) {
  return {
    protocol: "jskit.crud",
    scope: JSON.stringify([inspection.httpScope, surface, apiSuffix]),
    operation: `${namespace}:${operation === "update" ? "patch" : operation}`
  };
}

// Records one page per surface and file, and one registration per route that
// renders it.
async function recordPage(inspection, { file, discovery, identity, registrationModule, registrationNode, parentId = null }) {
  const { output, pages } = inspection;
  const module = await loadModule(inspection, file);
  if (!module) {
    warn(inspection, "PAGE_SOURCE_UNAVAILABLE", "A registered page is outside the indexed project source.", file);
    return null;
  }
  const id = `page:${discovery.surface}:${file}`;
  if (!pages.has(id)) {
    const record = {
      id,
      title: pageTitle(file),
      kind: "page",
      surface: discovery.surface,
      file,
      parentId,
      resolution: "resolved",
      evidence: sourceEvidence(module)
    };
    pages.set(id, record);
    output.pages.push(record);
  } else if (pages.get(id).parentId !== parentId) {
    pages.get(id).parentId = null;
    warn(inspection, "PAGE_MULTIPLE_PARENTS", "A shared page has multiple registration contexts; registrations retain their identities.", file);
  }
  output.registrations.push({
    id: `registration:${discovery.id}:${output.registrations.length}`,
    pageId: id,
    surface: discovery.surface,
    identity,
    resolution: "resolved",
    evidence: sourceEvidence(registrationModule, registrationNode)
  });
  return id;
}

function isSupportedFilesystemOptions(options) {
  if (!options || Object.keys(options).some((key) => !FILESYSTEM_ROUTER_OPTIONS.includes(key))) {
    return false;
  }
  return typeof options.routesFolder === "string" || Array.isArray(options.routesFolder);
}

// Literal `VueRouter(...)` options scanned by Vue Router's own page scanner,
// with declarations and watchers disabled. Returns the supported call count.
async function discoverFilesystemPages(inspection, discovery, module, registrationPath) {
  const routerFactories = importedNames(module, SOURCES.filesystemRouter, "default");
  const calls = module.nodes.filter((record) => isLocalCall(record, routerFactories));
  let supported = 0;
  for (const { node } of calls) {
    const options = staticValue(node.arguments[0], module.bindings);
    if (!isSupportedFilesystemOptions(options)) {
      warn(inspection, "ROUTER_OPTIONS_UNSUPPORTED", "Filesystem routing needs literal supported options; runtime route extensions are not executed.", registrationPath);
      continue;
    }
    if (![options.routesFolder].flat().every(isCanonicalPath)) {
      warn(inspection, "ROUTER_ROOT_INVALID", "Router page roots must be inside the project.", registrationPath);
      continue;
    }
    let tree;
    const context = createRoutesContext(resolveOptions({
      ...options,
      root: inspection.projectRoot,
      dts: false,
      logs: false,
      beforeWriteFiles: (root) => {
        tree = root;
      }
    }));
    try {
      await context.scanPages(false);
      await recordFilesystemRoutes(inspection, { tree, discovery, module, node });
      supported++;
    } finally {
      context.stopWatcher();
    }
  }
  return supported;
}

async function recordFilesystemRoutes(inspection, { tree, discovery, module, node }) {
  const pending = [{ route: tree, parentId: null }];
  while (pending.length) {
    const { route, parentId } = pending.pop();
    let owner = parentId;
    for (const [view, absolute] of route.components) {
      const file = path.relative(inspection.projectRoot, absolute).split(path.sep).join("/");
      const identity = `${route.fullPath}${view === "default" ? "" : ` [${view}]`}`;
      const pageId = await recordPage(inspection, { file, discovery, identity, registrationModule: module, registrationNode: node, parentId });
      if (view === "default" && pageId) {
        owner = pageId;
      }
    }
    for (const child of route.children) {
      pending.push({ route: child, parentId: owner });
    }
  }
}

// Literal `createRouter({ routes })` declarations, including local route
// arrays and literal child routes. Returns the supported call count.
async function discoverRegisteredPages(inspection, discovery, module, registrationPath) {
  const routerFactories = importedNames(module, SOURCES.registeredRouter, "createRouter");
  const calls = module.nodes.filter((record) => isLocalCall(record, routerFactories));
  let supported = 0;
  for (const { node } of calls) {
    const routes = bindingNode(objectProperty(node.arguments[0], "routes"), module.bindings);
    if (routes?.type !== "ArrayExpression") {
      warn(inspection, "ROUTES_DYNAMIC", "Registered routes need a literal route array or its local binding.", registrationPath);
      continue;
    }
    await recordRegisteredRoutes(inspection, { routes, discovery, module, registrationPath });
    supported++;
  }
  return supported;
}

function routeComponentSpecifier(module, component) {
  if (component?.type === "Identifier") {
    return module.imports.get(component.name)?.source || null;
  }
  if (component?.type === "ArrowFunctionExpression" && component.body.type === "ImportExpression") {
    return staticValue(component.body.source, module.bindings);
  }
  return null;
}

async function recordRegisteredRoutes(inspection, { routes, discovery, module, registrationPath }) {
  const pending = routes.elements.slice().reverse().map((route) => ({ route, prefix: "", parentId: null }));
  while (pending.length) {
    const { route, prefix, parentId } = pending.pop();
    const routePath = staticValue(objectProperty(route, "path"), module.bindings);
    if (typeof routePath !== "string") {
      warn(inspection, "ROUTE_DYNAMIC", "A route path or spread cannot be resolved statically.", registrationPath);
      continue;
    }
    const identity = routePath.startsWith("/") ? routePath : `${prefix}/${routePath}`.replace(/\/{2,}/gu, "/");
    const component = bindingNode(objectProperty(route, "component"), module.bindings);
    const file = resolveImport(inspection, module.path, routeComponentSpecifier(module, component));
    let owner = parentId;
    if (file) {
      owner = await recordPage(inspection, { file, discovery, identity, registrationModule: module, registrationNode: route, parentId });
    } else if (component) {
      warn(inspection, "PAGE_COMPONENT_UNRESOLVED", "A registered route component is dynamic or outside the indexed project.", registrationPath);
    }
    const children = bindingNode(objectProperty(route, "children"), module.bindings);
    if (children?.type === "ArrayExpression") {
      pending.push(...children.elements.slice().reverse().map((child) => ({ route: child, prefix: identity, parentId: owner })));
    } else if (children) {
      warn(inspection, "ROUTES_DYNAMIC", "Child route registration is dynamic.", registrationPath);
    }
  }
}

async function discoverPages(inspection, discoveries) {
  let supported = 0;
  for (const discovery of discoveries) {
    if (!UI_ADAPTERS.includes(discovery.adapter)) {
      warn(inspection, "UI_ADAPTER_UNAVAILABLE", `No Vue inspector is available for ${discovery.adapter}.`);
      continue;
    }
    for (const registrationPath of discovery.registrations || []) {
      const module = await loadModule(inspection, registrationPath);
      if (!module) {
        warn(inspection, "REGISTRATION_UNAVAILABLE", "A routing input is not in the source inventory.", registrationPath);
        continue;
      }
      if (discovery.mode === "filesystem") {
        supported += await discoverFilesystemPages(inspection, discovery, module, registrationPath);
      } else {
        supported += await discoverRegisteredPages(inspection, discovery, module, registrationPath);
      }
    }
  }
  const { output } = inspection;
  if (supported) {
    output.capabilities.pages = output.diagnostics.length ? "partial" : "complete";
  } else {
    output.capabilities.pages = discoveries.length ? "unsupported" : "unconfigured";
  }
}

// Element tags and simple event-handler names of one component template.
function readTemplate(module) {
  const eventHandlers = new Set();
  const tags = [];
  const pending = [module.descriptor.template.ast];
  while (pending.length) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node.type === 1) {
      tags.push(node);
      for (const attribute of node.props || []) {
        const handler = attribute.exp?.content || "";
        if (attribute.type === 7 && attribute.name === "on" && IDENTIFIER_PATTERN.test(handler)) {
          eventHandlers.add(handler);
        }
      }
    }
    pending.push(...(node.children || []));
  }
  return { eventHandlers, tags };
}

// Walks page templates into the project components they actually use.
async function discoverComponents(inspection) {
  const pending = inspection.output.pages.map((record) => ({ file: record.file, parentId: record.id }));
  const inspected = new Set();
  while (pending.length) {
    const { file, parentId } = pending.pop();
    const module = await loadModule(inspection, file);
    if (!module?.descriptor?.template || inspected.has(parentId)) {
      continue;
    }
    inspected.add(parentId);
    const { eventHandlers, tags } = readTemplate(module);
    for (const tag of tags) {
      await recordComponentUse(inspection, { module, file, parentId, tag, pending });
    }
    if (!inspection.httpScope) {
      continue;
    }
    if (inspection.pages.has(parentId)) {
      for (const tag of tags) {
        await recordCrudScreenUse(inspection, { module, file, parentId, tag });
      }
    }
    recordFetchUses(inspection, { module, parentId, eventHandlers });
  }
}

async function recordComponentUse(inspection, { module, file, parentId, tag, pending }) {
  const { components, output } = inspection;
  const local = templateTagImport(module, tag.tag);
  if (!local && !/^[A-Z]|-/u.test(tag.tag) && tag.tag !== "component") {
    return;
  }
  if (!local && tag.tag.startsWith("v-")) {
    return;
  }
  const imported = module.imports.get(local);
  const target = resolveImport(inspection, file, imported?.source);
  let definition;
  if (target) {
    const targetModule = await loadModule(inspection, target);
    if (!targetModule) {
      warn(inspection, "COMPONENT_SOURCE_UNSUPPORTED", "An imported asset needs its own component adapter.", target);
      return;
    }
    const id = `component:${target}`;
    if (!components.has(id)) {
      const record = {
        id,
        title: path.posix.basename(target, path.posix.extname(target)),
        file: target,
        resolution: "resolved",
        evidence: sourceEvidence(targetModule)
      };
      components.set(id, record);
      output.components.push(record);
    }
    definition = components.get(id);
    pending.push({ file: target, parentId: id });
  } else if (imported) {
    definition = recordPackageComponent(inspection, { module, file, tag, imported });
  }
  const range = { start: tag.loc.start.offset, end: tag.loc.end.offset };
  output.componentUses.push({
    id: `component-use:${parentId}:${tag.loc.start.offset}`,
    parentId,
    ...(definition ? { componentId: definition.id } : {}),
    title: tag.tag,
    resolution: definition ? "resolved" : "unresolved",
    evidence: sourceEvidence(module, range)
  });
}

// A component imported from a declared package keeps its package boundary as
// owner; its implementation files are not read.
function recordPackageComponent(inspection, { module, file, tag, imported }) {
  const { components, input, output } = inspection;
  const dependency = resolvePackageImport(inspection, file, imported.source);
  if (!dependency || !input.packageIdentity) {
    return undefined;
  }
  const id = `component:package:${JSON.stringify([dependency.record.id, dependency.importPath, imported.imported])}`;
  if (!components.has(id)) {
    const importOffset = findRecord(module, imported.node)?.offset || 0;
    const record = {
      id,
      title: imported.imported === "default" ? tag.tag : imported.imported,
      file: null,
      origin: { kind: "package", packageId: dependency.record.id, importPath: dependency.importPath, symbol: imported.imported },
      resolution: "resolved",
      evidence: sourceEvidence(module, imported.node, importOffset)
    };
    components.set(id, record);
    output.components.push(record);
  }
  return components.get(id);
}

function crudScreenKind(component) {
  if (component?.source === SOURCES.crudListScreen && ["default", "CrudListScreen"].includes(component.imported)) {
    return "list";
  }
  if (component?.source === SOURCES.crudAddEditScreen && ["default", "CrudAddEditScreen"].includes(component.imported)) {
    return "edit";
  }
  return "";
}

// The setup-level `useCrudListScreen` / `useCrudAddEditScreen` call bound to a
// screen tag's `:screen`, or null.
function crudScreenCall(module, tag, list) {
  const screen = tag.props?.find((entry) => entry.type === 7 && entry.name === "bind" && entry.arg?.content === "screen")?.exp?.content;
  if (!IDENTIFIER_PATTERN.test(screen || "")) {
    return null;
  }
  const call = bindingNode(module.bindings.get(screen), module.bindings);
  if (call?.type !== "CallExpression" || call.callee.type !== "Identifier") {
    return null;
  }
  const helper = module.imports.get(call.callee.name);
  const expected = list ? "useCrudListScreen" : "useCrudAddEditScreen";
  if (!helper || helper.source !== `${SOURCES.crudComposables}/${expected}` || helper.imported !== expected) {
    return null;
  }
  const record = findRecord(module, call);
  if (!record?.setup || record.ancestors.some(isFunctionNode) || isShadowed(record, call.callee.name)) {
    return null;
  }
  return { call, record };
}

function hasDynamicScreenTransport(module, config) {
  const dynamicKey = CRUD_SCREEN_TRANSPORT_KEYS.some((key) =>
    objectProperty(config, key) && staticValue(objectProperty(config, key), module.bindings) !== null
  );
  return dynamicKey || config?.properties.some((entry) => !isStaticObjectProperty(entry));
}

function hasCustomScreenClient(options) {
  if (!options) {
    return false;
  }
  if (options.type !== "ObjectExpression") {
    return true;
  }
  return options.properties.some((entry) =>
    !isStaticObjectProperty(entry) || CRUD_SCREEN_CLIENT_KEYS.includes(propertyKey(entry))
  );
}

// A used JSKIT CRUD screen whose resource, operation and API suffix are
// literal becomes a `jskit.crud` operation use.
async function recordCrudScreenUse(inspection, { module, file, parentId, tag }) {
  const kind = crudScreenKind(module.imports.get(templateTagImport(module, tag.tag)));
  if (!kind) {
    return;
  }
  const list = kind === "list";
  const screenCall = crudScreenCall(module, tag, list);
  if (!screenCall) {
    return;
  }
  const { call, record } = screenCall;
  const config = bindingNode(call.arguments[0], module.bindings);
  const resource = await resolveCrudResource(inspection, module, objectProperty(config, "resource"));
  const operation = list ? "list" : staticValue(objectProperty(config, "operationName"), module.bindings);
  const options = bindingNode(objectProperty(config, list ? "listOptions" : "addEditOptions"), module.bindings);
  const apiSuffix = staticValue(objectProperty(list ? config : options, "apiSuffix"), module.bindings);
  const enabled = objectProperty(config, "readEnabled");
  if (list && enabled && staticValue(enabled, module.bindings) === false) {
    return;
  }
  const literalSuffix = typeof apiSuffix === "string" && apiSuffix.startsWith("/") && !apiSuffix.includes("?");
  const literalTransport = !hasDynamicScreenTransport(module, config) && !hasCustomScreenClient(options);
  const literalEnabled = !enabled || staticValue(enabled, module.bindings) === true;
  const resolved = Boolean(resource && resource.operations.includes(operation) && literalSuffix && literalTransport && literalEnabled);
  if (!resolved) {
    warn(inspection, "CRUD_SCREEN_UNRESOLVED", "A used CRUD screen has dynamic resource, operation or transport configuration.", file);
  }
  const surface = inspection.pages.get(parentId).surface;
  inspection.output.operationUses.push({
    id: `operation-use:${parentId}:crud:${tag.loc.start.offset}`,
    parentId,
    resolution: resolved ? "resolved" : "unresolved",
    ...(resolved ? { key: crudOperationKey(inspection, surface, resource.namespace, operation, apiSuffix) } : {}),
    evidence: [...sourceEvidence(module, call, record.offset), ...(resource?.evidence || [])]
  });
}

function isGlobalFetchCall(module, { node, ancestors }) {
  if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || node.callee.name !== "fetch") {
    return false;
  }
  return !module.bindings.has("fetch") && !module.imports.has("fetch") && !isShadowed({ ancestors }, "fetch");
}

// Global `fetch` calls made during setup or from a template event handler.
function recordFetchUses(inspection, { module, parentId, eventHandlers }) {
  for (const { node, ancestors, offset, setup } of module.nodes) {
    if (!isGlobalFetchCall(module, { node, ancestors })) {
      continue;
    }
    const enclosingFunction = ancestors.slice().reverse().find(isFunctionNode);
    const enclosingDeclarator = ancestors.slice().reverse().find((entry) => entry.type === "VariableDeclarator");
    const declaration = enclosingFunction?.id?.name || enclosingDeclarator?.id?.name;
    if (enclosingFunction ? !eventHandlers.has(declaration) : !setup) {
      continue;
    }
    const operation = staticValue(node.arguments[0], module.bindings);
    const method = staticValue(objectProperty(node.arguments[1], "method"), module.bindings) || "GET";
    const resolved = typeof operation === "string" && operation.startsWith("/") && !operation.includes("?") && typeof method === "string";
    inspection.output.operationUses.push({
      id: `operation-use:${parentId}:${offset + node.start}`,
      parentId,
      resolution: resolved ? "resolved" : "unresolved",
      ...(resolved ? { key: { protocol: "http", scope: inspection.httpScope, method: method.toUpperCase(), operation } } : {}),
      evidence: sourceEvidence(module, node, offset)
    });
  }
}

// Inspects the actual low-level JSKIT HTTP capability in a defineFeature setup
// and exported CRUD controller declarations. App-owned wrappers and dispatchers
// need their own inspector rather than a guessed match on a method name.
async function discoverEntryOperations(inspection) {
  for (const file of inspection.files.keys()) {
    if (!SERVER_FILE_PATTERN.test(file)) {
      continue;
    }
    const module = await loadModule(inspection, file);
    for (const record of module.nodes) {
      await recordCrudController(inspection, { module, file, record });
    }
    const featureFactories = importedNames(module, SOURCES.kernelFeatures, "defineFeature");
    if (!featureFactories.size) {
      continue;
    }
    for (const record of module.nodes) {
      recordFeatureRoute(inspection, { module, file, record, featureFactories });
    }
  }
}

function crudControllerOperations(module, config, resource) {
  const declared = objectProperty(config, "operations");
  if (declared) {
    return staticValue(declared, module.bindings);
  }
  return resource?.operations.map((name) => (name === "patch" ? "update" : name));
}

async function recordCrudController(inspection, { module, file, record }) {
  const { node, offset } = record;
  if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || isShadowed(record, node.callee.name)) {
    return;
  }
  const factory = module.imports.get(node.callee.name);
  if (factory?.source !== SOURCES.crudJsonApiFeature || factory.imported !== "defineCrudJsonApiFeature") {
    return;
  }
  if (record.ancestors.some(isFunctionNode)) {
    return;
  }
  const config = bindingNode(node.arguments[0], module.bindings);
  if (config?.type !== "ObjectExpression" || !hasOnlyStaticProperties(config)) {
    warn(inspection, "CRUD_CONTROLLER_UNRESOLVED", "A CRUD controller declaration is dynamic.", file);
    return;
  }
  const resource = await resolveCrudResource(inspection, module, objectProperty(config, "resource"));
  const surface = staticValue(objectProperty(config, "surface"), module.bindings);
  const routes = objectProperty(config, "routes");
  if (routes && staticValue(routes, module.bindings) === false) {
    return;
  }
  const relativePath = objectProperty(config, "relativePath");
  const apiSuffix = relativePath ? staticValue(relativePath, module.bindings) : resource && `/${resource.namespace.replace(/_/gu, "-")}`;
  const operations = crudControllerOperations(module, config, resource);
  const literalSuffix = typeof apiSuffix === "string" && apiSuffix.startsWith("/");
  const literalSurface = typeof surface === "string" && Boolean(surface.trim());
  const routesEnabled = !routes || staticValue(routes, module.bindings) === true;
  const knownOperations = Array.isArray(operations) && operations.length > 0 && operations.every((name) => CRUD_CONTROLLER_OPERATIONS.includes(name));
  if (!resource || !literalSuffix || !literalSurface || !routesEnabled || !knownOperations) {
    warn(inspection, "CRUD_CONTROLLER_UNRESOLVED", "A CRUD controller needs literal resource, surface and enabled operations.", file);
    return;
  }
  const declaration = record.ancestors.find((entry) => entry.type === "VariableDeclarator" && entry.id.type === "Identifier");
  if (!declaration || !module.exports.has(declaration.id.name)) {
    return;
  }
  for (const operation of new Set(operations)) {
    inspection.output.entryOperations.push({
      id: `entry:crud:${file}:${node.start}:${operation}`,
      key: crudOperationKey(inspection, surface.trim().toLowerCase(), resource.namespace, operation, apiSuffix),
      controllerFile: file,
      resolution: "resolved",
      evidence: [...sourceEvidence(module, node, offset), ...resource.evidence]
    });
  }
}

// `http.router.register(method, path, options, handler)` inside a
// `defineFeature` setup that receives `http`.
function recordFeatureRoute(inspection, { module, file, record, featureFactories }) {
  const { node, ancestors, offset } = record;
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.computed || node.callee.property.name !== "register") {
    return;
  }
  const router = node.callee.object;
  if (router.type !== "MemberExpression" || router.computed || router.property.name !== "router" || router.object.type !== "Identifier") {
    return;
  }
  const feature = ancestors.find((entry) => entry.type === "CallExpression" && entry.callee.type === "Identifier" && featureFactories.has(entry.callee.name));
  const setup = ancestors.slice().reverse().find((entry) => entry.type === "ObjectMethod" && entry.key.name === "setup");
  const setupParameter = setup?.params[0];
  const dependency = setupParameter?.type === "ObjectPattern" &&
    setupParameter.properties.find((entry) => entry.type === "ObjectProperty" && entry.key.name === "http");
  if (!feature || dependency?.value?.name !== router.object.name) {
    return;
  }
  const method = staticValue(node.arguments[0], module.bindings);
  const operation = staticValue(node.arguments[1], module.bindings);
  const handler = node.arguments[3];
  if (typeof method !== "string" || typeof operation !== "string" || !handler || !isFunctionNode(handler)) {
    warn(inspection, "CONTROLLER_UNRESOLVED", "A route's application handler or identity is dynamic.", file);
    return;
  }
  inspection.output.entryOperations.push({
    id: `entry:${inspection.httpScope}:${file}:${node.start}`,
    key: { protocol: "http", scope: inspection.httpScope, method: method.toUpperCase(), operation: `${inspection.apiBasePath}${operation}` },
    controllerFile: file,
    resolution: "resolved",
    evidence: sourceEvidence(module, node, offset)
  });
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

// Standalone, finite static inspection. No application import, watcher, server,
// Genesis dependency or runtime interpretation is needed to emit neutral JSON.
async function inspectVueArchitecture({ projectRoot, input, aliases = {}, httpScope = "", apiBasePath = "" }) {
  const { files, packages } = validateInput({ projectRoot, input, aliases });
  const inspection = {
    projectRoot,
    input,
    files,
    packages,
    aliases,
    httpScope,
    apiBasePath,
    output: createOutput({ input, httpScope }),
    modules: new Map(),
    components: new Map(),
    pages: new Map()
  };
  await discoverPages(inspection, input.uiDiscovery?.discoveries || []);
  await discoverComponents(inspection);
  if (httpScope) {
    await discoverEntryOperations(inspection);
  }
  await collectImports(inspection);
  return inspection.output;
}

export { inspectVueArchitecture };
