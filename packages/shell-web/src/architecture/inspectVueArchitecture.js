import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseJavaScript } from "@babel/parser";
import { parse as parseSfc } from "@vue/compiler-sfc";
import { createRoutesContext, resolveOptions } from "vue-router/unplugin";

const hash = source => `sha256:${createHash("sha256").update(source).digest("hex")}`;
const canonical = value => typeof value === "string" && value.length > 0 && value !== "." && !/[\\\0]/u.test(value) && !path.posix.isAbsolute(value) && path.posix.normalize(value) === value && !value.split("/").includes("..");
const property = (node, key) => node?.type === "ObjectExpression" ? node.properties.find(entry => entry.type === "ObjectProperty" && !entry.computed && (entry.key.name || entry.key.value) === key)?.value : undefined;

function nodes(root) {
  const result = []; const pending = [{ node: root, ancestors: [] }];
  while (pending.length) {
    const current = pending.pop(); const { node, ancestors } = current;
    if (!node || typeof node.type !== "string") continue;
    result.push(current);
    for (const value of Object.values(node)) {
      const children = Array.isArray(value) ? value : value?.type ? [value] : [];
      for (const child of children) if (child?.type) pending.push({ node: child, ancestors: [...ancestors, node] });
    }
  }
  return result;
}

function staticValue(node, bindings, seen = new Set()) {
  if (!node) return undefined;
  if (["StringLiteral", "BooleanLiteral", "NumericLiteral"].includes(node.type)) return node.value;
  if (node.type === "NullLiteral") return null;
  if (node.type === "Identifier" && !seen.has(node.name)) return staticValue(bindings.get(node.name), bindings, new Set([...seen, node.name]));
  if (node.type === "ArrayExpression") {
    const values = node.elements.map(entry => staticValue(entry, bindings, seen));
    return values.every(value => value !== undefined) ? values : undefined;
  }
  if (node.type === "ObjectExpression") {
    const result = {};
    for (const entry of node.properties) {
      if (entry.type !== "ObjectProperty" || entry.computed) return undefined;
      const key = entry.key.name || entry.key.value; const value = staticValue(entry.value, bindings, seen);
      if (value === undefined) return undefined; result[key] = value;
    }
    return result;
  }
  if (node.type === "TemplateLiteral") {
    const values = node.expressions.map(entry => staticValue(entry, bindings, seen));
    if (values.some(value => typeof value !== "string")) return undefined;
    return node.quasis.map((entry, index) => entry.value.cooked + (values[index] || "")).join("");
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticValue(node.left, bindings, seen); const right = staticValue(node.right, bindings, seen);
    return typeof left === "string" && typeof right === "string" ? left + right : undefined;
  }
  return undefined;
}

function bindingNode(node, bindings, seen = new Set()) {
  if (node?.type !== "Identifier" || seen.has(node.name) || !bindings.has(node.name)) return node;
  return bindingNode(bindings.get(node.name), bindings, new Set([...seen, node.name]));
}

