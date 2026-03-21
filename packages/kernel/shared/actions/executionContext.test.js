import assert from "node:assert/strict";
import test from "node:test";

import { normalizeExecutionContext } from "./executionContext.js";

test("normalizeExecutionContext preserves non-core context fields", () => {
  const context = normalizeExecutionContext({
    tenant: {
      id: 7,
      slug: "team-alpha",
      ownerUserId: 42
    }
  });

  assert.equal(context.tenant.ownerUserId, 42);
});

test("normalizeExecutionContext keeps custom requestMeta fields", () => {
  const resolvedWorkspaceContext = {
    workspace: {
      id: 7,
      ownerUserId: 42
    }
  };

  const context = normalizeExecutionContext({
    requestMeta: {
      resolvedWorkspaceContext
    }
  });

  assert.deepEqual(context.requestMeta.resolvedWorkspaceContext, resolvedWorkspaceContext);
});

test("normalizeExecutionContext leaves surface empty when missing", () => {
  const context = normalizeExecutionContext({});
  assert.equal(context.surface, "");
});

test("normalizeExecutionContext keeps actor payload generic", () => {
  const context = normalizeExecutionContext({
    actor: {
      id: "user_1",
      email: "UPPER@EXAMPLE.COM",
      roleId: "OWNER",
      customFlag: true
    },
    membership: {
      roleId: "OWNER",
      status: "ACTIVE",
      extra: "x"
    }
  });

  assert.deepEqual(context.actor, {
    id: "user_1",
    email: "UPPER@EXAMPLE.COM",
    roleId: "OWNER",
    customFlag: true
  });
  assert.deepEqual(context.membership, {
    roleId: "OWNER",
    status: "ACTIVE",
    extra: "x"
  });
});
