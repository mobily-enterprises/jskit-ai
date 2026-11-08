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

test("normalizeExecutionContext keeps a context's symbol-keyed markers and still normalizes its reserved fields", () => {
  const marker = Symbol("work marker");
  const context = normalizeExecutionContext({ [marker]: true, tenant: "a", actor: { id: 3 }, channel: "AUTOMATION" });

  assert.equal(context[marker], true);
  assert.equal(context.tenant, "a");
  assert.deepEqual(context.actor, { id: 3 });
  assert.equal(context.channel, "automation");
  assert.deepEqual(normalizeExecutionContext({ [marker]: true }).actor, null);
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
      roleSid: "OWNER",
      customFlag: true
    },
    membership: {
      roleSid: "OWNER",
      status: "ACTIVE",
      extra: "x"
    }
  });

  assert.deepEqual(context.actor, {
    id: "user_1",
    email: "UPPER@EXAMPLE.COM",
    roleSid: "OWNER",
    customFlag: true
  });
  assert.deepEqual(context.membership, {
    roleSid: "OWNER",
    status: "ACTIVE",
    extra: "x"
  });
});
