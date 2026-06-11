import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("old workflow directory is removed from distributed agent docs", async () => {
  await assert.rejects(access(path.join(packageRoot, "workflow")));
});
