import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectVueArchitecture } from "../src/architecture/inspectVueArchitecture.js";

async function fixture(t, source, discovery) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-architecture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [];
  for (const [file, text] of Object.entries(source)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
    files.push({ path: file, hash: `sha256:${createHash("sha256").update(text).digest("hex")}` });
  }
  return { root, input: { schema: "vibe64.architecture-inspection-input.v1", files, uiDiscovery: { discoveries: [discovery] } } };
}

test('source import evidence resolves configured aliases and project-root paths without treating every target export as imported', async t => {
  const { root, input } = await fixture(t, {
    'src/tools.js': 'export function run() {} export function internal() {}',
    'src/use.vue': '<template>Use</template>\n<script setup>import { run as invoke } from "@/tools.js"; import * as tools from "/src/tools.js"; invoke();</script>',
    'outside.js': 'import { run } from "@/tools.js";',
  }, { id: 'unused', adapter: 'native', surface: 'app', mode: 'registered', registrations: [], pageRoots: [] });
  const result = await inspectVueArchitecture({ projectRoot: root, input, aliases: { '@': 'src' } });
  assert.equal(result.imports.length, 3);
  assert.ok(result.imports.every(use => use.targetFile === 'src/tools.js' && use.resolution === 'resolved'));
  assert.deepEqual(result.imports.map(use => use.names).sort(), [['*'], ['run'], ['run']].sort());
  assert.equal(result.imports.some(use => use.names.includes('internal')), false);
  for (const use of result.imports) {
    const range = use.evidence[0];
    const line = (await readFile(path.join(root, range.path), 'utf8')).split('\n')[range.start.line - 1];
    assert.match(line.slice(range.start.column - 1, range.end.column - 1), /^import /);
  }
  assert.equal(result.inputs.some(file => file.path.startsWith('node_modules/')), false);
});

test("explicit registered routes discover real pages and referenced shared elements", async t => {
  const source = {
    "routes.ts": 'import { createRouter } from "vue-router";\nimport Checkout from "./views/Checkout.vue";\nconst routes = [{ path: "/shop", component: Checkout, children: [{ path: "detail", component: () => import("./views/Detail.vue") }] }];\ncreateRouter({ routes });\n',
    "views/Checkout.vue": '<template><SharedForm /></template>\n<script setup>import SharedForm from "../packages/payments/SharedForm.vue"; import Unused from "../Unused.vue";</script>\n',
    "views/Detail.vue": '<template>Detail</template>\n',
    "packages/payments/SharedForm.vue": '<template><button @click="save">Save</button></template>\n<script setup>async function save() { await fetch("/api/save", { method: "POST" }); } function unused() { fetch("/api/unused"); }</script>\n',
    "Unused.vue": '<template>Unused</template>\n',
    "engine/Feature.js": 'import { defineFeature } from "@jskit-ai/kernel/server/features";\nexport const feature = defineFeature({ setup({ http }) { http.router.register("POST", "/save", {}, async () => ({ ok: true })); } });\n',
  };
  const { root, input } = await fixture(t, source, { id: "shop", adapter: "vue-registered-router", surface: "app", mode: "registered", registrations: ["routes.ts"], pageRoots: [], componentRoots: [] });
  const result = await inspectVueArchitecture({ projectRoot: root, input, httpScope: "shop", apiBasePath: "/api" });
  assert.equal(result.pages.length, 2);
  assert.equal(result.registrations[1].identity, "/shop/detail");
  assert.equal(result.pages.find(page => page.file === "views/Detail.vue").parentId, result.pages.find(page => page.file === "views/Checkout.vue").id);
  assert.deepEqual(result.components.map(component => component.file), ["packages/payments/SharedForm.vue"]);
  assert.equal(result.operationUses.length, 1);
  assert.equal(result.operationUses[0].key.operation, "/api/save");
  assert.deepEqual(result.entryOperations[0].key, result.operationUses[0].key);
  assert.equal(result.entryOperations[0].controllerFile, "engine/Feature.js");
  const use = result.componentUses[0];
  const range = use.evidence[0];
  assert.equal(source[range.path].split("\n")[range.start.line - 1].slice(range.start.column - 1, range.end.column - 1), "<SharedForm />");
});

test("filesystem routing reuses the Vue Router scanner without generated files or watchers", async t => {
  const { root, input } = await fixture(t, {
    "vite.config.mjs": 'import VueRouter from "vue-router/vite";\nVueRouter({ routesFolder: "pages", dts: "generated-router.d.ts", nestedChildren: false });\n',
    "pages/shop.vue": '<template><router-view /></template>\n',
    "pages/shop/index.vue": '<template>Shop index</template>\n',
    "pages/shop/[id].vue": '<template>Shop detail</template>\n',
    "pages/shop/helper.ts": 'export const helper = true;\n',
  }, { id: "shop", adapter: "jskit", surface: "app", mode: "filesystem", registrations: ["vite.config.mjs"], pageRoots: ["pages"], componentRoots: [] });
  const result = await inspectVueArchitecture({ projectRoot: root, input });
  assert.equal(result.pages.length, 3);
  assert.equal(result.pages.find(page => page.file === "pages/shop/index.vue").title, "shop");
  assert.ok(result.registrations.some(registration => registration.identity.includes(":id")));
  assert.equal(result.pages.some(page => page.file.endsWith("helper.ts")), false);
  await assert.rejects(readFile(path.join(root, "generated-router.d.ts")), { code: "ENOENT" });
  assert.deepEqual((await readdir(root)).sort(), ["pages", "vite.config.mjs"]);
});

