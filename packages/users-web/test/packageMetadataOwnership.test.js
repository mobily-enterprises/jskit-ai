import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("users-web publishes account examples as agent-readable patterns", async () => {
  assert.equal(packageJson.jskit?.mutations, undefined);

  const pattern = await readFile(path.join(packageRoot, "patterns", "account-settings", "PATTERN.md"), "utf8");
  assert.match(pattern, /## Product decisions/);
  assert.match(pattern, /## Invariants/);
  assert.match(pattern, /Mutation errors use the standard toast/);
  assert.match(pattern, /Loading uses layout-stable skeletons/);
  assert.match(pattern, /## Example files/);
});
