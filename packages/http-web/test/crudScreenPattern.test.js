import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { useCrudAddEditScreen } from "../src/client/composables/useCrudAddEditScreen.js";
import { useCrudListScreen } from "../src/client/composables/useCrudListScreen.js";

const execFileAsync = promisify(execFile);
const patternRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../patterns/crud-screen-set"
);
const exampleRoot = path.join(patternRoot, "example", "books");

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@local/books/shared") {
      return { shortCircuit: true, url: new URL("../../resource-crud-core/patterns/resource-contract/example/bookResource.js", import.meta.url).href };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(".vue")) return nextLoad(url, context);
    const { descriptor } = parse(readFileSync(new URL(url), "utf8"));
    return { format: "module", shortCircuit: true, source: compileScript(descriptor, { id: url }).content };
  }
});

test("the human guide's public create/list configuration works without bootstrap permissions", async () => {
  const guide = await readFile(new URL("../../agent-docs/site/guide/framework/crud-operations.md", import.meta.url), "utf8");
  const snippets = Array.from(guide.matchAll(/```js\n([\s\S]*?)\n```/gu), (match) => match[1]);
  const resource = new Function("defineCrudResource", `${snippets.find((source) => source.startsWith("const bookResource"))}\nreturn bookResource;`)(defineCrudResource);
  const options = new Function(`return ({${snippets.find((source) => source.startsWith("addEditOptions:"))}});`)();
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/books/:bookId?", component: { render: () => h("div") } }] });
  await router.push("/books/new");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const writes = [];
  const saved = [];
  const client = {
    async request(path, requestOptions) {
      assert.equal(path, "/api/books");
      assert.equal(requestOptions.csrf, false);
      if (requestOptions.method === "GET") return { items: [...saved], nextCursor: null };
      writes.push(requestOptions.body);
      const record = { id: "1", ...requestOptions.body };
      saved.push(record);
      return record;
    }
  };
  let form;
  let list;
  const app = createSSRApp({
    setup() {
      form = useCrudAddEditScreen({
        ...options,
        resource,
        operationName: "create",
        formFields: [{ key: "title", type: "string" }],
        addEditOptions: { ...options.addEditOptions, client }
      });
      list = useCrudListScreen({ resource, resourceNamespace: "books", apiSuffix: "/books", readEnabled: false, client });
      return () => h("div");
    }
  });
  app.use(router);
  app.use(VueQueryPlugin, { queryClient });
  app.provide("jskit.shell-web.runtime.web-placement.client", {
    getPlacements: () => [],
    getContext: () => ({ surfaceConfig: { defaultSurfaceId: "home", enabledSurfaceIds: ["home"], surfacesById: { home: { id: "home", enabled: true, routeBase: "/", pagesRoot: "", requiresWorkspace: false } } } })
  });
  try {
    await renderToString(app);
    assert.equal(form.addEdit.loadError, "");
    assert.equal(form.addEdit.isSubmitDisabled, false);
    await form.addEdit.submit();
    assert.equal(writes.length, 0);
    form.formState.title = "Public book";
    await form.addEdit.submit();
    assert.deepEqual(writes, [{ title: "Public book" }]);
    await list.records.reload();
    assert.deepEqual(list.records.items, [{ id: "1", title: "Public book" }]);
    assert.deepEqual(Object.keys(resource.operations), ["list", "view", "create"]);
    assert.equal(Object.hasOwn(resource.schema, "userId"), false);
  } finally {
    queryClient.clear();
  }
});
const { default: BookNewPage } = await import("../patterns/crud-screen-set/example/books/BookNewPage.vue");
const { default: BookEditPage } = await import("../patterns/crud-screen-set/example/books/BookEditPage.vue");
hooks.deregister();

test("CRUD screen pattern is thin app-owned source over shared public screens", async () => {
  const files = (await readdir(exampleRoot)).sort();
  const sources = await Promise.all(files.map((file) => readFile(path.join(exampleRoot, file), "utf8")));
  const combinedSource = sources.join("\n");

  assert.deepEqual(files, [
    "BookEditPage.vue",
    "BookFormFields.vue",
    "BookListPage.vue",
    "BookNewPage.vue",
    "BookViewPage.vue",
    "formFields.js",
    "listExtensions.js"
  ]);
  assert.match(combinedSource, /useCrudListScreen/u);
  assert.match(combinedSource, /useCrudViewScreen/u);
  assert.match(combinedSource, /useCrudAddEditScreen/u);
  assert.match(combinedSource, /useCrudDeleteAction/u);
  assert.doesNotMatch(combinedSource, /ui-generator|generated-ui|jskit:crud-ui|__JSKIT_/u);
  assert.doesNotMatch(combinedSource, /:loading=|v-progress-(?:circular|linear)/u);

  for (const file of files) {
    const absolutePath = path.join(exampleRoot, file);
    if (file.endsWith(".js")) {
      await execFileAsync(process.execPath, ["--check", absolutePath]);
      continue;
    }

    const source = await readFile(absolutePath, "utf8");
    const { descriptor, errors } = parse(source, { filename: absolutePath });
    assert.deepEqual(errors, []);
    if (descriptor.scriptSetup) {
      compileScript(descriptor, { id: `pattern-${file}` });
    }
    if (descriptor.template) {
      const result = compileTemplate({
        id: `pattern-${file}`,
        filename: absolutePath,
        source: descriptor.template.content
      });
      assert.deepEqual(result.errors, []);
    }
  }
});

test("published New/Edit page setup runs the real CRUD form composables with distinct cache keys", async () => {
  for (const [Page, routePath, marker] of [[BookNewPage, "/books/new", "new"], [BookEditPage, "/books/42/edit", "42"]]) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/books/new", component: { render: () => h("div") } }, { path: "/books/:bookId/edit", component: { render: () => h("div") } }]
    });
    await router.push(routePath);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let screen;
    const app = createSSRApp({
      ...Page,
      setup(props, context) {
        screen = Page.setup(props, context).screen;
        return () => h("div");
      }
    });
    app.use(router);
    app.use(VueQueryPlugin, { queryClient });
    app.provide("jskit.shell-web.runtime.web-placement.client", {
      getPlacements: () => [],
      getContext: () => ({ surfaceConfig: { defaultSurfaceId: "app", enabledSurfaceIds: ["app"], surfacesById: { app: { id: "app", enabled: true, routeBase: "/", pagesRoot: "", requiresWorkspace: false } } } })
    });
    await renderToString(app);
    assert.equal(screen.addEdit.loadError, "");
    if (marker === "new") assert.equal(screen.addEdit.isSubmitDisabled, false);
    const keys = queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    assert.equal(keys.some((key) => key[0] === "crud" && key[1] === "books" && key.includes(marker)), true);
    queryClient.clear();
  }
});
