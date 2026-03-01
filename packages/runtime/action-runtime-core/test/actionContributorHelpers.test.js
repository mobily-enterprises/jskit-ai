import assert from "node:assert/strict";
import test from "node:test";

import { hasPermission } from "../src/shared/actionContributorHelpers.js";

test("hasPermission allows wildcard and direct matches", () => {
  assert.equal(hasPermission(["*"], "workspace.billing.manage"), true);
  assert.equal(hasPermission(["workspace.billing.manage"], "workspace.billing.manage"), true);
  assert.equal(hasPermission(["workspace.billing.read"], "workspace.billing.manage"), false);
});

test("hasPermission allows empty required permissions", () => {
  assert.equal(hasPermission([], ""), true);
  assert.equal(hasPermission([], null), true);
});
