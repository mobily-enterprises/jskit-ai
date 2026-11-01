import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { MAX_RESOURCE_HOPS, SOURCES, loadModule, resolveImport, warn } from "./modules.js";
import { crudOperationKey, resolveCrudResource } from "./pages.js";
import {
  bindingNode,
  collectNodes,
  hasOnlyStaticProperties,
  importedNames,
  isFunctionNode,
  isLocalCall,
  isShadowed,
  isStaticObjectProperty,
  objectProperty,
  propertyKey,
  sourceEvidence,
  staticValue
} from "./syntax.js";

// Server entry operations: CRUD controllers and actions, feature routes,
// router routes and the API scope each action route is served under.

const CRUD_CONTROLLER_OPERATIONS = Object.freeze(["list", "view", "create", "update", "delete"]);
const SERVER_FILE_PATTERN = /\.(?:js|mjs|cjs|ts)$/u;
const MAX_UNROLLED_ELEMENTS = 64;
const MAX_ROUTER_HOPS = 4;

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
    await recordActionRouteScopes(inspection, { module, file });
    const featureFactories = importedNames(module, SOURCES.kernelFeatures, "defineFeature");
    for (const record of module.nodes.filter((entry) => isLocalCall(entry, featureFactories))) {
      await recordFeatureRoutes(inspection, { module, record });
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
  // Each route runs its operation's action, named as crud-core names it.
  for (const operation of new Set(operations)) {
    inspection.output.entryOperations.push({
      id: `entry:crud:${file}:${node.start}:${operation}`,
      key: crudOperationKey(inspection, surface.trim().toLowerCase(), resource.namespace, operation, apiSuffix),
      controllerFile: file,
      actionId: `crud.${resource.namespace}.${operation}`,
      resolution: "resolved",
      evidence: [...sourceEvidence(module, node, offset), ...resource.evidence]
    });
  }
  await recordCrudActionRoutes(inspection, { module, record, config, namespace: resource.namespace, apiSuffix });
}

// The routes of a CRUD declaration's custom actions: each `actions` entry with
// a `route`, at the declaration's API base path plus the route's path, running
// the entry's action. The actions object may be bound locally or imported
// through named re-exports.
async function recordCrudActionRoutes(inspection, { module, record, config, namespace, apiSuffix }) {
  const actions = objectProperty(config, "actions");
  if (!actions) {
    return;
  }
  const scope = bindingNode(objectProperty(config, "scope"), module.bindings);
  const routeBase = scope ? staticValue(objectProperty(scope, "routeBase"), module.bindings) ?? "/" : "/";
  const owner = await objectDeclaration(inspection, module, actions);
  if (!owner || typeof routeBase !== "string") {
    warn(inspection, "CRUD_ACTION_ROUTE_UNRESOLVED", "A CRUD declaration's actions need a literal object and scope routeBase.", module.path);
    return;
  }
  const basePath = resolveScopedApiBasePath({ routeBase: routeBase.trim() || "/", relativePath: apiSuffix, strictParams: false });
  const { bindings } = owner.module;
  for (const property of owner.node.properties) {
    const definition = isStaticObjectProperty(property) ? bindingNode(property.value, bindings) : null;
    const route = bindingNode(objectProperty(definition, "route"), bindings);
    if (definition?.type === "ObjectExpression" && !route) {
      continue;
    }
    const name = definition && propertyKey(property);
    const method = staticValue(objectProperty(route, "method"), bindings) ?? "POST";
    const routePath = staticValue(objectProperty(route, "path"), bindings);
    const declaredId = objectProperty(definition, "id") ? staticValue(objectProperty(definition, "id"), bindings) : "";
    const id = typeof declaredId === "string" ? declaredId.trim() || `crud.${namespace}.${name}` : null;
    if (route?.type !== "ObjectExpression" || typeof method !== "string" || !/^\s*[A-Za-z]+\s*$/u.test(method) ||
      typeof routePath !== "string" || !routePath.trim().startsWith("/") || !id) {
      warn(inspection, "CRUD_ACTION_ROUTE_UNRESOLVED", "A CRUD custom action route needs a literal method, path and action id.", owner.module.path);
      continue;
    }
    inspection.output.entryOperations.push({
      id: `entry:crud:${module.path}:${record.node.start}:action:${name}`,
      key: { protocol: "http", scope: inspection.httpScope, method: method.trim().toUpperCase(), operation: `${basePath}${routePath.trim()}` },
      controllerFile: owner.module.path,
      actionId: id,
      resolution: "resolved",
      evidence: [...sourceEvidence(module, record.node, record.offset), ...sourceEvidence(owner.module, definition)]
    });
  }
}

