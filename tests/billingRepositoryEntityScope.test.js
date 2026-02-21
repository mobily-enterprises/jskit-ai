import assert from "node:assert/strict";
import test from "node:test";

import { __testables } from "../server/modules/billing/repository.js";

const { mapBillableEntityRowNullable, normalizeBillableEntityType } = __testables;

test("billing repository maps nullable workspace/owner fields for non-workspace entities", () => {
  const mapped = mapBillableEntityRowNullable({
    id: 55,
    entity_type: "user",
    entity_ref: "user:12",
    workspace_id: null,
    owner_user_id: 12,
    status: "active",
    created_at: "2026-02-21 12:00:00.000",
    updated_at: "2026-02-21 12:01:00.000"
  });

  assert.equal(mapped.id, 55);
  assert.equal(mapped.entityType, "user");
  assert.equal(mapped.entityRef, "user:12");
  assert.equal(mapped.workspaceId, null);
  assert.equal(mapped.ownerUserId, 12);
  assert.equal(mapped.status, "active");
  assert.ok(typeof mapped.createdAt === "string" && mapped.createdAt.endsWith("Z"));
  assert.ok(typeof mapped.updatedAt === "string" && mapped.updatedAt.endsWith("Z"));
});

test("billing repository normalizes unknown billable entity types to workspace", () => {
  assert.equal(normalizeBillableEntityType("workspace"), "workspace");
  assert.equal(normalizeBillableEntityType("USER"), "user");
  assert.equal(normalizeBillableEntityType("unknown_type"), "workspace");
});
