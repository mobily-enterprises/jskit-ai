import assert from "node:assert/strict";
import test from "node:test";
import {
  latestPage,
  normalizeInvites,
  normalizeMembers,
  normalizeRoleCatalog
} from "../src/client/lib/workspaceMembersPayloads.js";

test("normalizeRoleCatalog reads a wrapped or bare catalog and labels each assignable role", () => {
  const catalog = {
    roles: [{ id: "Member", label: " Team member ", assignable: true }, { id: "owner", assignable: false }],
    assignableRoleIds: ["member", " MEMBER ", "viewer"],
    defaultInviteRole: " Member "
  };

  for (const payload of [catalog, { roleCatalog: catalog }]) {
    const normalized = normalizeRoleCatalog(payload);
    assert.deepEqual(normalized.roleOptions, [
      { title: "Team member", value: "member" },
      { title: "Viewer", value: "viewer" }
    ]);
    assert.equal(normalized.roleLabels.member, "Team member");
    assert.equal(normalized.defaultInviteRole, "member");
  }
});

test("normalizeRoleCatalog falls back to the roles marked assignable", () => {
  const normalized = normalizeRoleCatalog({
    roles: [{ id: "member", assignable: true }, { id: "owner", assignable: false }]
  });

  assert.deepEqual(normalized.roleOptions, [{ title: "Member", value: "member" }]);
  assert.deepEqual(normalizeRoleCatalog(null).roleOptions, []);
});

test("members and invites keep only what the page shows, in normal form", () => {
  assert.deepEqual(normalizeMembers([{ userId: 7, roleSid: " Admin ", email: " ADA@EXAMPLE.COM ", isOwner: 1 }]), [
    { userId: "7", roleSid: "admin", status: "", displayName: "", email: "ada@example.com", isOwner: true }
  ]);
  assert.deepEqual(normalizeInvites([{ id: 9, email: "A@B.C", roleSid: "Member", expiresAt: "2099-01-01" }]), [
    { id: "9", email: "a@b.c", roleSid: "member", status: "", expiresAt: "2099-01-01", invitedByUserId: null }
  ]);
  assert.deepEqual(normalizeMembers(null), []);
  assert.deepEqual(normalizeInvites(null), []);
});

test("latestPage is the last page, or nothing", () => {
  assert.equal(latestPage(["first", "last"]), "last");
  assert.equal(latestPage([]), null);
  assert.equal(latestPage(null), null);
});
