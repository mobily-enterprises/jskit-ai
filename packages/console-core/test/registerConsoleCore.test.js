import assert from "node:assert/strict";
import test from "node:test";
import { registerConsoleCore } from "../src/server/registerConsoleCore.js";

test("registerConsoleCore registers the console action surface alias when action runtime is available", () => {
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

  registerConsoleCore(app);

  assert.deepEqual(calls, [
    {
      sourceName: "console",
      resolverType: "function"
    }
  ]);
});

test("registerConsoleCore still works when action runtime has not installed actionSurfaceSource yet", () => {
  const app = {
    singleton() {
      return this;
    }
  };

  assert.doesNotThrow(() => registerConsoleCore(app));
});
