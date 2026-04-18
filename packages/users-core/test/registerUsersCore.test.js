import assert from "node:assert/strict";
import test from "node:test";
import { registerUsersCore } from "../src/server/registerUsersCore.js";

test("registerUsersCore only binds users-core singletons", () => {
  const singletonTokens = [];
  const app = {
    singleton(token) {
      singletonTokens.push(String(token || ""));
      return this;
    }
  };

  registerUsersCore(app);

  assert.deepEqual(singletonTokens.sort(), [
    "users.profile.sync.service"
  ]);
});

test("registerUsersCore still works when action runtime has not installed actionSurfaceSource yet", () => {
  const app = {
    singleton() {
      return this;
    }
  };

  assert.doesNotThrow(() => registerUsersCore(app));
});
