import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("realtime application pattern keeps Redis and placement explicit", async () => {
  const root = new URL("../patterns/realtime-application/", import.meta.url);
  const source = await Promise.all([
    readFile(new URL("PATTERN.md", root), "utf8"),
    readFile(new URL("example/.env.example", root), "utf8"),
    readFile(new URL("example/src/placement.js", root), "utf8")
  ]).then((parts) => parts.join("\n"));

  assert.match(source, /REALTIME_REDIS_URL/u);
  assert.match(source, /realtime\.connection\.indicator/u);
  assert.doesNotMatch(source, /promptLabel|promptHint|\$\{option:/u);
});
