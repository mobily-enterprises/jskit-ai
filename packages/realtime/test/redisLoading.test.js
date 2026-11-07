import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Every module this process loads from here on; the realtime modules are imported after the hook.
const loadedUrls = [];
registerHooks({
  load(url, context, nextLoad) {
    loadedUrls.push(url);
    return nextLoad(url, context);
  }
});
const redisModules = () =>
  loadedUrls.filter((url) => /\/node_modules\/(?:redis|@redis\/[^/]+|@socket\.io\/redis-adapter)\//u.test(url));

test("a realtime server without Redis loads none of Redis's modules", async () => {
  const { RealtimeProvider } = await import("../src/server/RealtimeProvider.js");
  const { configureSocketIoRedisAdapter } = await import("../src/server/runtime.js");
  assert.equal(RealtimeProvider.provides.realtime, "runtime.realtime");

  const memory = await configureSocketIoRedisAdapter({ adapter() {} }, { redisUrl: "", logger: { warn() {} } });
  assert.equal(memory.enabled, false);
  assert.deepEqual(redisModules(), []);

  // The hook does see Redis when something loads it.
  await import("redis");
  assert.ok(redisModules().length > 0);
});