// The object literal an expression names, through local bindings, imports and
// named re-exports: { module, node }, or null.
async function objectDeclaration(inspection, module, node, seen = new Set()) {
  const value = bindingNode(node, module.bindings);
  if (value?.type === "ObjectExpression") {
    return hasOnlyStaticProperties(value) ? { module, node: value } : null;
  }
  const imported = value?.type === "Identifier" && module.imports.get(value.name);
  return imported ? exportedObjectDeclaration(inspection, module, imported.source, imported.imported, seen) : null;
}

async function exportedObjectDeclaration(inspection, module, source, name, seen) {
  const target = resolveImport(inspection, module.path, source);
  const owner = target && await loadModule(inspection, target);
  const entry = owner?.exports.get(name);
  const identity = `${owner?.path}:export:${name}`;
  if (!entry || seen.has(identity) || seen.size >= MAX_RESOURCE_HOPS) {
    return null;
  }
  const next = new Set([...seen, identity]);
  return entry.source
    ? exportedObjectDeclaration(inspection, owner, entry.source, entry.local, next)
    : objectDeclaration(inspection, owner, { type: "Identifier", name: entry.local }, next);
}

// Routes registered with `router.register(method, path, options, handler)` on
// the HTTP router a `defineFeature` setup receives: `http.router` of its
// destructured `http` dependency, or `dependencies.http.router`. The setup
// may register there or pass the router to project functions (local, or
// imported through named imports and re-exports, at most four calls deep)
// that register on the parameter receiving it.
async function recordFeatureRoutes(inspection, { module, record }) {
  const definition = bindingNode(record.node.arguments[0], module.bindings);
  const setup = definition?.type === "ObjectExpression" ? featureSetup(module, definition) : null;
  const router = setup && setupRouter(setup);
  if (router) {
    await recordRouterRoutes(inspection, { module, fn: setup, router, depth: 0, seen: new Set() });
  }
}

function featureSetup(module, definition) {
  const member = definition.properties.find((entry) =>
    ["ObjectMethod", "ObjectProperty"].includes(entry.type) && !entry.computed && propertyKey(entry) === "setup");
  if (member?.type === "ObjectMethod") {
    return member;
  }
  const value = member?.value.type === "Identifier" ? localFunction(module, member.value.name) : member?.value;
  return value && isFunctionNode(value) ? value : null;
}

function isNamedMember(node, name) {
  return node?.type === "MemberExpression" && !node.computed && node.property.type === "Identifier" && node.property.name === name;
}

// How a setup names its HTTP router, from its first parameter.
function setupRouter(setup) {
  const parameter = setup.params[0];
  if (parameter?.type === "Identifier") {
    const { name } = parameter;
    return {
      name,
      matches: (node) => isNamedMember(node, "router") && isNamedMember(node.object, "http") &&
        node.object.object.type === "Identifier" && node.object.object.name === name
    };
  }
  const dependency = parameter?.type === "ObjectPattern" &&
    parameter.properties.find((entry) => entry.type === "ObjectProperty" && !entry.computed && propertyKey(entry) === "http");
  if (dependency?.value?.type !== "Identifier") {
    return null;
  }
  const { name } = dependency.value;
  return {
    name,
    matches: (node) => isNamedMember(node, "router") && node.object.type === "Identifier" && node.object.name === name
  };
}