// Standalone, finite static inspection. No application import, watcher, server,
// Genesis dependency or runtime interpretation is needed to emit neutral JSON.
export async function inspectVueArchitecture({ projectRoot, input, aliases = {}, httpScope = "", apiBasePath = "" }) {
  if (!path.isAbsolute(projectRoot || "") || input?.schema !== "vibe64.architecture-inspection-input.v1" || !Array.isArray(input.files)) throw new TypeError("An absolute project root and architecture inspection input are required.");
  const files = new Map();
  for (const file of input.files) {
    if (!canonical(file.path) || typeof file.hash !== "string" || files.has(file.path)) throw new TypeError("Invalid indexed input file.");
    files.set(file.path, file);
  }
  for (const value of Object.values(aliases)) if (value !== "." && !canonical(value)) throw new TypeError("Aliases must resolve within the project.");
  const output = { schema: "genesis.architecture-observations.v1", adapter: "jskit.vue-static.v1", inputs: [], capabilities: { pages: "unconfigured", components: "partial", imports: "partial", entryOperations: httpScope ? "partial" : "unconfigured", operationUses: httpScope ? "partial" : "unconfigured" }, pages: [], registrations: [], components: [], componentUses: [], entryOperations: [], operationUses: [], imports: [], diagnostics: [] };
  const modules = new Map(); const components = new Map(); const pages = new Map();
  const packages = input.packages || [];
  if (!Array.isArray(packages) || packages.some(entry => typeof entry.id !== 'string' || typeof entry.name !== 'string' || !canonical(entry.manifest) || !Array.isArray(entry.entryPoints))) throw new TypeError('Invalid package boundary input.');
  if (input.packageIdentity) output.packageIdentity = input.packageIdentity;
  function warn(code, message, source) { output.diagnostics.push({ code, message, ...(source ? { path: source } : {}) }); }
  async function load(filePath) {
    if (modules.has(filePath)) return modules.get(filePath);
    if (!files.has(filePath)) return null;
    for (const directory of filePath.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"))) if ((await lstat(path.join(projectRoot, directory))).isSymbolicLink()) throw new Error("Architecture inspection cannot follow symbolic links.");
    const bytes = await readFile(path.join(projectRoot, filePath));
    if (bytes.length > 4 * 1024 * 1024 || hash(bytes) !== files.get(filePath).hash) throw new Error(`Source changed or exceeded inspection bounds: ${filePath}`);
    // Asset imports need current input evidence, but no JavaScript/Vue parsing.
    if (!/\.(?:[cm]?js|jsx|tsx?|vue)$/u.test(filePath)) {
      modules.set(filePath, null);
      output.inputs.push({ path: filePath, hash: hash(bytes) });
      return null;
    }
    const source = bytes.toString("utf8");
    if (!Buffer.from(source).equals(bytes)) throw new Error(`Source is not UTF-8: ${filePath}`);
    const module = { path: filePath, source, hash: hash(bytes), bindings: new Map(), imports: new Map(), nodes: [], exports: new Map(), descriptor: null };
    modules.set(filePath, module); output.inputs.push({ path: filePath, hash: module.hash });
    const units = [];
    if (filePath.endsWith(".vue")) {
      const parsed = parseSfc(source, { filename: filePath });
      if (parsed.errors.length) { warn("VUE_PARSE_FAILED", "The component could not be parsed completely.", filePath); return module; }
      module.descriptor = parsed.descriptor;
      for (const script of [parsed.descriptor.script, parsed.descriptor.scriptSetup].filter(Boolean)) {
        if (script.src) { warn("VUE_EXTERNAL_SCRIPT", "External component scripts need another inspection adapter.", filePath); continue; }
        units.push({ source: script.content, offset: script.loc.start.offset, setup: script === parsed.descriptor.scriptSetup });
      }
    } else units.push({ source, offset: 0, setup: false });
    for (const unit of units) {
      try {
        const ast = parseJavaScript(unit.source, { sourceType: "unambiguous", plugins: ["typescript", "jsx"], createImportExpressions: true });
        const records = nodes(ast);
        module.nodes.push(...records.map(record => ({ ...record, offset: unit.offset, setup: unit.setup })));
        for (const { node } of records) {
          if (node.type === "VariableDeclarator" && node.id.type === "Identifier") module.bindings.set(node.id.name, module.bindings.has(node.id.name) ? undefined : node.init);
          if (node.type === "ExportNamedDeclaration") {
            for (const specifier of node.specifiers) if (specifier.type === "ExportSpecifier") module.exports.set(specifier.exported.name || specifier.exported.value, { local: specifier.local.name || specifier.local.value, source: node.source?.value });
            const declaration = node.declaration;
            if (declaration?.type === "VariableDeclaration") for (const entry of declaration.declarations) if (entry.id.type === "Identifier") module.exports.set(entry.id.name, { local: entry.id.name });
          }
          if (node.type === "ImportDeclaration") for (const specifier of node.specifiers) module.imports.set(specifier.local.name, { source: node.source.value, imported: specifier.imported?.name || "default", node });
        }
      } catch { warn("JAVASCRIPT_PARSE_FAILED", "A script needs unsupported syntax or could not be parsed.", filePath); }
    }
    return module;
  }
  function resolve(from, specifier) {
    if (typeof specifier !== "string") return null;
    let base;
    if (specifier.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    else if (specifier.startsWith("/")) base = specifier.slice(1);
    else {
      const alias = Object.keys(aliases).sort((a, b) => b.length - a.length).find(key => specifier === key || specifier.startsWith(key + "/"));
      if (alias) base = path.posix.join(aliases[alias], specifier.slice(alias.length));
    }
    if (!base) {
      const dependency = packageImport(from, specifier);
      if (dependency && !dependency.record.opaque) {
        const candidates = [...new Set(dependency.record.entryPoints.filter(entry => entry.importPath === dependency.importPath && files.has(entry.file)).map(entry => entry.file))];
        if (candidates.length === 1) return candidates[0];
      }
    }
    if (!canonical(base)) return null;
    return [base, ...[".vue", ".js", ".ts", "/index.js", "/index.ts"].map(extension => base + extension)].find(candidate => files.has(candidate)) || null;
  }
  function packageImport(from, specifier) {
    if (typeof specifier !== 'string' || specifier.startsWith('.') || specifier.startsWith('/')) return null;
    const candidates = packages.flatMap(entry => (entry.declarations || [{ manifest: entry.manifest }]).filter(declaration => {
      const parent = path.posix.dirname(declaration.manifest);
      return (parent === '.' || from.startsWith(`${parent}/`)) && (specifier === entry.name || specifier.startsWith(`${entry.name}/`));
    }).map(declaration => ({ record: entry, manifest: declaration.manifest }))).sort((a, b) => b.manifest.length - a.manifest.length);
    const record = candidates[0]?.record;
    if (!record) return null;
    return { record, importPath: specifier === record.name ? '.' : `.${specifier.slice(record.name.length)}` };
  }
  async function crudResource(module, node, seen = new Set()) {
    if (!node || seen.size >= 64) return null;
    if (node.type === "Identifier") {
      const identity = `${module.path}:${node.name}`;
      if (seen.has(identity)) return null;
      const next = new Set([...seen, identity]);
      const imported = module.imports.get(node.name);
      if (imported) {
        const target = resolve(module.path, imported.source); const owner = target && await load(target);
        return owner ? exportedResource(owner, imported.imported, next) : null;
      }
      return crudResource(module, module.bindings.get(node.name), next);
    }
    if (node.type !== "CallExpression" || node.callee.type !== "Identifier") return null;
    const factory = module.imports.get(node.callee.name);
    const record = module.nodes.find(entry => entry.node === node);
    if (factory?.source !== "@jskit-ai/resource-crud-core/shared/crudResource" || factory.imported !== "defineCrudResource" || !record || !unshadowed(record, node.callee.name)) return null;
    const config = bindingNode(node.arguments[0], module.bindings);
    if (config?.type !== "ObjectExpression" || config.properties.some(entry => entry.type !== "ObjectProperty" || entry.computed)) return null;
    const namespace = staticValue(property(config, "namespace"), module.bindings);
    const operations = property(config, "crudOperations");
    const names = operations ? staticValue(operations, module.bindings) : ["list", "view", "create", "patch", "delete"];
    if (typeof namespace !== "string" || !namespace.trim() || !Array.isArray(names) || !names.length || !names.every(name => ["list", "view", "create", "patch", "delete"].includes(name)) || property(config, "operations")) return null;
    return { namespace: namespace.trim(), operations: names, evidence: evidence(module, node, record.offset) };
  }
  async function exportedResource(module, name, seen) {
    const entry = module.exports.get(name);
    if (!entry) return null;
    if (!entry.source) return crudResource(module, { type: "Identifier", name: entry.local }, seen);
    const identity = `${module.path}:export:${name}`;
    if (seen.has(identity) || seen.size >= 64) return null;
    const target = resolve(module.path, entry.source); const owner = target && await load(target);
    return owner ? exportedResource(owner, entry.local, new Set([...seen, identity])) : null;
  }
  const crudKey = (surface, namespace, operation, apiSuffix) => ({ protocol: "jskit.crud", scope: JSON.stringify([httpScope, surface, apiSuffix]), operation: `${namespace}:${operation === "update" ? "patch" : operation}` });
  function evidence(module, node, offset = 0) {
    function point(index) { const before = module.source.slice(0, index); const lines = before.split("\n"); return { line: lines.length, column: lines.at(-1).length + 1 }; }
    return [{ path: module.path, hash: module.hash, start: point(offset + (node?.start || 0)), end: point(offset + (node?.end || Math.max(1, module.source.length - (module.source.endsWith("\n") ? 1 : 0)))) }];
  }
  async function page(file, discovery, identity, registrationModule, registrationNode, parentId = null) {
    const module = await load(file); if (!module) { warn("PAGE_SOURCE_UNAVAILABLE", "A registered page is outside the indexed project source.", file); return null; }
    const id = `page:${discovery.surface}:${file}`;
    if (!pages.has(id)) { const record = { id, title: path.posix.basename(file, path.posix.extname(file)) === "index" ? path.posix.basename(path.posix.dirname(file)) : path.posix.basename(file, path.posix.extname(file)), kind: "page", surface: discovery.surface, file, parentId, resolution: "resolved", evidence: evidence(module) }; pages.set(id, record); output.pages.push(record); }
    else if (pages.get(id).parentId !== parentId) { pages.get(id).parentId = null; warn("PAGE_MULTIPLE_PARENTS", "A shared page has multiple registration contexts; registrations retain their identities.", file); }
    output.registrations.push({ id: `registration:${discovery.id}:${output.registrations.length}`, pageId: id, surface: discovery.surface, identity, resolution: "resolved", evidence: evidence(registrationModule, registrationNode) });
    return id;
  }
  function unshadowed(record, name) {
    return !moduleBindingShadow(record, name);
  }
  function moduleBindingShadow({ ancestors }, name) {
    return ancestors.some(node => node.params?.some(parameter => nodes(parameter).some(({ node: binding }) => binding.type === "Identifier" && binding.name === name)));
  }
  const discoveries = input.uiDiscovery?.discoveries || [];
  let supported = 0;
  for (const discovery of discoveries) {
    if (!["jskit", "vue-filesystem-router", "vue-registered-router"].includes(discovery.adapter)) { warn("UI_ADAPTER_UNAVAILABLE", `No Vue inspector is available for ${discovery.adapter}.`); continue; }
    for (const registrationPath of discovery.registrations || []) {
      const module = await load(registrationPath); if (!module) { warn("REGISTRATION_UNAVAILABLE", "A routing input is not in the source inventory.", registrationPath); continue; }
      if (discovery.mode === "filesystem") {
        const imports = new Set([...module.imports].filter(([, entry]) => entry.source === "vue-router/vite" && entry.imported === "default").map(([name]) => name));
        const calls = module.nodes.filter(record => record.node.type === "CallExpression" && record.node.callee.type === "Identifier" && imports.has(record.node.callee.name) && unshadowed(record, record.node.callee.name));
        for (const { node } of calls) {
          const options = staticValue(node.arguments[0], module.bindings);
          if (!options || Object.keys(options).some(key => !["routesFolder", "extensions", "exclude", "dts", "nestedChildren"].includes(key)) || (typeof options.routesFolder !== "string" && !Array.isArray(options.routesFolder))) { warn("ROUTER_OPTIONS_UNSUPPORTED", "Filesystem routing needs literal supported options; runtime route extensions are not executed.", registrationPath); continue; }
          const folders = [options.routesFolder].flat();
          if (!folders.every(canonical)) { warn("ROUTER_ROOT_INVALID", "Router page roots must be inside the project.", registrationPath); continue; }
          let tree;
          const context = createRoutesContext(resolveOptions({ ...options, root: projectRoot, dts: false, logs: false, beforeWriteFiles: root => { tree = root; } }));
          try {
            await context.scanPages(false);
            const pending = [{ route: tree, parentId: null }];
            while (pending.length) {
              const { route, parentId } = pending.pop(); let owner = parentId;
              for (const [view, absolute] of route.components) {
                const file = path.relative(projectRoot, absolute).split(path.sep).join("/");
                const definition = await page(file, discovery, `${route.fullPath}${view === "default" ? "" : ` [${view}]`}`, module, node, parentId);
                if (view === "default" && definition) owner = definition;
              }
              for (const child of route.children) pending.push({ route: child, parentId: owner });
            }
            supported++;
          } finally { context.stopWatcher(); }
        }
      } else {
        const routers = new Set([...module.imports].filter(([, entry]) => entry.source === "vue-router" && entry.imported === "createRouter").map(([name]) => name));
        const calls = module.nodes.filter(record => record.node.type === "CallExpression" && record.node.callee.type === "Identifier" && routers.has(record.node.callee.name) && unshadowed(record, record.node.callee.name));
        for (const { node } of calls) {
          const routes = bindingNode(property(node.arguments[0], "routes"), module.bindings);
          if (routes?.type !== "ArrayExpression") { warn("ROUTES_DYNAMIC", "Registered routes need a literal route array or its local binding.", registrationPath); continue; }
          const pending = routes.elements.slice().reverse().map(route => ({ route, prefix: "", parentId: null }));
          while (pending.length) {
            const { route, prefix, parentId } = pending.pop();
            const routePath = staticValue(property(route, "path"), module.bindings);
            if (typeof routePath !== "string") { warn("ROUTE_DYNAMIC", "A route path or spread cannot be resolved statically.", registrationPath); continue; }
            const identity = routePath.startsWith("/") ? routePath : `${prefix}/${routePath}`.replace(/\/{2,}/gu, "/");
            const component = bindingNode(property(route, "component"), module.bindings);
            let specifier = component?.type === "Identifier" ? module.imports.get(component.name)?.source : null;
            if (component?.type === "ArrowFunctionExpression" && component.body.type === "ImportExpression") specifier = staticValue(component.body.source, module.bindings);
            const file = resolve(module.path, specifier); let owner = parentId;
            if (file) owner = await page(file, discovery, identity, module, route, parentId);
            else if (component) warn("PAGE_COMPONENT_UNRESOLVED", "A registered route component is dynamic or outside the indexed project.", registrationPath);
            const children = bindingNode(property(route, "children"), module.bindings);
            if (children?.type === "ArrayExpression") pending.push(...children.elements.slice().reverse().map(child => ({ route: child, prefix: identity, parentId: owner })));
            else if (children) warn("ROUTES_DYNAMIC", "Child route registration is dynamic.", registrationPath);
          }
          supported++;
        }
      }
    }
  }
  output.capabilities.pages = supported ? output.diagnostics.length ? "partial" : "complete" : discoveries.length ? "unsupported" : "unconfigured";
  const pendingComponents = output.pages.map(record => ({ file: record.file, parentId: record.id }));
  const inspected = new Set();
  while (pendingComponents.length) {
    const { file, parentId } = pendingComponents.pop(); const module = await load(file);
    if (!module?.descriptor?.template || inspected.has(parentId)) continue;
    inspected.add(parentId);
    const eventHandlers = new Set(); const tags = [];
    const templateNodes = [module.descriptor.template.ast];
    while (templateNodes.length) {
      const node = templateNodes.pop(); if (!node) continue;
      if (node.type === 1) {
        tags.push(node);
        for (const attribute of node.props || []) if (attribute.type === 7 && attribute.name === "on" && /^[A-Za-z_$][\w$]*$/u.test(attribute.exp?.content || "")) eventHandlers.add(attribute.exp.content);
      }
      templateNodes.push(...(node.children || []));
    }
    for (const tag of tags) {
      const local = [...module.imports.keys()].find(name => name === tag.tag || name.replace(/[A-Z]/gu, (letter, index) => `${index ? "-" : ""}${letter.toLowerCase()}`) === tag.tag);
      if (!local && !/^[A-Z]|-/u.test(tag.tag) && tag.tag !== "component") continue;
      if (!local && tag.tag.startsWith("v-")) continue;
      const imported = module.imports.get(local);
      const target = resolve(file, imported?.source);
      let definition;
      if (target) {
        const targetModule = await load(target); const id = `component:${target}`;
        if (!targetModule) { warn("COMPONENT_SOURCE_UNSUPPORTED", "An imported asset needs its own component adapter.", target); continue; }
        if (!components.has(id)) { definition = { id, title: path.posix.basename(target, path.posix.extname(target)), file: target, resolution: "resolved", evidence: evidence(targetModule) }; components.set(id, definition); output.components.push(definition); }
        definition = components.get(id); pendingComponents.push({ file: target, parentId: id });
      } else if (imported) {
        const dependency = packageImport(file, imported.source);
        if (dependency && input.packageIdentity) {
          const id = `component:package:${JSON.stringify([dependency.record.id, dependency.importPath, imported.imported])}`;
          if (!components.has(id)) {
            definition = { id, title: imported.imported === 'default' ? tag.tag : imported.imported, file: null, origin: { kind: 'package', packageId: dependency.record.id, importPath: dependency.importPath, symbol: imported.imported }, resolution: 'resolved', evidence: evidence(module, imported.node, module.nodes.find(record => record.node === imported.node)?.offset || 0) };
            components.set(id, definition); output.components.push(definition);
          }
          definition = components.get(id);
        }
      }
      const range = { start: tag.loc.start.offset, end: tag.loc.end.offset };
      output.componentUses.push({ id: `component-use:${parentId}:${tag.loc.start.offset}`, parentId, ...(definition ? { componentId: definition.id } : {}), title: tag.tag, resolution: definition ? "resolved" : "unresolved", evidence: evidence(module, range) });
    }
    if (httpScope && pages.has(parentId)) for (const tag of tags) {
      const local = [...module.imports.keys()].find(name => name === tag.tag || name.replace(/[A-Z]/gu, (letter, index) => `${index ? "-" : ""}${letter.toLowerCase()}`) === tag.tag);
      const component = module.imports.get(local);
      const list = component?.source === "@jskit-ai/http-web/client/components/CrudListScreen" && ["default", "CrudListScreen"].includes(component.imported);
      const edit = component?.source === "@jskit-ai/http-web/client/components/CrudAddEditScreen" && ["default", "CrudAddEditScreen"].includes(component.imported);
      if (!list && !edit) continue;
      const screen = tag.props?.find(entry => entry.type === 7 && entry.name === "bind" && entry.arg?.content === "screen")?.exp?.content;
      const call = /^[A-Za-z_$][\w$]*$/u.test(screen || "") && bindingNode(module.bindings.get(screen), module.bindings);
      const helper = call?.type === "CallExpression" && call.callee.type === "Identifier" && module.imports.get(call.callee.name);
      const expected = list ? "useCrudListScreen" : "useCrudAddEditScreen";
      const record = call && module.nodes.find(entry => entry.node === call);
      if (!helper || helper.source !== `@jskit-ai/http-web/client/composables/${expected}` || helper.imported !== expected || !record?.setup || record.ancestors.some(entry => /Function/u.test(entry.type)) || !unshadowed(record, call.callee.name)) continue;
      const config = bindingNode(call.arguments[0], module.bindings);
      const resource = await crudResource(module, property(config, "resource"));
      const operation = list ? "list" : staticValue(property(config, "operationName"), module.bindings);
      const dynamicTransport = ["screen", "adapter", "client", "surfaceId", "transport"].some(key => property(config, key) && staticValue(property(config, key), module.bindings) !== null) || config?.properties.some(entry => entry.type !== "ObjectProperty" || entry.computed);
      const options = bindingNode(property(config, list ? "listOptions" : "addEditOptions"), module.bindings);
      const customClient = options && (options.type !== "ObjectExpression" || options.properties.some(entry => entry.type !== "ObjectProperty" || entry.computed || ["client", "adapter", "surfaceId", "transport", "resource"].includes(entry.key.name || entry.key.value)));
      const apiSuffix = staticValue(property(list ? config : options, "apiSuffix"), module.bindings);
      const enabled = property(config, "readEnabled");
      if (list && enabled && staticValue(enabled, module.bindings) === false) continue;
      const resolved = resource && resource.operations.includes(operation) && typeof apiSuffix === "string" && apiSuffix.startsWith("/") && !apiSuffix.includes("?") && !dynamicTransport && !customClient && (!enabled || staticValue(enabled, module.bindings) === true);
      if (!resolved) warn("CRUD_SCREEN_UNRESOLVED", "A used CRUD screen has dynamic resource, operation or transport configuration.", file);
      output.operationUses.push({ id: `operation-use:${parentId}:crud:${tag.loc.start.offset}`, parentId, resolution: resolved ? "resolved" : "unresolved", ...(resolved ? { key: crudKey(pages.get(parentId).surface, resource.namespace, operation, apiSuffix) } : {}), evidence: [...evidence(module, call, record.offset), ...(resource?.evidence || [])] });
    }
    if (!httpScope) continue;
    for (const { node, ancestors, offset, setup } of module.nodes) {
      if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || node.callee.name !== "fetch" || module.bindings.has("fetch") || module.imports.has("fetch") || moduleBindingShadow({ ancestors }, "fetch")) continue;
      const enclosingFunction = ancestors.slice().reverse().find(entry => /Function/u.test(entry.type));
      const declaration = enclosingFunction?.id?.name || ancestors.slice().reverse().find(entry => entry.type === "VariableDeclarator")?.id?.name;
      if (enclosingFunction ? !eventHandlers.has(declaration) : !setup) continue;
      const operation = staticValue(node.arguments[0], module.bindings);
      const method = staticValue(property(node.arguments[1], "method"), module.bindings) || "GET";
      const resolved = typeof operation === "string" && operation.startsWith("/") && !operation.includes("?") && typeof method === "string";
      output.operationUses.push({ id: `operation-use:${parentId}:${offset + node.start}`, parentId, resolution: resolved ? "resolved" : "unresolved", ...(resolved ? { key: { protocol: "http", scope: httpScope, method: method.toUpperCase(), operation } } : {}), evidence: evidence(module, node, offset) });
    }
  }
  // Inspect the actual low-level JSKIT HTTP capability in a defineFeature setup.
  // App-owned wrappers/dispatchers require their own inspector rather than a
  // guessed match based only on a method name.
  if (httpScope) for (const file of files.keys()) {
    if (!/\.(?:js|mjs|cjs|ts)$/u.test(file)) continue;
    const module = await load(file);
    const featureFactories = new Set([...module.imports].filter(([, entry]) => entry.source === "@jskit-ai/kernel/server/features" && entry.imported === "defineFeature").map(([name]) => name));
    for (const record of module.nodes) {
      const { node, offset } = record;
      if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || !unshadowed(record, node.callee.name)) continue;
      const factory = module.imports.get(node.callee.name);
      if (factory?.source !== "@jskit-ai/crud-core/server/defineCrudJsonApiFeature" || factory.imported !== "defineCrudJsonApiFeature" || record.ancestors.some(entry => /Function/u.test(entry.type))) continue;
      const config = bindingNode(node.arguments[0], module.bindings);
      if (config?.type !== "ObjectExpression" || config.properties.some(entry => entry.type !== "ObjectProperty" || entry.computed)) { warn("CRUD_CONTROLLER_UNRESOLVED", "A CRUD controller declaration is dynamic.", file); continue; }
      const resource = await crudResource(module, property(config, "resource"));
      const surface = staticValue(property(config, "surface"), module.bindings);
      const routes = property(config, "routes");
      if (routes && staticValue(routes, module.bindings) === false) continue;
      const relativePath = property(config, "relativePath");
      const apiSuffix = relativePath ? staticValue(relativePath, module.bindings) : resource && `/${resource.namespace.replace(/_/gu, "-")}`;
      const declared = property(config, "operations");
      const operations = declared ? staticValue(declared, module.bindings) : resource?.operations.map(name => name === "patch" ? "update" : name);
      if (!resource || typeof apiSuffix !== "string" || !apiSuffix.startsWith("/") || typeof surface !== "string" || !surface.trim() || routes && staticValue(routes, module.bindings) !== true || !Array.isArray(operations) || !operations.length || !operations.every(name => ["list", "view", "create", "update", "delete"].includes(name))) { warn("CRUD_CONTROLLER_UNRESOLVED", "A CRUD controller needs literal resource, surface and enabled operations.", file); continue; }
      const declaration = record.ancestors.find(entry => entry.type === "VariableDeclarator" && entry.id.type === "Identifier");
      if (!declaration || !module.exports.has(declaration.id.name)) continue;
      for (const operation of new Set(operations)) output.entryOperations.push({ id: `entry:crud:${file}:${node.start}:${operation}`, key: crudKey(surface.trim().toLowerCase(), resource.namespace, operation, apiSuffix), controllerFile: file, resolution: "resolved", evidence: [...evidence(module, node, offset), ...resource.evidence] });
    }
    if (!featureFactories.size) continue;
    for (const { node, ancestors, offset } of module.nodes) {
      if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.computed || node.callee.property.name !== "register") continue;
      const router = node.callee.object;
      if (router.type !== "MemberExpression" || router.computed || router.property.name !== "router" || router.object.type !== "Identifier") continue;
      const feature = ancestors.find(entry => entry.type === "CallExpression" && entry.callee.type === "Identifier" && featureFactories.has(entry.callee.name));
      const setup = ancestors.slice().reverse().find(entry => entry.type === "ObjectMethod" && entry.key.name === "setup");
      const dependency = setup?.params[0]?.type === "ObjectPattern" && setup.params[0].properties.find(entry => entry.type === "ObjectProperty" && entry.key.name === "http");
      if (!feature || dependency?.value?.name !== router.object.name) continue;
      const method = staticValue(node.arguments[0], module.bindings); const operation = staticValue(node.arguments[1], module.bindings); const handler = node.arguments[3];
      if (typeof method !== "string" || typeof operation !== "string" || !handler || !/Function/u.test(handler.type)) { warn("CONTROLLER_UNRESOLVED", "A route's application handler or identity is dynamic.", file); continue; }
      output.entryOperations.push({ id: `entry:${httpScope}:${file}:${node.start}`, key: { protocol: "http", scope: httpScope, method: method.toUpperCase(), operation: `${apiBasePath}${operation}` }, controllerFile: file, resolution: "resolved", evidence: evidence(module, node, offset) });
    }
  }
  // Report source imports using the same framework-aware resolver as UI
  // discovery. These are imported names, not proof that an operation executes.
  // Opaque packages stay with package discovery; no dependency tree is read.
  for (const file of files.keys()) {
    if (!/\.(?:[cm]?js|jsx|tsx?|vue)$/u.test(file)) continue;
    const module = await load(file);
    for (const { node, offset } of module.nodes) {
      if (node.type !== 'ImportDeclaration') continue;
      const target = resolve(file, node.source.value);
      if (!target) continue;
      await load(target);
      const names = node.specifiers.map(specifier => specifier.type === 'ImportNamespaceSpecifier' ? '*' : specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported.name || specifier.imported.value);
      output.imports.push({ id: `import:${file}:${offset + node.start}`, fromFile: file, targetFile: target,
        specifier: node.source.value, names, typeOnly: node.importKind === 'type' || Boolean(node.specifiers.length && node.specifiers.every(specifier => specifier.importKind === 'type')),
        resolution: 'resolved', evidence: evidence(module, node, offset) });
    }
  }
  return output;
}
