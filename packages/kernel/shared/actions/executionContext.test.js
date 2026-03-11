import assert from "node:assert/strict";
import test from "node:test";

import { normalizeExecutionContext } from "./executionContext.js";

test("normalizeExecutionContext preserves extra workspace fields", () => {
  const context = normalizeExecutionContext({
    workspace: {
      id: 7,
      slug: "team-alpha",
      name: "Team Alpha",
      ownerUserId: 42
    }
  });

  assert.equal(context.workspace.ownerUserId, 42);
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