test("dynamic registration and unsupported routing adapters do not invent pages", async t => {
  const { root, input } = await fixture(t, { "routes.js": 'import { createRouter } from "vue-router"; createRouter({ routes: makeRoutes() });\n' }, { id: "dynamic", adapter: "vue-registered-router", surface: "app", mode: "registered", registrations: ["routes.js"], pageRoots: [] });
  const result = await inspectVueArchitecture({ projectRoot: root, input });
  assert.equal(result.pages.length, 0);
  assert.equal(result.capabilities.pages, "unsupported");
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "ROUTES_DYNAMIC"));
  input.uiDiscovery.discoveries[0].adapter = "native-scenes";
  const other = await inspectVueArchitecture({ projectRoot: root, input });
  assert.equal(other.pages.length, 0);
  assert.equal(other.capabilities.pages, "unsupported");
});

test('actual library component uses reference the declared package boundary without opening its internals', async t => {
  const { root, input } = await fixture(t, {
    'routes.js': 'import { createRouter } from "vue-router"; import Screen from "./Screen.vue"; createRouter({ routes: [{ path: "/", component: Screen }] });',
    'Screen.vue': '<template><LibraryButton /></template>\n<script setup>import { Button as LibraryButton, Unused } from "widgets";</script>',
  }, { id: 'library', adapter: 'vue-registered-router', surface: 'app', mode: 'registered', registrations: ['routes.js'], pageRoots: [] });
  input.packages = [{ id: 'package:widgets', name: 'widgets', root: 'node_modules/widgets', manifest: 'package.json', opaque: true, entryPoints: [{ importPath: '.', file: 'node_modules/widgets/index.js' }] }];
  input.packageIdentity = 'inspected-package-identity';
  const result = await inspectVueArchitecture({ projectRoot: root, input });
  assert.equal(result.packageIdentity, input.packageIdentity);
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].file, null);
  assert.deepEqual(result.components[0].origin, { kind: 'package', packageId: 'package:widgets', importPath: '.', symbol: 'Button' });
  assert.equal(result.componentUses[0].componentId, result.components[0].id);
  assert.equal(result.inputs.some(entry => entry.path.startsWith('node_modules/')), false);
});


test('used CRUD screens resolve resources through workspace barrels to exported controller declarations', async t => {
  const source = {
    'package.json': '{}',
    'routes.js': 'import { createRouter } from "vue-router"; import Screen from "./Screen.vue"; createRouter({ routes: [{ path: "/new", component: Screen }] });',
    'Screen.vue': '<template><CrudAddEditScreen :screen="screen" /></template>\n<script setup>import CrudAddEditScreen from "@jskit-ai/http-web/client/components/CrudAddEditScreen"; import { useCrudAddEditScreen } from "@jskit-ai/http-web/client/composables/useCrudAddEditScreen"; import { resource } from "@local/resource/shared"; const screen = useCrudAddEditScreen({ resource, operationName: "create", addEditOptions: { apiSuffix: "/names" } }); const unused = useCrudAddEditScreen({ resource, operationName: "view" });</script>',
    'packages/resource/shared.js': 'export { resource } from "./resource.js";',
    'packages/resource/resource.js': 'import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource"; export const resource = defineCrudResource({ namespace: "names", tableName: "names", crudOperations: ["list", "create"] });',
    'packages/resource/Feature.js': 'import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature"; import { resource } from "./resource.js"; export const NamesFeature = defineCrudJsonApiFeature({ resource, surface: "home", relativePath: "/names" });',
    'packages/resource/Disabled.js': 'import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature"; import { resource } from "./resource.js"; export const Disabled = defineCrudJsonApiFeature({ resource, surface: "home", routes: false });',
  };
  const { root, input } = await fixture(t, source, { id: 'crud', adapter: 'vue-registered-router', surface: 'home', mode: 'registered', registrations: ['routes.js'] });
  input.packages = [{ id: 'package:local', name: '@local/resource', root: 'packages/resource', manifest: 'package.json', opaque: false, entryPoints: [{ importPath: './shared', file: 'packages/resource/shared.js' }] }];
  const options = { projectRoot: root, input, httpScope: 'app' };
  const result = await inspectVueArchitecture(options);
  assert.equal(result.operationUses.length, 1);
  assert.equal(result.entryOperations.length, 2);
  const receiving = result.entryOperations.find(entry => entry.key.operation === 'names:create');
  assert.deepEqual(receiving.key, result.operationUses[0].key);
  assert.equal(receiving.controllerFile, 'packages/resource/Feature.js');
  assert.ok(result.operationUses[0].evidence.some(entry => entry.path === 'packages/resource/resource.js'));
  assert.ok(!result.entryOperations.some(entry => entry.controllerFile.endsWith('Disabled.js')));
  await writeFile(path.join(root, 'Screen.vue'), source['Screen.vue'].replace('apiSuffix: "/names"', 'apiSuffix: "/other"'));
  input.files.find(entry => entry.path === 'Screen.vue').hash = `sha256:${createHash('sha256').update(await readFile(path.join(root, 'Screen.vue'))).digest('hex')}`;
  const otherPath = await inspectVueArchitecture(options);
  assert.notDeepEqual(receiving.key, otherPath.operationUses[0].key);
  await writeFile(path.join(root, 'Screen.vue'), source['Screen.vue'].replace('resource, operationName: "create"', 'resource, operationName: "create", client: alternateClient'));
  input.files.find(entry => entry.path === 'Screen.vue').hash = `sha256:${createHash('sha256').update(await readFile(path.join(root, 'Screen.vue'))).digest('hex')}`;
  const dynamic = await inspectVueArchitecture(options);
  assert.equal(dynamic.operationUses[0].resolution, 'unresolved');
  assert.equal(dynamic.operationUses[0].key, undefined);
});
