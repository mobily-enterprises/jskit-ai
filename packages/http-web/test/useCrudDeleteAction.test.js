import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createSSRApp, h, nextTick, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createMemoryHistory, createRouter } from "vue-router";
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

async function renderDeleteAction({ client, queryClient = new QueryClient() } = {}) {
  const router = createTestRouter();
  await router.push("/notes/42");
  await router.isReady();

  let deleteAction = null;
  const app = createSSRApp({
    setup() {
      deleteAction = useCrudDeleteAction({
        screen: createScreen(),
        resource: deleteResource,
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
    { queryKey: ["ui-generator", "notes"] }
  ]);
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
