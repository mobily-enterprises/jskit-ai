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

test("normalizeExecutionContext defaults surface to public when missing", () => {
  const context = normalizeExecutionContext({});
  assert.equal(context.surface, "public");
});