function parameterRouter(parameter) {
  const name = parameter?.type === "AssignmentPattern" ? parameter.left.name : parameter?.name;
  return parameter && [parameter.type, parameter.left?.type].includes("Identifier") && name
    ? { name, matches: (node) => node.type === "Identifier" && node.name === name }
    : null;
}

// Whether a node lies inside `fn`, with no function in between binding `name`.
function bindsWithin(record, fn, name) {
  for (let current = record.parent; current; current = current.parent) {
    if (current.node === fn) {
      return true;
    }
    if (current.node.params?.some((parameter) => collectNodes(parameter).some(({ node }) => node.type === "Identifier" && node.name === name))) {
      return false;
    }
  }
  return false;
}

async function recordRouterRoutes(inspection, { module, fn, router, depth, seen }) {
  const identity = `${module.path}:${fn.start}:${router.name}`;
  if (seen.has(identity)) {
    return;
  }
  seen.add(identity);
  const calls = module.nodes
    .filter((record) => record.node.type === "CallExpression" && bindsWithin(record, fn, router.name))
    .sort((left, right) => left.node.start - right.node.start);
  for (const record of calls) {
    const { callee, arguments: args } = record.node;
    if (isNamedMember(callee, "register") && router.matches(callee.object)) {
      recordRouterRoute(inspection, module, record);
      continue;
    }
    const position = args.findIndex((argument) => router.matches(argument));
    const target = position >= 0 && depth < MAX_ROUTER_HOPS && callee.type === "Identifier"
      ? await projectFunction(inspection, module, callee.name)
      : null;
    const next = target && parameterRouter(target.fn.params[position]);
    if (next) {
      await recordRouterRoutes(inspection, { module: target.module, fn: target.fn, router: next, depth: depth + 1, seen });
    }
  }
}

function recordRouterRoute(inspection, module, record) {
  const { node, offset } = record;
  const identity = `${module.path}:${offset + node.start}`;
  if (inspection.routeRegistrations.has(identity)) {
    return;
  }
  inspection.routeRegistrations.add(identity);
  const method = routeLiteral(module, node.arguments[0]);
  const operation = routeLiteral(module, node.arguments[1]);
  const handler = node.arguments[3];
  if (typeof method !== "string" || !/^[A-Za-z]+$/u.test(method) || typeof operation !== "string" || !handler || !isFunctionNode(handler)) {
    warn(inspection, "CONTROLLER_UNRESOLVED", "A route's application handler or identity is dynamic.", module.path);
    return;
  }
  const entry = {
    id: `entry:${inspection.httpScope}:${module.path}:${node.start}`,
    key: { protocol: "http", scope: inspection.httpScope, method: method.toUpperCase(), operation: `${inspection.apiBasePath}${operation}` },
    controllerFile: module.path,
    resolution: "resolved",
    evidence: sourceEvidence(module, node, offset)
  };
  inspection.output.entryOperations.push(entry);
  inspection.handlerRanges.set(entry, { file: module.path, start: offset + handler.start, end: offset + handler.end });
}

// A route method or path, as staticValue reads it, where a call of the
// kernel's resolveScopedApiBasePath with literal options (directly, through a
// local binding or inside a template literal) stands for the path it returns.
function routeLiteral(module, node, seen = new Set()) {
  if (node?.type === "Identifier" && module.bindings.has(node.name) && !seen.has(node.name)) {
    return routeLiteral(module, module.bindings.get(node.name), new Set([...seen, node.name]));
  }
  if (node?.type === "TemplateLiteral") {
    const parts = node.expressions.map((entry) => routeLiteral(module, entry, seen));
    return parts.every((part) => typeof part === "string")
      ? node.quasis.map((entry, index) => entry.value.cooked + (parts[index] ?? "")).join("")
      : undefined;
  }
  if (node?.type === "CallExpression" && node.callee.type === "Identifier" &&
    module.imports.get(node.callee.name)?.source.startsWith("@jskit-ai/kernel/") &&
    module.imports.get(node.callee.name).imported === "resolveScopedApiBasePath") {
    const options = staticValue(node.arguments[0], module.bindings);
    if (!options || typeof options !== "object" || Array.isArray(options) || "params" in options) {
      return undefined;
    }
    try {
      return resolveScopedApiBasePath(options);
    } catch {
      return undefined;
    }
  }
  return staticValue(node, module.bindings, seen);
}

