import assert from "node:assert/strict";
import test from "node:test";
import { readPendingInvites } from "../src/client/lib/pendingInvites.js";

const entry = { id: "1", workspaceId: "2", workspaceSlug: "acme", token: "secret" };

test("readPendingInvites offers nothing while invitations are switched off", () => {
  assert.deepEqual(readPendingInvites({ pendingInvites: [entry] }, false), []);
});

test("readPendingInvites fills what a listed invitation leaves out", () => {
  assert.deepEqual(readPendingInvites({ pendingInvites: [entry] }, true), [
    {
      id: "1",
      token: "secret",
      workspaceId: "2",
      workspaceSlug: "acme",
      workspaceName: "acme",
      workspaceAvatarUrl: "",
      roleSid: "member",
      roleLabel: "",
      status: "pending",
      expiresAt: ""
    }
  ]);
});

test("readPendingInvites drops an invitation nobody could answer", () => {
  const unanswerable = [null, "text", { ...entry, id: "" }, { ...entry, workspaceSlug: " " }, { ...entry, token: "" }];

  assert.deepEqual(readPendingInvites({ pendingInvites: unanswerable }, true), []);
  assert.deepEqual(readPendingInvites({}, true), []);
  assert.deepEqual(readPendingInvites(null, true), []);
});
