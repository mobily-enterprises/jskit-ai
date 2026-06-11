import assert from "node:assert/strict";
import test from "node:test";
import { createSignOutAction } from "../src/client/runtime/useSignOut.js";

function createJsonResponse(payload = {}, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? "application/json" : null;
      }
    },
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test("createSignOutAction clears the session cleanly and routes back to login with returnTo", async () => {
  const fetchCalls = [];
  const goToEntryCalls = [];
  const originalFetch = globalThis.fetch;
  let sessionReads = 0;

  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({
      url,
      method: String(options.method || "GET").toUpperCase()
    });

    const normalizedUrl = String(url || "");
    const normalizedMethod = String(options.method || "GET").toUpperCase();

    if (normalizedUrl === "/api/session" && normalizedMethod === "GET") {
      sessionReads += 1;
      return createJsonResponse(
        sessionReads === 1
          ? { authenticated: true, csrfToken: "csrf-a" }
          : { authenticated: false, csrfToken: "csrf-b" }
      );
    }

    if (normalizedUrl === "/api/logout" && normalizedMethod === "POST") {
      return createJsonResponse({ ok: true });
    }

    throw new Error(`Unexpected fetch call: ${normalizedMethod} ${normalizedUrl}`);
  };

  try {
    const authGuardRuntime = {
      async initialize() {
        return {
          authenticated: false
        };
      },
      async refresh() {
        return {
          authenticated: false
        };
      },
      getState() {
        return {
          authenticated: false
        };
      }
    };

    const signOut = createSignOutAction({
      currentSurface: {
        value: "/w/acme/workouts/2026-05-07"
      },
      goToEntry: async ({ resolvedRoute }) => {
        goToEntryCalls.push(resolvedRoute);
      },
      authGuardRuntime
    });

    await signOut();

    assert.deepEqual(fetchCalls, [
      { url: "/api/session", method: "GET" },
      { url: "/api/logout", method: "POST" },
      { url: "/api/session", method: "GET" }
    ]);
    assert.deepEqual(goToEntryCalls, [
      "/auth/login?returnTo=%2Fw%2Facme%2Fworkouts%2F2026-05-07"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
