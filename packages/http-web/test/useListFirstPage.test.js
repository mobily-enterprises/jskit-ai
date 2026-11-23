import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createRenderer, h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { useList } from "../src/client/composables/records/useList.js";
import { useCrudListFilters } from "../src/client/composables/useCrudListFilters.js";

// Changing or removing a filter, or changing the search, starts the list again at its first page. Two watchers of the
// list's component react to such a change in the same flush: vue-query's own, on the query's options, which starts the
// refetch of the new key's cached pages (all of them, as they are when it starts), and the list's, which trims that
// cache to its first page. They run in the order they were notified, which shifts with render timing, so these tests
// make vue-query's run first: something else the query reads (its gcTime) changes first in the same tick.

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 50;
const REGION_FILTER = Object.freeze({
  region: Object.freeze({
    type: "enum",
    options: Object.freeze([
      Object.freeze({ label: "Far", value: "far" }),
      Object.freeze({ label: "Near", value: "near" })
    ])
  })
});

const node = (type, text = "") => ({ type, text, props: {}, children: [], parent: null });
const renderer = createRenderer({
  createElement: node,
  createText: (text) => node("text", text),
  createComment: () => node("comment"),
  setText: (item, text) => { item.text = text; },
  setElementText: (item, text) => { item.text = text; item.children = []; },
  patchProp: (item, key, _previous, value) => { item.props[key] = value; },
  parentNode: (item) => item.parent,
  nextSibling: (item) => item.parent?.children[item.parent.children.indexOf(item) + 1] ?? null,
  insert(item, parent, anchor) {
    if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1);
    item.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(item); else parent.children.splice(index, 0, item);
  },
  remove(item) {
    if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1);
  }
});

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(message);
}

// Three pages of 20 projects; a region filter or a search finds one.
function projectsPage(query = {}) {
  if (query.region || query.q) {
    return { items: [{ id: "far" }], nextCursor: null };
  }
  const page = Number(query.cursor ?? 0);
  return {
    items: Array.from({ length: PAGE_SIZE }, (_, index) => ({ id: `p${page * PAGE_SIZE + index}` })),
    nextCursor: page < 2 ? String(page + 1) : null
  };
}

// Mounts a list of projects with a region filter (and the search, when given) and loads its first two pages.
async function mountProjectList(t, { search = null } = {}) {
  const requests = [];
  const client = {
    async request(_path, options) {
      requests.push(options.query);
      return projectsPage(options.query);
    }
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/projects", component: { render: () => h("div") } }]
  });
  await router.push("/projects");
  await router.isReady();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const gcTime = ref(5 * 60 * 1000);
  let filters = null;
  let list = null;
  const app = renderer.createApp({
    setup() {
      filters = useCrudListFilters(REGION_FILTER);
      list = useList({
        apiSuffix: "/projects",
        ownershipFilter: "public",
        client,
        queryKeyFactory: () => ["projects"],
        queryParams: filters.queryParams,
        search,
        queryOptions: { gcTime }
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
  });

  await waitFor(() => list.items.length === PAGE_SIZE && !list.isFetching, "The list loads its first page.");
  await list.loadMore();
  await waitFor(() => list.items.length === PAGE_SIZE * 2 && !list.isFetching, "The list loads its second page.");
  return { list, filters, requests, gcTime };
}

// Queues vue-query's own watcher on the list's query options before any watcher the next change notifies.
function queueVueQueryFirst(gcTime) {
  gcTime.value += 1;
}

async function waitForReload(list, requests, requestsBefore, message) {
  await waitFor(() => requests.length > requestsBefore && !list.isFetching, message);
}

test("removing a filter starts the list again at its first page when vue-query's watcher runs first", async (t) => {
  const { list, filters, requests, gcTime } = await mountProjectList(t);
  filters.values.region = "far";
  await waitFor(() => list.items.length === 1 && !list.isFetching, "The region filter finds one project.");

  const requestsBefore = requests.length;
  queueVueQueryFirst(gcTime);
  filters.clearFilter("region");
  await waitForReload(list, requests, requestsBefore, "The list loads again without the filter.");

  assert.equal(list.items.length, PAGE_SIZE);
  assert.deepEqual(requests.slice(requestsBefore), [{ limit: PAGE_SIZE }]);
});

test("clearing the search starts the list again at its first page when vue-query's watcher runs first", async (t) => {
  const { list, requests, gcTime } = await mountProjectList(t, {
    search: { enabled: true, debounceMs: SEARCH_DEBOUNCE_MS }
  });
  list.searchQuery = "far";
  await waitFor(
    () => list.items.length === 1 && !list.isFetching && !list.isSearchDebouncing,
    "The search finds one project."
  );

  const requestsBefore = requests.length;
  // The search's debounce ends on a mocked clock, so it ends in the same tick as the change that queues vue-query's
  // watcher first. Nothing else starts a timer meanwhile.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    list.searchQuery = "";
    await nextTick();
    queueVueQueryFirst(gcTime);
    t.mock.timers.tick(SEARCH_DEBOUNCE_MS);
  } finally {
    t.mock.timers.reset();
  }
  await waitForReload(list, requests, requestsBefore, "The list loads again without the search.");

  assert.equal(list.items.length, PAGE_SIZE);
  assert.deepEqual(requests.slice(requestsBefore), [{ limit: PAGE_SIZE }]);
});
