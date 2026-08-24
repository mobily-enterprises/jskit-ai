import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workspaces-web publishes editable workspace surfaces as an agent-readable pattern", async () => {
  assert.equal(packageJson.jskit?.mutations, undefined);
  const pattern = await readFile(path.join(packageRoot, "patterns", "workspace-surfaces", "PATTERN.md"), "utf8");

  assert.match(pattern, /## Product decisions/);
  assert.match(pattern, /## Invariants/);
  assert.match(pattern, /Loading uses skeletons/);
  assert.match(pattern, /mutation failures use toasts/);
  assert.match(pattern, /## Example files/);
});
