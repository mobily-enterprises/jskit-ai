import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createRenderer, h, reactive } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { configureHttpWebClient } from "../src/client/lib/httpClient.js";
import { createCrudLookupFieldRuntime } from "../src/client/composables/crud/crudLookupFieldRuntime.js";

// Rooms of every building, 20 per page in id order: building 2's rooms are past the first page of all rooms.
const ROOMS = [
  ...Array.from({ length: 30 }, (_, index) => ({ id: String(index + 1), name: `North ${index + 1}`, buildingId: "1", bookable: true })),
  { id: "31", name: "South 1", buildingId: "2", bookable: true },
  { id: "32", name: "South 2", buildingId: "2", bookable: false }
];

function roomClient(calls) {
  return {
    async request(path, options = {}) {
      const query = { ...(options.query || {}) };
      calls.push({ path, query });
      const matching = ROOMS.filter((room) =>
        (query.buildingId === undefined || room.buildingId === query.buildingId) &&
        (query.bookable === undefined || room.bookable === (query.bookable === "1"))
      );
      return { items: matching.slice(0, Number(query.limit) || 20), nextCursor: null };
    }
  };
}

async function settle(check) {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("a form lookup narrows its options on the server by the parent record the form names, and follows it", async (t) => {
  const calls = [];
  configureHttpWebClient(roomClient(calls));
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/bookings/new", component: { render: () => h("div") } }] });
  await router.push("/bookings/new");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = (type) => ({ type, props: {}, children: [], parent: null });
  const renderer = createRenderer({
    createElement: node,
    createText: () => node("text"),
    createComment: () => node("comment"),
    setText() {},
    setElementText() {},
    patchProp: (item, key, _previous, value) => { item.props[key] = value; },
    parentNode: (item) => item.parent,
    nextSibling: (item) => item.parent?.children[item.parent.children.indexOf(item) + 1] ?? null,
    insert(item, parent) {
      item.parent = parent;
      parent.children.push(item);
    },
    remove(item) {
      if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1);
    }
  });
  const formState = reactive({ buildingId: "2", roomId: "" });
  let lookups;
  const app = renderer.createApp({
    setup() {
      lookups = createCrudLookupFieldRuntime({
        formFields: [{
          key: "roomId",
          relation: { kind: "lookup", apiPath: "/rooms", valueKey: "id", labelKey: "name" }
        }],
        requestQueryParams: {
          roomId: () => ({ buildingId: formState.buildingId, bookable: true })
        }
      });
      return () => h("div");
    }
  });
  app.use(router);
  app.use(VueQueryPlugin, { queryClient });
  app.mount(node("root"));
  t.after(() => {
    app.unmount();
    queryClient.clear();
    configureHttpWebClient({});
  });

  await settle(() => lookups.resolveLookupItems("roomId").length > 0);
  assert.deepEqual(calls[0].query, { buildingId: "2", bookable: "1", limit: 20 });
  assert.deepEqual(lookups.resolveLookupItems("roomId").map((item) => item.label), ["South 1"]);

  formState.buildingId = "1";
  await settle(() => lookups.resolveLookupItems("roomId")[0]?.label === "North 1");
  assert.deepEqual(calls.at(-1).query, { buildingId: "1", bookable: "1", limit: 20 });
  assert.equal(lookups.resolveLookupItems("roomId").length, 20);
});
