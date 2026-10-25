import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver, VueQueryPlugin } from "@tanstack/vue-query";
import { createSSRApp, effectScope, h, nextTick, ref, watch } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
import { configureHttpWebClient, resetHttpWebClientForTests } from "../src/client/lib/httpClient.js";
import {
  requireCrudDeleteOperation,
  useCrudDeleteAction
} from "../src/client/composables/useCrudDeleteAction.js";

const deleteResource = Object.freeze({
  namespace: "notes",
  operations: Object.freeze({
    delete: Object.freeze({
      method: "DELETE"
    })
  })
});

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/notes", component: { render: () => h("div") } },
      { path: "/notes/:noteId", component: { render: () => h("div") } }
    ]
  });
}

function createScreen() {
  return Object.freeze({
    view: Object.freeze({
      recordId: ref("42"),
      record: ref({ id: "42", title: "Keep it simple" }),
      isLoading: ref(false),
      isNotFound: ref(false),
      resolveParams(template = "") {
        return String(template || "").replace(":noteId", "42");
      }
    }),
    listLocation: ref({ path: "/notes" })
  });
}

async function renderDeleteAction({ client, resource = deleteResource, queryClient = new QueryClient() } = {}) {
  const router = createTestRouter();
  await router.push("/notes/42");
  await router.isReady();

  let deleteAction = null;
  const app = createSSRApp({
    setup() {
      deleteAction = useCrudDeleteAction({
        screen: createScreen(),
        resource,
        resourceNamespace: "notes",
        apiUrlTemplate: "/notes/:noteId",
        client
      });
      return () => h("div");
    }
  });
  app.use(router);
  app.use(VueQueryPlugin, { queryClient });
  await renderToString(app);

  return { deleteAction, queryClient, router };
}

test("useCrudDeleteAction confirms one DELETE, invalidates CRUD state, and returns to the list", async () => {
  const requests = [];
  const invalidations = [];
  let finishRequest = null;
  const queryClient = new QueryClient();
  queryClient.invalidateQueries = async function invalidateQueries(options = {}) {
    invalidations.push(options);
  };
  const pendingRequest = new Promise((resolve) => {
    finishRequest = resolve;
  });
  const client = {
    async request(path, options = {}) {
      requests.push({ path, options });
      return pendingRequest;
    }
  };
  const { deleteAction, router } = await renderDeleteAction({ client, queryClient });

  assert.equal(deleteAction.canDelete, true);
  assert.equal(deleteAction.request(), true);
  assert.equal(deleteAction.isOpen, true);

  const confirmation = deleteAction.confirm();
  await nextTick();
  assert.equal(deleteAction.isDeleting, true);
  assert.equal(requests.length, 1);
  assert.match(requests[0].path, /\/notes\/42$/);
  assert.equal(requests[0].options.method, "DELETE");
  assert.equal(Object.hasOwn(requests[0].options, "body"), false);

  finishRequest(null);
  await confirmation;

  assert.equal(deleteAction.isDeleting, false);
  assert.equal(deleteAction.isOpen, false);
  assert.equal(router.currentRoute.value.path, "/notes");
  assert.deepEqual(invalidations, [
    { queryKey: ["crud", "notes"] }
  ]);
});

test("useCrudDeleteAction leaves the deleted record's view before CRUD state is refetched", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  const viewQueryKey = ["crud", "notes", "view", "42"];
  let viewFetches = 0;
  let recordDeleted = false;
  const viewObserver = new QueryObserver(queryClient, {
    queryKey: viewQueryKey,
    async queryFn() {
      viewFetches += 1;
      if (recordDeleted) {
        throw Object.assign(new Error("Record not found."), { status: 404 });
      }
      return { id: "42" };
    }
  });
  const stopObservingView = viewObserver.subscribe(() => {});
  await queryClient.fetchQuery({ queryKey: viewQueryKey, queryFn: () => ({ id: "42" }) });
  viewFetches = 0;

  const client = {
    async request() {
      recordDeleted = true;
      return null;
    }
  };
  const { deleteAction, router } = await renderDeleteAction({ client, queryClient });

  // The view screen unmounts (stops observing its query) when the route leaves it,
  // in the same scheduler flush that re-renders the router view.
  const scope = effectScope();
  scope.run(() => {
    watch(() => router.currentRoute.value.path, (path) => {
      if (path === "/notes") {
        stopObservingView();
      }
    });
  });

  try {
    deleteAction.request();
    await deleteAction.confirm();

    assert.equal(router.currentRoute.value.path, "/notes");
    assert.equal(viewFetches, 0);
    assert.equal(queryClient.getQueryState(viewQueryKey)?.isInvalidated, true);
    assert.equal(queryClient.getQueryState(viewQueryKey)?.error, null);
  } finally {
    scope.stop();
    stopObservingView();
    queryClient.clear();
  }
});

test("useCrudDeleteAction keeps the record dialog open with useful error feedback", async () => {
  const client = {
    async request() {
      throw new Error("Delete service unavailable.");
    }
  };
  const { deleteAction, router } = await renderDeleteAction({ client });

  deleteAction.request();
  await deleteAction.confirm();

  assert.equal(deleteAction.isOpen, true);
  assert.equal(deleteAction.isDeleting, false);
  assert.equal(deleteAction.error, "Delete service unavailable.");
  assert.equal(router.currentRoute.value.path, "/notes/42");
});

test("public deletion resolves the configured client without session CSRF", async (t) => {
  t.after(resetHttpWebClientForTests);
  const requests = [];
  configureHttpWebClient({
    async request(path, options) {
      requests.push({ path, options });
      return null;
    }
  });
  const { deleteAction, router } = await renderDeleteAction({
    resource: { ...deleteResource, apiAccess: "public" }
  });

  deleteAction.request();
  await deleteAction.confirm();

  assert.equal(requests.length, 1);
  assert.match(requests[0].path, /\/notes\/42$/);
  assert.equal(requests[0].options.method, "DELETE");
  assert.equal(requests[0].options.csrf, false);
  assert.equal(router.currentRoute.value.path, "/notes");
});

test("authenticated deletion retains configured-client CSRF behavior", async (t) => {
  t.after(resetHttpWebClientForTests);
  const requests = [];
  configureHttpWebClient({
    async request(path, options) {
      requests.push({ path, options });
      return null;
    }
  });
  const { deleteAction } = await renderDeleteAction();

  deleteAction.request();
  await deleteAction.confirm();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "DELETE");
  assert.equal(Object.hasOwn(requests[0].options, "csrf"), false);
});

test("public deletion honors an explicit client override", async (t) => {
  t.after(resetHttpWebClientForTests);
  configureHttpWebClient({
    request() {
      assert.fail("The configured client must not replace the explicit override.");
    }
  });
  const requests = [];
  const { deleteAction } = await renderDeleteAction({
    resource: { ...deleteResource, apiAccess: "public" },
    client: {
      async request(path, options) {
        requests.push({ path, options });
        return null;
      }
    }
  });

  deleteAction.request();
  await deleteAction.confirm();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "DELETE");
  assert.equal(requests[0].options.csrf, false);
});

test("useCrudDeleteAction rejects resources without the canonical DELETE operation", () => {
  assert.throws(
    () => requireCrudDeleteOperation({ operations: {} }),
    /requires resource\.operations\.delete/
  );
  assert.throws(
    () => requireCrudDeleteOperation({ operations: { delete: { method: "POST" } } }),
    /method to be DELETE/
  );
});
