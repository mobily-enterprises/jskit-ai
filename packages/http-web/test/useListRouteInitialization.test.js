import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import {
  computed,
  createRenderer,
  h,
  unref
} from "vue";
import {
  createMemoryHistory,
  createRouter,
  useRoute
} from "vue-router";

import { useList } from "../src/client/composables/records/useList.js";
import { useCrudListFilters } from "../src/client/composables/useCrudListFilters.js";

const CURRENTNESS_FILTERS = Object.freeze({
  currentness: Object.freeze({
    type: "enum",
    defaultValue: "active",
    options: Object.freeze([
      Object.freeze({
        label: "Active",
        value: "active"
      }),
      Object.freeze({
        label: "Archived",
        value: "archived"
      })
    ])
  })
});

async function waitFor(check, message = "Expected condition was not met.") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.fail(message);
}

function createTestRenderer() {
  function insert(child, parent, anchor = null) {
    const siblings = parent.children || (parent.children = []);
    const index = anchor ? siblings.indexOf(anchor) : -1;
    if (index < 0) {
      siblings.push(child);
    } else {
      siblings.splice(index, 0, child);
    }
    child.parent = parent;
  }

  function remove(child) {
    const parent = child?.parent;
    const index = parent?.children?.indexOf(child) ?? -1;
    if (index >= 0) {
      parent.children.splice(index, 1);
    }
    child.parent = null;
  }

  return createRenderer({
    patchProp(element, key, _previousValue, nextValue) {
      element.properties[key] = nextValue;
    },
    insert,
    remove,
    createElement(type) {
      return {
        type,
        properties: {},
        children: [],
        parent: null
      };
    },
    createText(text) {
      return {
        type: "text",
        text,
        parent: null
      };
    },
    createComment(text) {
      return {
        type: "comment",
        text,
        parent: null
      };
    },
    setText(node, text) {
      node.text = text;
    },
    setElementText(element, text) {
      element.children = [{
        type: "text",
        text,
        parent: element
      }];
    },
    parentNode(node) {
      return node?.parent || null;
    },
    nextSibling(node) {
      const parent = node?.parent;
      const index = parent?.children?.indexOf(node) ?? -1;
      return index >= 0 ? parent.children[index + 1] || null : null;
    },
    querySelector() {
      return null;
    },
    setScopeId() {},
    cloneNode(node) {
      return {
        ...node,
        properties: {
          ...node.properties
        },
        children: [...(node.children || [])],
        parent: null
      };
    },
    insertStaticContent(content, parent, anchor) {
      const node = {
        type: "static",
        text: content,
        parent: null
      };
      insert(node, parent, anchor);
      return [node, node];
    }
  });
}

function createListTestAdapter() {
  return Object.freeze({
    useOperationScope() {
      const route = useRoute();

      return Object.freeze({
        routeContext: Object.freeze({
          route,
          currentSurfaceId: computed(() => "admin")
        }),
        scopeParamValue: computed(() => ""),
        normalizedOwnershipFilter: "none",
        apiPath: computed(() => "/contacts"),
        queryKey: computed(() => ["contacts"]),
        queryCanRun(gate = true) {
          return computed(() => Boolean(unref(gate)));
        },
        permissionGate() {
          return computed(() => true);
        },
        loadError(error = "") {
          return computed(() => String(unref(error) || ""));
        },
        isLoading(loading = false) {
          return computed(() => Boolean(unref(loading)));
        }
      });
    }
  });
}

async function mountRouteSynchronizedList(initialLocation) {
  const calls = [];
  const client = {
    async request(path, options) {
      calls.push({
        path,
        options
      });
      return {
        items: [],
        nextCursor: null
      };
    }
  };
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false
      }
    }
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{
      path: "/contacts",
      component: {
        render() {
          return h("div");
        }
      }
    }]
  });
  const renderer = createTestRenderer();
  let filterRuntime = null;
  const app = renderer.createApp({
    setup() {
      filterRuntime = useCrudListFilters(CURRENTNESS_FILTERS);
      useList({
        adapter: createListTestAdapter(),
        client,
        queryKeyFactory: () => ["contacts"],
        queryParams: filterRuntime.queryParams,
        routeQueryValueResolvers: filterRuntime.routeQueryValueResolvers,
        syncToRoute: {
          enabled: true,
          search: false,
          queryParams: true
        }
      });

      return () => h("div");
    }
  });
  app.use(router);
  app.use(VueQueryPlugin, {
    queryClient
  });

  await router.push(initialLocation);
  await router.isReady();
  app.mount({
    type: "root",
    children: []
  });
  await waitFor(
    () => calls.length > 0,
    `Expected a list request for ${JSON.stringify(initialLocation)}.`
  );
  await new Promise((resolve) => setImmediate(resolve));

  return {
    app,
    calls,
    filterRuntime,
    queryClient,
    router
  };
}

test("route-synchronized lists make one initial request with the hydrated route filter", async () => {
  const runtime = await mountRouteSynchronizedList({
    path: "/contacts",
    query: {
      currentness: "archived"
    }
  });

  assert.equal(runtime.calls.length, 1);
  assert.deepEqual(runtime.calls[0], {
    path: "/contacts",
    options: {
      method: "GET",
      query: {
        currentness: "archived",
        limit: 20
      }
    }
  });
  runtime.app.unmount();
  runtime.queryClient.clear();
});

test("route-synchronized lists make one initial request with a declarative default", async () => {
  const runtime = await mountRouteSynchronizedList("/contacts");

  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0].options.query.currentness, "active");
  runtime.app.unmount();
  runtime.queryClient.clear();
});

test("invalid initial route filters fall back before the first list request", async () => {
  const runtime = await mountRouteSynchronizedList({
    path: "/contacts",
    query: {
      currentness: "not-a-valid-option"
    }
  });

  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0].options.query.currentness, "active");
  runtime.app.unmount();
  runtime.queryClient.clear();
});

test("route navigation rehydrates filters and a later clear stays cleared", async () => {
  const runtime = await mountRouteSynchronizedList({
    path: "/contacts",
    query: {
      currentness: "archived"
    }
  });

  await runtime.router.push({
    path: "/contacts",
    query: {
      currentness: "active"
    }
  });
  await waitFor(() => runtime.filterRuntime.values.currentness === "active");
  await waitFor(() => runtime.calls.length === 2);

  runtime.router.back();
  await waitFor(() => runtime.router.currentRoute.value.query.currentness === "archived");
  await waitFor(() => runtime.filterRuntime.values.currentness === "archived");
  await waitFor(() => runtime.calls.length === 3);

  runtime.router.forward();
  await waitFor(() => runtime.router.currentRoute.value.query.currentness === "active");
  await waitFor(() => runtime.filterRuntime.values.currentness === "active");
  await waitFor(() => runtime.calls.length === 4);

  runtime.filterRuntime.clearFilter("currentness");
  await waitFor(() => !Object.hasOwn(runtime.router.currentRoute.value.query, "currentness"));
  await waitFor(
    () => runtime.calls.length >= 5,
    `Expected one request after clearing the filter; received ${runtime.calls.length}.`
  );

  assert.equal(runtime.calls.length, 5, JSON.stringify(runtime.calls, null, 2));
  assert.equal(runtime.filterRuntime.values.currentness, "");
  assert.deepEqual(runtime.calls.at(-1).options.query, {
    limit: 20
  });
  runtime.app.unmount();
  runtime.queryClient.clear();
});