// The project function a name refers to in a module: a top-level function
// declaration or a function bound to the name, or one imported through named
// imports and re-exports of indexed files.
async function projectFunction(inspection, module, name, seen = new Set()) {
  const identity = `${module.path}:${name}`;
  if (seen.has(identity) || seen.size >= MAX_RESOURCE_HOPS) {
    return null;
  }
  const next = new Set([...seen, identity]);
  const imported = module.imports.get(name);
  if (!imported) {
    const fn = localFunction(module, name);
    return fn ? { module, fn } : null;
  }
  return exportedFunction(inspection, module, imported.source, imported.imported, next);
}

async function exportedFunction(inspection, module, source, name, seen) {
  const target = resolveImport(inspection, module.path, source);
  const owner = target && await loadModule(inspection, target);
  const entry = owner?.exports.get(name);
  const identity = `${owner?.path}:export:${name}`;
  if (!entry || seen.has(identity) || seen.size >= MAX_RESOURCE_HOPS) {
    return null;
  }
  const next = new Set([...seen, identity]);
  return entry.source
    ? exportedFunction(inspection, owner, entry.source, entry.local, next)
    : projectFunction(inspection, owner, entry.local, next);
}

function localFunction(module, name) {
  const declaration = module.nodes.find(({ node, parent }) => node.type === "FunctionDeclaration" && node.id?.name === name &&
    ["Program", "ExportNamedDeclaration"].includes(parent?.node.type));
  if (declaration) {
    return declaration.node;
  }
  const value = module.bindings.get(name);
  return value && isFunctionNode(value) ? value : null;
}

// The literal value of a scope option: a string literal, or a local or
// imported const string literal. Undefined otherwise.
async function scopeOption(inspection, module, node, fallback) {
  if (!node) {
    return fallback;
  }
  if (node.type === "StringLiteral" || (node.type === "TemplateLiteral" && !node.expressions.length)) {
    return staticValue(node, module.bindings);
  }
  if (node.type !== "Identifier") {
    return undefined;
  }
  if (module.imports.has(node.name)) {
    return importedConstant(inspection, module, node.name, new Set());
  }
  const value = module.constants.has(node.name) ? staticValue(module.bindings.get(node.name), module.bindings) : undefined;
  return typeof value === "string" ? value : undefined;
}

async function importedConstant(inspection, module, name, seen) {
  const imported = module.imports.get(name);
  const target = imported && resolveImport(inspection, module.path, imported.source);
  const owner = target && await loadModule(inspection, target);
  return owner ? exportedConstant(inspection, owner, imported.imported, seen) : undefined;
}

async function exportedConstant(inspection, module, name, seen) {
  const identity = `${module.path}:${name}`;
  const entry = module.exports.get(name);
  if (!entry || seen.has(identity) || seen.size >= MAX_RESOURCE_HOPS) {
    return undefined;
  }
  const next = new Set([...seen, identity]);
  if (entry.source) {
    const target = resolveImport(inspection, module.path, entry.source);
    const owner = target && await loadModule(inspection, target);
    return owner ? exportedConstant(inspection, owner, entry.local, next) : undefined;
  }
  if (module.imports.has(entry.local)) {
    return importedConstant(inspection, module, entry.local, next);
  }
  const value = module.constants.has(entry.local) ? staticValue(module.bindings.get(entry.local), module.bindings) : undefined;
  return typeof value === "string" ? value : undefined;
}

