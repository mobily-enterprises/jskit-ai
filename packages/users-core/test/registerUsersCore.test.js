import assert from "node:assert/strict";
import test from "node:test";
import { registerUsersCore } from "../src/server/registerUsersCore.js";

test("registerUsersCore only binds users-core singletons", () => {
  const singletonTokens = [];
  const app = {
    has() {
      return false;
    },
    singleton(token) {
      singletonTokens.push(String(token || ""));
      return this;
    }
  };

  registerUsersCore(app);

  assert.deepEqual(singletonTokens.sort(), [
    "auth.profile.projector",
    "users.profile.sync.service"
  ]);
});

test("registerUsersCore still works when action runtime has not installed actionSurfaceSource yet", () => {
  const app = {
    has() {
      return false;
    },
    singleton() {
      return this;
    }
  };

  assert.doesNotThrow(() => registerUsersCore(app));
});

test("registerUsersCore preserves an existing auth profile projector", () => {
  const singletonTokens = [];
  const app = {
    has(token) {
      return token === "auth.profile.projector";
    },
    singleton(token) {
      singletonTokens.push(String(token || ""));
      return this;
    }
  };

  registerUsersCore(app);

  assert.deepEqual(singletonTokens, ["users.profile.sync.service"]);
});
