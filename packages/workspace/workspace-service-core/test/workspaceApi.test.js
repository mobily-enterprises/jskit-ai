import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/lib/client/workspaceApi.js";

test("workspaceApi exposes workspace core methods only", async () => {
  const calls = [];
  const api = createApi({
    request: async (url, options = {}) => {
      calls.push({ url, options });
      return { ok: true };
    }
  });

  assert.deepEqual(Object.keys(api), [
    "bootstrap",
    "list",
    "select",
    "listPendingInvites",
    "redeemInvite",
    "getSettings",
    "updateSettings",
    "listRoles",
    "listMembers",
    "updateMemberRole",
    "listInvites",
    "createInvite",
    "revokeInvite"
  ]);

  await api.bootstrap();
  await api.updateMemberRole("user/42", { roleId: "owner" });
  await api.revokeInvite("inv/123");

  assert.equal(calls[0].url, "/api/v1/bootstrap");
  assert.equal(calls[1].url, "/api/v1/admin/workspace/members/user%2F42/role");
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(calls[2].url, "/api/v1/admin/workspace/invites/inv%2F123");
  assert.equal(calls[2].options.method, "DELETE");
});
