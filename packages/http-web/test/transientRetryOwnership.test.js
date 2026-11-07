import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/vue-query";
import { shouldRetryTransientQueryFailure, transientQueryRetryDelay } from "@jskit-ai/kernel/shared/support";

import { configureHttpWebClient } from "../src/client/lib/httpClient.js";

// The QueryClient defaults every JSKIT app installs (agent-docs patterns/*-foundation/example/src/main.js).
function appQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: shouldRetryTransientQueryFailure,
        retryDelay: transientQueryRetryDelay
      }
    }
  });
}

/**
 * Observes one read as a screen does and moves the mocked clock until it fails the way shell-web's request recovery
 * reports it (error, no fetch in flight): the moment the recovery banner appears.
 */
async function timeToRecoveryBanner(t, queryClient, queryFn) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const startedAt = Date.now();
  const observer = new QueryObserver(queryClient, { queryKey: ["unreachable-read"], queryFn });
  let failed = null;
  const unsubscribe = observer.subscribe((result) => {
    if (result.status === "error" && result.fetchStatus === "idle") failed ??= Date.now() - startedAt;
  });
  try {
    while (failed === null) {
      for (let turn = 0; turn < 4; turn += 1) await nextTurn();
      if (failed !== null) break;
      assert.ok(Date.now() - startedAt < 60_000, "The read never failed");
      t.mock.timers.tick(50);
    }
  } finally {
    unsubscribe();
    queryClient.clear();
  }
  return failed;
}

test("one unreachable safe read makes three requests and reaches request recovery in three seconds", async (t) => {
  let requests = 0;
  const client = configureHttpWebClient({
    fetchImpl: async () => {
      requests += 1;
      throw new TypeError("Failed to fetch");
    }
  });
  t.after(() => configureHttpWebClient());

  const elapsedMs = await timeToRecoveryBanner(t, appQueryClient(), () => client.request("/api/projects"));

  // The HTTP client retries the safe read twice, one and two seconds apart; the query does not retry it again.
  const outcome = `${requests} requests, request recovery after ${elapsedMs} ms`;
  assert.equal(requests, 3, outcome);
  assert.ok(elapsedMs >= 3_000 && elapsedMs < 3_100, outcome);
});

test("a query read the HTTP client does not retry keeps the query's own transient retries", async (t) => {
  let requests = 0;
  const client = configureHttpWebClient({
    fetchImpl: async (url) => {
      if (url === "/api/session") {
        return new Response(JSON.stringify({ csrfToken: "csrf" }), { headers: { "content-type": "application/json" } });
      }
      requests += 1;
      return new Response(JSON.stringify({ error: "Temporarily unavailable." }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }
  });
  t.after(() => configureHttpWebClient());

  const elapsedMs = await timeToRecoveryBanner(t, appQueryClient(), () =>
    client.request("/api/search", { method: "POST", body: { text: "query" } }));

  // The client never repeats a POST, so the query's two retries are the only ones. TanStack Query counts failures
  // from zero, so transientQueryRetryDelay gives each of them one second.
  const outcome = `${requests} requests, failed after ${elapsedMs} ms`;
  assert.equal(requests, 3, outcome);
  assert.ok(elapsedMs >= 2_000 && elapsedMs < 2_100, outcome);
});
