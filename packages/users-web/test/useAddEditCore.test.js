import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { computed, createSSRApp, effectScope, h, reactive, ref } from "vue";
import { useAddEditCore } from "../src/client/composables/runtime/useAddEditCore.js";

test("useAddEditCore writes saved payloads to the submit-time query key", async () => {
  const queryClient = new QueryClient();
  const model = reactive({
    status: "draft"
  });
  const payload = {
    id: 42,
    status: "published"
  };
  const resource = {
    isSaving: ref(false),
    async save() {
      return payload;
    }
  };
  let runtime = null;
  const app = createSSRApp({
    render() {
      return h("div");
    }
  });
  app.use(VueQueryPlugin, {
    queryClient
  });
  const scope = effectScope();

  app.runWithContext(() => {
    scope.run(() => {
      runtime = useAddEditCore({
        model,
        resource,
        queryKey: computed(() => ["products", model.status]),
        canSave: ref(true),
        fieldBag: {
          clear() {},
          apply() {}
        },
        feedback: {
          clear() {},
          success() {},
          error() {}
        },
        mapLoadedToModel(target = {}, loaded = {}) {
          target.status = loaded.status;
        }
      });
    });
  });

  await runtime.submit();
  scope.stop();

  assert.equal(model.status, "published");
  assert.deepEqual(queryClient.getQueryData(["products", "draft"]), payload);
  assert.equal(queryClient.getQueryData(["products", "published"]), undefined);
});

test("useAddEditCore snapshots the cache key after payload normalization", async () => {
  const queryClient = new QueryClient();
  const model = reactive({
    status: "draft"
  });
  const payload = {
    id: 42,
    status: "published"
  };
  const resource = {
    isSaving: ref(false),
    async save() {
      return payload;
    }
  };
  let runtime = null;
  const app = createSSRApp({
    render() {
      return h("div");
    }
  });
  app.use(VueQueryPlugin, {
    queryClient
  });
  const scope = effectScope();

  app.runWithContext(() => {
    scope.run(() => {
      runtime = useAddEditCore({
        model,
        resource,
        queryKey: computed(() => ["products", model.status]),
        canSave: ref(true),
        fieldBag: {
          clear() {},
          apply() {}
        },
        feedback: {
          clear() {},
          success() {},
          error() {}
        },
        buildRawPayload() {
          model.status = "normalized";
          return {};
        },
        mapLoadedToModel(target = {}, loaded = {}) {
          target.status = loaded.status;
        }
      });
    });
  });

  await runtime.submit();
  scope.stop();

  assert.equal(model.status, "published");
  assert.equal(queryClient.getQueryData(["products", "draft"]), undefined);
  assert.deepEqual(queryClient.getQueryData(["products", "normalized"]), payload);
  assert.equal(queryClient.getQueryData(["products", "published"]), undefined);
});
