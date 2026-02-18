import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { updateReadmeApiContracts } from "../server/lib/readmeApiContracts.js";

test("README API contracts inventory matches route surface", () => {
  const readmePath = new URL("../README.md", import.meta.url);
  const current = readFileSync(readmePath, "utf8");
  const expected = updateReadmeApiContracts(current);

  assert.equal(current, expected, "README API contracts are out of sync. Run `npm run docs:api-contracts`.");
});
