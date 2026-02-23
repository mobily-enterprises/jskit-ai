import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_INVITE_EXPIRY_DAYS, resolveInviteExpiresAt } from "../server/domain/workspace/policies/workspaceInvitePolicy.js";
import { isMysqlDuplicateEntryError } from "../server/lib/primitives/mysqlErrors.js";

test("workspace invite policy resolves default/custom invite expiry windows", () => {
  const now = Date.now();
  const defaultExpiryMs = Date.parse(resolveInviteExpiresAt());
  const customExpiryMs = Date.parse(resolveInviteExpiresAt(3));
  const invalidExpiryMs = Date.parse(resolveInviteExpiresAt(0));

  const defaultDays = (defaultExpiryMs - now) / (24 * 60 * 60 * 1000);
  const customDays = (customExpiryMs - now) / (24 * 60 * 60 * 1000);
  const invalidDays = (invalidExpiryMs - now) / (24 * 60 * 60 * 1000);

  assert.equal(DEFAULT_INVITE_EXPIRY_DAYS, 7);
  assert.equal(defaultDays > 6.9 && defaultDays <= 7.1, true);
  assert.equal(customDays > 2.9 && customDays <= 3.1, true);
  assert.equal(invalidDays > 6.9 && invalidDays <= 7.1, true);
});

test("mysql duplicate classifier recognizes ER_DUP_ENTRY only", () => {
  assert.equal(isMysqlDuplicateEntryError({ code: "ER_DUP_ENTRY" }), true);
  assert.equal(isMysqlDuplicateEntryError({ code: "ER_BAD_TABLE_ERROR" }), false);
  assert.equal(isMysqlDuplicateEntryError(null), false);
});
