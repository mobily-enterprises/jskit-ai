import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";

import {
  buildEndpointReadRequestOptions,
  buildEndpointWriteRequestOptions,
  useEndpointResource
} from "../src/client/composables/runtime/useEndpointResource.js";
import { buildListRequestOptions } from "../src/client/composables/runtime/useListCore.js";
import {
  resolveOperationRealtimeOptions
} from "../src/client/composables/useRealtimeQueryInvalidation.js";

test("endpoint read request options include transport only when provided", () => {
  assert.deepEqual(
    buildEndpointReadRequestOptions({
      method: "get"
    }),
    {
      method: "GET"
    }
  );

  assert.deepEqual(
    buildEndpointReadRequestOptions({
      method: "get",
      transport: {
        kind: "jsonapi-resource",
        responseType: "user-settings",
        responseKind: "record"
      }
    }),
    {
      method: "GET",
      transport: {
        kind: "jsonapi-resource",
        responseType: "user-settings",
        responseKind: "record"
      }
    }
  );
});

test("endpoint write request options preserve body/options and append transport", () => {
  assert.deepEqual(
    buildEndpointWriteRequestOptions({
      method: "patch",
      body: {
        theme: "dark"
      },
      options: {
        headers: {
          "x-demo": "1"
        }
      },
      transport: {
        kind: "jsonapi-resource",
        requestType: "user-preferences",
        responseType: "user-settings",
        responseKind: "record"
      }
    }),
    {
      method: "PATCH",
      headers: {
        "x-demo": "1"
      },
      body: {
        theme: "dark"
      },
      transport: {
        kind: "jsonapi-resource",
        requestType: "user-preferences",
        responseType: "user-settings",
        responseKind: "record"
      }
    }
  );
});

test("list request options stay GET and carry transport when provided", () => {
  assert.deepEqual(
    buildListRequestOptions({
      requestOptions: {
        headers: {
          "x-demo": "1"
        }
      },
      pageParam: "cursor_2",
      transport: {
        kind: "jsonapi-resource",
        responseType: "contacts",
        responseKind: "collection"
      }
    }),
    {
      method: "GET",
      headers: {
        "x-demo": "1"
      },
      query: {
        limit: 20,
        cursor: "cursor_2"
      },
      transport: {
        kind: "jsonapi-resource",
        responseType: "contacts",
        responseKind: "collection"
      }
    }
  );
});

test("list request options preserve explicit limit values", () => {
  assert.deepEqual(
    buildListRequestOptions({
      requestOptions: {
        query: {
          limit: 50
        }
      }
    }),
    {
      method: "GET",
      query: {
        limit: 50
      }
    }
  );

  assert.deepEqual(
    buildListRequestOptions({
      requestOptions: {
        query: {
          "page[limit]": "75"
        }
      }
    }),
    {
      method: "GET",
      query: {
        "page[limit]": "75"
      }
    }
  );
});

test("operation realtime options use fallback events unless explicitly overridden", () => {
  const fallbackRealtime = {
    events: ["contacts.record.changed"]
  };

  assert.deepEqual(
    resolveOperationRealtimeOptions({
      fallbackRealtime
    }),
    {
      events: ["contacts.record.changed"]
    }
  );

  assert.deepEqual(
    resolveOperationRealtimeOptions({
      realtime: {
        enabled: false
      },
      fallbackRealtime
    }),
    {
      events: ["contacts.record.changed"],
      enabled: false
    }
  );

  assert.deepEqual(
    resolveOperationRealtimeOptions({
      realtime: {
        event: "contacts.custom.changed"
      },
      fallbackRealtime
    }),
    {
      event: "contacts.custom.changed"
    }
  );

  assert.equal(
    resolveOperationRealtimeOptions({
      realtime: false,
      fallbackRealtime
    }),
    null
  );
});

test("endpoint resources invalidate their query key from configured realtime events", async () => {
  const queryClient = new QueryClient();
  const invalidations = [];
  const socketHandlers = new Map();
  const socket = {
    on(eventName, handler) {
      socketHandlers.set(eventName, handler);
    },
    off(eventName, handler) {
      if (socketHandlers.get(eventName) === handler) {
        socketHandlers.delete(eventName);
      }
    }
  };
  queryClient.invalidateQueries = async (options = {}) => {
    invalidations.push(options);
  };
  const app = createSSRApp({
    setup() {
      useEndpointResource({
        queryKey: ["today-workout-detail", "/api/today/workouts/2026-05-06"],
        path: "/api/today/workouts/2026-05-06",
        client: {
          async request() {
            return {};
          }
        },
        realtime: {
          event: "workout_set_logs.record.changed"
        }
      });
      return () => h("div");
    }
  });
  app.use(VueQueryPlugin, {
    queryClient
  });
  app.provide("jskit.realtime.runtime.client.socket", socket);
  await renderToString(app);

  const handler = socketHandlers.get("workout_set_logs.record.changed");
  assert.equal(typeof handler, "function");
  handler({
    entityId: "42"
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(invalidations, [
    {
      queryKey: ["today-workout-detail", "/api/today/workouts/2026-05-06"]
    }
  ]);
});

test("endpoint resource reads attach request recovery metadata to query options", async () => {
  const queryClient = new QueryClient();
  const queryKey = ["project-access", "beepollen"];
  const app = createSSRApp({
    setup() {
      useEndpointResource({
        queryKey,
        path: "/api/project-access",
        client: {
          async request() {
            return {};
          }
        },
        requestRecovery: {
          label: "Project access",
          source: "project-access.panel",
          dedupeKey: "project-access"
        }
      });
      return () => h("div");
    }
  });
  app.use(VueQueryPlugin, {
    queryClient
  });
  await renderToString(app);

  const query = queryClient.getQueryCache().find({
    queryKey
  });
  assert.deepEqual(query?.meta?.jskit, {
    requestRecoveryLabel: "Project access",
    requestRecoverySource: "project-access.panel",
    requestRecoveryDedupeKey: "project-access",
    requestRecoveryMethod: "GET"
  });
});
