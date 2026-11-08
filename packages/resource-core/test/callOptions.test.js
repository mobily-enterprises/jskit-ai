import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

test("passedOn hands on only the call's context and transaction", () => {
  const trx = { isTransaction: true };
  const context = { actor: { id: "7" } };
  const handedOn = passedOn({ context, trx, returning: "none", missing: "skip", format: "json:api" });
  assert.deepEqual(handedOn, { context, trx });
  assert.equal(Object.isFrozen(handedOn), true);
  assert.deepEqual(passedOn({ returning: "none" }), {});
  assert.deepEqual(passedOn({ context: null, trx: null }), { context: null });
});

test("callOptions imports nothing, so code without the table runtime installed can load it", async () => {
  const source = await readFile(new URL("../src/shared/callOptions.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^\s*(?:import|export\s[^;]*\bfrom)\b/mu);
});
