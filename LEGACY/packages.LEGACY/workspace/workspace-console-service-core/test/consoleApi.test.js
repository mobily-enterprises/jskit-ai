import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/client/consoleApi.js";

test("consoleApi exposes console core methods only", async () => {
  const calls = [];
  const api = createApi({
    request: async (url, options = {}) => {
      calls.push({ url, options });
      return { ok: true };
    }
  });

  assert.deepEqual(Object.keys(api), [
    "bootstrap",
    "listRoles",
    "getSettings",
    "updateSettings",
    "listMembers",
    "updateMemberRole",
    "listInvites",
    "createInvite",
    "revokeInvite",
    "listPendingInvites",
    "redeemInvite"
  ]);

  await api.bootstrap();
  await api.updateMemberRole("member/7", { roleId: "console" });
  await api.redeemInvite({ token: "abc" });

  assert.equal(calls[0].url, "/api/console/bootstrap");
  assert.equal(calls[1].url, "/api/console/members/member%2F7/role");
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(calls[2].url, "/api/console/invitations/redeem");
  assert.equal(calls[2].options.method, "POST");
});