// The scope's API base path, computed exactly as createActionRouteScope does;
// null when an option is not a literal.
async function actionRouteScopeBase(inspection, module, node) {
  const options = bindingNode(node.arguments[1], module.bindings);
  if (options && (options.type !== "ObjectExpression" || options.properties.some((entry) => entry.type === "SpreadElement"))) {
    return null;
  }
  const routeBase = await scopeOption(inspection, module, objectProperty(options, "routeBase"), "/");
  const relativePath = await scopeOption(inspection, module, objectProperty(options, "relativePath"), "");
  const surface = await scopeOption(inspection, module, objectProperty(options, "surface"), "");
  const strictParams = staticValue(objectProperty(options, "strictParams"), module.bindings) ?? false;
  if (typeof routeBase !== "string" || typeof relativePath !== "string" || typeof surface !== "string" || typeof strictParams !== "boolean") {
    return null;
  }
  try {
    return resolveScopedApiBasePath({ routeBase, relativePath, strictParams });
  } catch {
    return null;
  }
}

// The names a scope's route registrations are called through: the variable
// holding the scope, or destructured actionRoute / serviceRoute functions.
function scopeReceivers(record) {
  const declarator = record.ancestors.at(-1);
  if (declarator?.type !== "VariableDeclarator" || declarator.init !== record.node) {
    return null;
  }
  const owner = record.ancestors.slice().reverse().find((node) => isFunctionNode(node) || node.type === "Program");
  if (declarator.id.type === "Identifier") {
    return { owner, object: declarator.id.name, functions: new Map() };
  }
  if (declarator.id.type !== "ObjectPattern") {
    return null;
  }
  const functions = new Map();
  for (const entry of declarator.id.properties) {
    if (entry.type === "ObjectProperty" && entry.value.type === "Identifier" && ["actionRoute", "serviceRoute"].includes(propertyKey(entry))) {
      functions.set(entry.value.name, propertyKey(entry));
    }
  }
  return { owner, object: null, functions };
}

function routeRegistrationKind({ node, ancestors }, receivers) {
  if (node.type !== "CallExpression" || !ancestors.includes(receivers.owner)) {
    return "";
  }
  const callee = node.callee;
  if (callee.type === "Identifier") {
    return receivers.functions.get(callee.name) || "";
  }
  const named = callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier" &&
    callee.object.name === receivers.object;
  return named && ["actionRoute", "serviceRoute"].includes(callee.property.name) ? callee.property.name : "";
}

function bindPattern(pattern, value, environment) {
  if (!pattern) {
    return;
  }
  if (pattern.type === "Identifier") {
    environment.set(pattern.name, value);
  } else if (pattern.type === "ArrayPattern") {
    pattern.elements.forEach((element, index) => bindPattern(element, Array.isArray(value) ? value[index] : undefined, environment));
  } else if (pattern.type === "ObjectPattern") {
    for (const entry of pattern.properties) {
      if (entry.type === "ObjectProperty" && !entry.computed) {
        bindPattern(entry.value, value && typeof value === "object" ? value[propertyKey(entry)] : undefined, environment);
      }
    }
  } else if (pattern.type === "AssignmentPattern") {
    bindPattern(pattern.left, value, environment);
  }
}

