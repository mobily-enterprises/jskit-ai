import assert from "node:assert/strict";
import test from "node:test";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { useCrudListScreen } from "../src/client/composables/useCrudListScreen.js";

async function renderListScreen(options) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/books", component: { render: () => h("div") } }] });
  await router.push("/books");
  const queryClient = new QueryClient();
  let screen;
  const app = createSSRApp({
    setup() {
      screen = useCrudListScreen({
        resourceNamespace: "books",
        apiSuffix: "/books",
        readEnabled: false,
        client: { async request() { return { items: [], nextCursor: null }; } },
        ...options
      });
      return () => h("div");
    }
  });
  app.use(router);
  app.use(VueQueryPlugin, { queryClient });
  await renderToString(app);
  queryClient.clear();
  return screen;
}

test("list screen link availability is the list runtime's single answer", async () => {
  const blank = await renderListScreen({ viewUrlTemplate: "   ", editUrlTemplate: "" });
  assert.equal(blank.hasViewUrl, false);
  assert.equal(blank.hasEditUrl, false);
  assert.equal(blank.hasViewUrl, blank.records.hasViewUrl);

  const linked = await renderListScreen({ viewUrlTemplate: "/books/:recordId", editUrlTemplate: "/books/:recordId/edit" });
  assert.equal(linked.hasViewUrl, true);
  assert.equal(linked.hasEditUrl, true);
  assert.equal(Object.hasOwn(linked.records, "actionColumnCount"), false);
  assert.equal(Object.hasOwn(linked.records, "resolveFieldDisplay"), false);
  assert.equal(linked.resolveRecordTitle({ name: "Dune" }), "Dune");
});
