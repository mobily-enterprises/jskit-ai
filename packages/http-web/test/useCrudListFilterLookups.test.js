import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createRenderer, h, reactive } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { configureHttpWebClient } from "../src/client/lib/httpClient.js";
import { useCrudListFilterLookups } from "../src/client/composables/useCrudListFilterLookups.js";
import {
  resolveLookupSelectedValues,
  createLookupOptionsFromItems,
  mergeSelectedLookupOptions,
  resolveLookupOptionLabel
} from "../src/client/composables/internal/crudListFilterLookupSupport.js";

const supplierFilter = Object.freeze({
  key: "supplierContactId",
  type: "recordIdMany",
  label: "Supplier",
  lookup: Object.freeze({
    apiSuffix: "/contacts",
    valueKey: "id",
    labelKey: "name"
  })
});

test("lookup filter support normalizes selected record ids for single and many filters", () => {
  assert.deepEqual(
    resolveLookupSelectedValues(supplierFilter, ["7", "4", "7", ""]),
    ["7", "4"]
  );

  assert.deepEqual(
    resolveLookupSelectedValues(
      {
        ...supplierFilter,
        type: "recordId"
      },
      12
    ),
    ["12"]
  );
});

test("lookup filter support builds option labels from custom resolvers and fallback lookup labels", () => {
  const options = createLookupOptionsFromItems(
    [
      {
        id: 7,
        firstName: "Pollen",
        lastName: "Partners"
      },
      {
        id: 4,
        name: "Harbor Storage"
      }
    ],
    supplierFilter,
    (item = {}) => {
      if (item.id === 7) {
        return `${item.firstName} ${item.lastName}`;
      }

      return "";
    }
  );

  assert.deepEqual(options, [
    {
      value: "7",
      label: "Pollen Partners",
      record: {
        id: 7,
        firstName: "Pollen",
        lastName: "Partners"
      }
    },
    {
      value: "4",
      label: "Harbor Storage",
      record: {
        id: 4,
        name: "Harbor Storage"
      }
    }
  ]);
});

test("lookup filter support merges cached selected labels and resolves fallback labels", () => {
  const currentOptions = [
    {
      value: "7",
      label: "Pollen Partners",
      record: {
        id: 7,
        name: "Pollen Partners"
      }
    }
  ];
  const cachedOptions = new Map([
    ["12", {
      value: "12",
      label: "North Shed",
      record: {
        id: 12,
        name: "North Shed"
      }
    }]
  ]);

  const mergedOptions = mergeSelectedLookupOptions(
    currentOptions,
    ["12", "7"],
    cachedOptions
  );

  assert.deepEqual(mergedOptions.map((option) => option.value), ["12", "7"]);
  assert.equal(resolveLookupOptionLabel(mergedOptions, cachedOptions, "12", "Storage"), "North Shed");
  assert.equal(resolveLookupOptionLabel(mergedOptions, cachedOptions, "55", "Storage"), "Storage 55");
});

test("a partial page of options keeps the server's order; a complete list is sorted by label", () => {
  const page = [
    { value: "3", label: "Zephyr Farms" },
    { value: "1", label: "Acme Supplies" }
  ];

  assert.deepEqual(
    mergeSelectedLookupOptions(page, [], new Map(), { complete: false }).map((option) => option.label),
    ["Zephyr Farms", "Acme Supplies"]
  );
  assert.deepEqual(
    mergeSelectedLookupOptions(page, [], new Map()).map((option) => option.label),
    ["Acme Supplies", "Zephyr Farms"]
  );
  // A selected value the page lacks comes first, before the page in its order.
  const cached = new Map([["90", { value: "90", label: "Bright Hives" }]]);
  assert.deepEqual(
    mergeSelectedLookupOptions(page, ["90"], cached, { complete: false }).map((option) => option.value),
    ["90", "3", "1"]
  );
});

// 45 suppliers on the server, 20 per page in id order: the selected supplier 44 is past the first page.
const SUPPLIERS = Array.from({ length: 45 }, (_, index) => ({ id: String(index + 1), name: `Farm ${String(index + 1).padStart(2, "0")}` }));

function supplierClient(calls) {
  return {
    async request(path, options = {}) {
      calls.push({ path, query: { ...(options.query || {}) } });
      const query = options.query || {};
      const ids = query.id === undefined ? null : [query.id].flat().map(String);
      const matching = ids ? SUPPLIERS.filter((supplier) => ids.includes(supplier.id)) : SUPPLIERS;
      const start = query.cursor ? Number(query.cursor) : 0;
      const limit = Number(query.limit) || 20;
      const items = matching.slice(start, start + limit);
      return { items, nextCursor: start + limit < matching.length ? String(start + limit) : null };
    }
  };
}

async function settle(check) {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mountSupplierLookup(values) {
  const calls = [];
  configureHttpWebClient(supplierClient(calls));
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/receivals", component: { render: () => h("div") } }] });
  await router.push("/receivals");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let filterLookups;
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
  const app = renderer.createApp({
    setup() {
      filterLookups = useCrudListFilterLookups({ supplierContactId: supplierFilter }, { values });
      return () => h("div");
    }
  });
  app.use(router);
  app.use(VueQueryPlugin, { queryClient });
  app.mount(node("root"));
  return { app, calls, filterLookups, queryClient };
}

test("a lookup filter reads nothing until its options are shown, and labels a selected value past the first page by id", async (t) => {
  const values = reactive({ supplierContactId: ["44"] });
  const { app, calls, filterLookups, queryClient } = await mountSupplierLookup(values);
  t.after(() => {
    app.unmount();
    queryClient.clear();
    configureHttpWebClient({});
  });

  await settle(() => filterLookups.resolveLookupLabel("supplierContactId", "44", "Supplier") === "Farm 44");
  // One request, for the selected value alone; the closed sheet's options were not read.
  assert.deepEqual(calls.map((call) => call.query.id ?? null), ["44"]);
  assert.equal(filterLookups.resolveLookupLabel("supplierContactId", "44", "Supplier"), "Farm 44");

  const lookup = filterLookups.resolveLookup("supplierContactId");
  assert.deepEqual(lookup.options.map((option) => option.label), ["Farm 44"]);
  await settle(() => lookup.options.length > 1);
  // The first page keeps the server's order after the selected value, and says more rows remain.
  assert.deepEqual(lookup.options.slice(0, 3).map((option) => option.label), ["Farm 44", "Farm 01", "Farm 02"]);
  assert.equal(lookup.options.length, 21);
  assert.equal(filterLookups.resolveLookupHasMore("supplierContactId"), true);

  await filterLookups.loadMoreLookup("supplierContactId");
  await settle(() => lookup.options.length > 21);
  await filterLookups.loadMoreLookup("supplierContactId");
  await settle(() => filterLookups.resolveLookupHasMore("supplierContactId") === false);
  // Every row loaded: the list is complete, so it is sorted by label.
  assert.equal(lookup.options.length, 45);
  assert.equal(lookup.options[0].label, "Farm 01");
  assert.equal(lookup.options[44].label, "Farm 45");
});
