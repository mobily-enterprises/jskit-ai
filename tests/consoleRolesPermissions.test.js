import assert from "node:assert/strict";
import test from "node:test";

import { CONSOLE_BILLING_PERMISSIONS, resolveRolePermissions } from "../server/domain/console/policies/roles.js";

test("devop console role includes billing event explorer read permission", () => {
  const permissions = resolveRolePermissions("devop");
  assert.ok(Array.isArray(permissions));
  assert.ok(permissions.includes(CONSOLE_BILLING_PERMISSIONS.READ_ALL));
});
