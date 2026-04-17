import assert from "node:assert/strict";
import test from "node:test";
import { registerUsersCore } from "../src/server/registerUsersCore.js";

test("registerUsersCore registers the workspace action surface alias when action runtime is available", () => {
  const calls = [];
  const app = {
    singleton() {
      return this;
    },
    actionSurfaceSource(sourceName, resolver) {
      calls.push({
        sourceName: String(sourceName || ""),
        resolverType: typeof resolver
      });
      return this;
    }
  };

  registerUsersCore(app);

  assert.deepEqual(calls, [
    {
      sourceName: "workspace",
      resolverType: "function"
    }
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
