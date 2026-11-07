import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

// The file connection store syncs every save to disk; in memory a sync is free, on an SSD it was the suite's largest
// cost. Every test directory comes from makeTestDirectory, which is in memory where the system offers it.
test("connector tests make their directories with makeTestDirectory, never in the disk-backed temporary directory", () => {
  const offenders = readdirSync(TEST_DIRECTORY)
    .filter((name) => name.endsWith(".js") && name !== path.basename(fileURLToPath(import.meta.url)))
    .filter((name) => /\b(?:mkdtemp|tmpdir)\(/.test(readFileSync(path.join(TEST_DIRECTORY, name), "utf8")));
  assert.deepEqual(offenders, []);
});
