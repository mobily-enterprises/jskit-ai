import assert from "node:assert/strict";
import test from "node:test";

import { runAuthSignOutFlow } from "../src/client/signOutFlow.js";

test("runAuthSignOutFlow executes logout then cleanup hooks", async () => {
  const calls = [];
  await runAuthSignOutFlow({
    authApi: {
      async logout() {
        calls.push("logout");
      }
    },
    clearCsrfTokenCache() {
      calls.push("clearCsrf");
    },
    async afterSignOut() {
      calls.push("afterSignOut");
    }
  });

  assert.deepEqual(calls, ["logout", "clearCsrf", "afterSignOut"]);
});

test("runAuthSignOutFlow runs cleanup hooks when logout fails and rethrows error", async () => {
  const calls = [];
  const expectedError = new Error("logout failed");

  await assert.rejects(
    () =>
      runAuthSignOutFlow({
        authApi: {
          async logout() {
            calls.push("logout");
            throw expectedError;
          }
        },
        clearCsrfTokenCache() {
          calls.push("clearCsrf");
        },
        async afterSignOut() {
          calls.push("afterSignOut");
        }
      }),
    expectedError
  );

  assert.deepEqual(calls, ["logout", "clearCsrf", "afterSignOut"]);
});

test("runAuthSignOutFlow validates authApi logout contract", async () => {
  await assert.rejects(
    () =>
      runAuthSignOutFlow({
        authApi: null
      }),
    /requires authApi/
  );

  await assert.rejects(
    () =>
      runAuthSignOutFlow({
        authApi: {}
      }),
    /requires authApi\.logout/
  );
});
