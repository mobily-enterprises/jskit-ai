import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { REDIS_URL_ENV_KEY } from "../src/server/runtime.js";

test("realtime application pattern keeps Redis and placement explicit", async () => {
  const root = new URL("../patterns/realtime-application/", import.meta.url);
  const [pattern, envExample, placement] = await Promise.all([
    readFile(new URL("PATTERN.md", root), "utf8"),
    readFile(new URL("example/.env.example", root), "utf8"),
    readFile(new URL("example/src/placement.js", root), "utf8")
  ]);
  const source = [pattern, envExample, placement].join("\n");

  // The setting the example and the pattern name is the one the runtime reads.
  assert.deepEqual(envExample.split("\n").filter((line) => line.trim() && !line.startsWith("#")), [`${REDIS_URL_ENV_KEY}=`]);
  assert.match(pattern, new RegExp(`\`${REDIS_URL_ENV_KEY}\``, "u"));
  assert.match(source, /realtime\.connection\.indicator/u);
  assert.doesNotMatch(source, /promptLabel|promptHint|\$\{option:/u);
});
