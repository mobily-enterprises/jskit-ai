import assert from "node:assert/strict";
import test from "node:test";
import { createAuthActionContextContributor } from "../src/server/lib/actionContextContributor.js";

test("auth action context contributor skips empty placeholder values", () => {
  const contributor = createAuthActionContextContributor();

  const contribution = contributor.contribute({
    request: {
      user: null,
      workspace: null,
      membership: null,
      permissions: []
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
      roleId: "owner"
    },
    permissions: ["workspace.settings.update", "", "  "]
  };

  const contribution = contributor.contribute({ request });

  assert.deepEqual(contribution, {
    actor: request.user,
    workspace: request.workspace,
    membership: request.membership,
    permissions: ["workspace.settings.update"]
  });
});