// One environment per element of each enclosing `for...of` or `.map` over a
// literal array of at most 64 elements; null beyond that bound.
function unrolledEnvironments(module, { node, ancestors }) {
  let environments = [new Map()];
  const chain = [...ancestors, node];
  chain.forEach((current, index) => {
    let pattern;
    let source;
    if (current.type === "ForOfStatement" && chain.includes(current.body) && current.left.type === "VariableDeclaration") {
      pattern = current.left.declarations[0]?.id;
      source = current.right;
    }
    const call = chain[index - 1];
    if (isFunctionNode(current) && call?.type === "CallExpression" && call.arguments[0] === current &&
      call.callee.type === "MemberExpression" && !call.callee.computed && call.callee.property.name === "map") {
      pattern = current.params[0];
      source = call.callee.object;
    }
    const elements = source && staticValue(source, module.bindings);
    if (!pattern || !Array.isArray(elements) || elements.length > MAX_UNROLLED_ELEMENTS) {
      return;
    }
    environments = environments.flatMap((environment) => elements.map((element) => {
      const next = new Map(environment);
      bindPattern(pattern, element, next);
      return next;
    }));
  });
  return environments.length <= MAX_UNROLLED_ELEMENTS ? environments : null;
}

// Routes registered through the kernel's createActionRouteScope. Scope
// options must be literals or const string literals; each route's method,
// suffix and actionId literals, templates or literal-array elements.
async function recordActionRouteScopes(inspection, { module, file }) {
  const factories = importedNames(module, SOURCES.kernelHttp, "createActionRouteScope");
  if (!factories.size) {
    return;
  }
  for (const record of module.nodes.filter((entry) => isLocalCall(entry, factories))) {
    const receivers = scopeReceivers(record);
    if (!receivers) {
      warn(inspection, "ACTION_ROUTE_SCOPE_UNBOUND", "An action route scope must be held in a local variable or destructured.", file);
      continue;
    }
    const routeBase = await actionRouteScopeBase(inspection, module, record.node);
    for (const registration of module.nodes) {
      const kind = routeRegistrationKind(registration, receivers);
      if (!kind) {
        continue;
      }
      if (routeBase === null) {
        warn(inspection, "ACTION_ROUTE_UNRESOLVED", "An action route scope needs literal routeBase, relativePath and surface options.", file);
        continue;
      }
      recordScopedRoute(inspection, { module, file, routeBase, registration, kind });
    }
  }
}

function recordScopedRoute(inspection, { module, file, routeBase, registration, kind }) {
  const { node, offset } = registration;
  const environments = unrolledEnvironments(module, registration);
  const [methodNode, suffixNode, optionsNode, handler] = node.arguments;
  const options = bindingNode(optionsNode, module.bindings);
  (environments || [null]).forEach((environment, index) => {
    const method = environment && staticValue(methodNode, module.bindings, new Set(), environment);
    const suffix = environment && staticValue(suffixNode, module.bindings, new Set(), environment);
    const actionId = kind === "actionRoute" && environment
      ? staticValue(objectProperty(options, "actionId"), module.bindings, new Set(), environment)
      : "";
    const literalAction = kind !== "actionRoute" || (typeof actionId === "string" && Boolean(actionId.trim()));
    if (typeof method !== "string" || !/^[A-Za-z]+$/u.test(method) || typeof suffix !== "string" || !literalAction) {
      warn(inspection, "ACTION_ROUTE_UNRESOLVED", "A route's method, path suffix or actionId is not a literal or literal-array element.", file);
      return;
    }
    const entry = {
      id: `entry:${inspection.httpScope}:${file}:${offset + node.start}${environments.length > 1 ? `:${index}` : ""}`,
      key: {
        protocol: "http",
        scope: inspection.httpScope,
        method: method.toUpperCase(),
        operation: `${routeBase}${suffix}`.replace(/\/+/gu, "/").replace(/(.)\/$/u, "$1")
      },
      controllerFile: file,
      ...(kind === "actionRoute" ? { actionId: actionId.trim() } : {}),
      resolution: "resolved",
      evidence: sourceEvidence(module, node, offset)
    };
    inspection.output.entryOperations.push(entry);
    if (handler && isFunctionNode(handler)) {
      inspection.handlerRanges.set(entry, { file, start: offset + handler.start, end: offset + handler.end });
    }
  });
}

export {
  discoverEntryOperations
};
