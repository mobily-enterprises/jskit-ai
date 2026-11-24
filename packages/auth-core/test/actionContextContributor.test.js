import assert from "node:assert/strict";
import test from "node:test";
import { createAuthActionContextContributor } from "../src/server/lib/actionContextContributor.js";

test("auth action context contributor skips empty placeholder values", () => {
  const contributor = createAuthActionContextContributor();

  const contribution = contributor.contribute({
    context: {
      requestMeta: {
        request: {
          user: null,
          workspace: null,
          membership: null,
          permissions: []
        }
      }
    }
  });

  assert.deepEqual(contribution, {});
});

test("auth action context contributor contributes real request context values", () => {
  const contributor = createAuthActionContextContributor();

  const request = {
    user: {
      id: 7
    },
    workspace: {
      id: 11
    },
    membership: {
      roleSid: "owner"
    },
    permissions: ["workspace.settings.update", "", "  "]
  };

  const contribution = contributor.contribute({
    context: {
      requestMeta: { request }
    }
  });

  assert.deepEqual(contribution, {
    actor: request.user,
    workspace: request.workspace,
    membership: request.membership,
    permissions: ["workspace.settings.update"]
  });
});

test("a service key's call contributes the user it acts as as the actor, and the key as actingVia", () => {
  const contributor = createAuthActionContextContributor();
  const request = { user: { id: "7" }, actingVia: { userId: "1", name: "Mercbot" }, permissions: [] };
  assert.deepEqual(contributor.contribute({ context: { requestMeta: { request } } }), {
    actor: request.user,
    actingVia: { userId: "1", name: "Mercbot" }
  });
  assert.equal(Object.hasOwn(contributor.contribute({ context: { requestMeta: { request: { user: { id: "7" }, actingVia: null } } } }), "actingVia"), false);
});
