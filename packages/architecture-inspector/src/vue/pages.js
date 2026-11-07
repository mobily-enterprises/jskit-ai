import path from "node:path";
import { createRoutesContext, resolveOptions } from "vue-router/unplugin";
import { MAX_RESOURCE_HOPS, SOURCES, loadModule, resolveImport, resolvePackageImport, warn } from "./modules.js";
import {
  bindingNode,
  findRecord,
  hasOnlyStaticProperties,
  importedNames,
  isCanonicalPath,
  isFunctionNode,
  isLocalCall,
  isShadowed,
  isStaticObjectProperty,
  objectProperty,
  propertyKey,
  sourceEvidence,
  staticValue,
  templateTagImport
} from "./syntax.js";

// Pages, components and the HTTP calls UI code makes: file-system and
// registered routes, component use, CRUD screens and direct fetch calls.

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/u;
const UI_ADAPTERS = Object.freeze(["jskit", "vue-filesystem-router", "vue-registered-router"]);
const FILESYSTEM_ROUTER_OPTIONS = Object.freeze(["routesFolder", "extensions", "exclude", "dts", "nestedChildren"]);
const CRUD_RESOURCE_OPERATIONS = Object.freeze(["list", "view", "create", "patch", "delete"]);
const CRUD_SCREEN_TRANSPORT_KEYS = Object.freeze(["screen", "client", "surfaceId", "transport"]);
const CRUD_SCREEN_CLIENT_KEYS = Object.freeze(["client", "surfaceId", "transport", "resource"]);

function pageTitle(file) {
  const name = path.posix.basename(file, path.posix.extname(file));
  return name === "index" ? path.posix.basename(path.posix.dirname(file)) : name;
}

// Follows an expression through local bindings, imports and re-exports to the
// call that made its value, and the module that call is in.
async function resolveCall(inspection, module, node, seen = new Set()) {
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
      return resolveCall(inspection, module, module.bindings.get(node.name), next);
    }
    const target = resolveImport(inspection, module.path, imported.source);
    const owner = target && await loadModule(inspection, target);
    return owner ? resolveExportedCall(inspection, owner, imported.imported, next) : null;
  }
  return node.type === "CallExpression" && node.callee.type === "Identifier" ? { module, node } : null;
}

async function resolveExportedCall(inspection, module, name, seen) {
  const entry = module.exports.get(name);
  if (!entry) {
    return null;
  }
  if (!entry.source) {
    return resolveCall(inspection, module, { type: "Identifier", name: entry.local }, seen);
  }
  const identity = `${module.path}:export:${name}`;
  if (seen.has(identity) || seen.size >= MAX_RESOURCE_HOPS) {
    return null;
  }
  const target = resolveImport(inspection, module.path, entry.source);
  const owner = target && await loadModule(inspection, target);
  return owner ? resolveExportedCall(inspection, owner, entry.local, new Set([...seen, identity])) : null;
}

// The node record of a call to `imported` from `source`, unless a local binding shadows it.
function factoryRecord({ module, node }, source, imported) {
  const factory = module.imports.get(node.callee.name);
  const record = findRecord(module, node);
  return factory?.source === source && factory.imported === imported && record && !isShadowed(record, node.callee.name)
    ? record
    : null;
}

// The literal name of the table resource an expression stands for.
async function resolveTableResourceName(inspection, module, node) {
  const call = await resolveCall(inspection, module, node);
  if (!call || !factoryRecord(call, SOURCES.tableResource, "defineTableResource")) {
    return undefined;
  }
  const definition = bindingNode(call.node.arguments[0], call.module.bindings);
  return staticValue(objectProperty(definition, "name"), call.module.bindings);
}

// The namespace and operations of the literal defineCrudContract declaration
// an expression stands for. Its namespace is its own, else its table resource's name.
async function resolveCrudResource(inspection, module, node) {
  const call = await resolveCall(inspection, module, node);
  const record = call && factoryRecord(call, SOURCES.crudContract, "defineCrudContract");
  if (!record) {
    return null;
  }
  const config = call.node.arguments[1] ? bindingNode(call.node.arguments[1], call.module.bindings) : null;
  if (config && (config.type !== "ObjectExpression" || !hasOnlyStaticProperties(config))) {
    return null;
  }
  const declaredNamespace = objectProperty(config, "namespace");
  const namespace = declaredNamespace
    ? staticValue(declaredNamespace, call.module.bindings)
    : await resolveTableResourceName(inspection, call.module, call.node.arguments[0]);
  const declaredOperations = objectProperty(config, "operations");
  const operations = declaredOperations ? staticValue(declaredOperations, call.module.bindings) : [...CRUD_RESOURCE_OPERATIONS];
  if (typeof namespace !== "string" || !namespace.trim()) {
    return null;
  }
  if (!Array.isArray(operations) || !operations.length || !operations.every((name) => CRUD_RESOURCE_OPERATIONS.includes(name))) {
    return null;
  }
  return { namespace: namespace.trim(), operations, evidence: sourceEvidence(call.module, call.node, record.offset) };
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

function byCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function recordFilesystemRoutes(inspection, { tree, discovery, module, node }) {
  const pending = [{ route: tree, parentId: null }];
  while (pending.length) {
    const { route, parentId } = pending.pop();
    let owner = parentId;
    for (const [view, absolute] of [...route.components].sort(([left], [right]) => byCodeUnits(left, right))) {
      const file = path.relative(inspection.projectRoot, absolute).split(path.sep).join("/");
      const identity = `${route.fullPath}${view === "default" ? "" : ` [${view}]`}`;
      const pageId = await recordPage(inspection, { file, discovery, identity, registrationModule: module, registrationNode: node, parentId });
      if (view === "default" && pageId) {
        owner = pageId;
      }
    }
    // Scan order follows the filesystem and registration ids are positional,
    // so siblings are visited in fullPath order (pushed reversed for the stack).
    for (const child of [...route.children].sort((left, right) => byCodeUnits(right.fullPath, left.fullPath))) {
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
    if (!inspection.calls) {
      recordFetchUses(inspection, { module, parentId, eventHandlers });
    }
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

export {
  crudOperationKey,
  discoverComponents,
  discoverPages,
  resolveCrudResource
};
