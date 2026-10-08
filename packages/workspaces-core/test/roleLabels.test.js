import assert from "node:assert/strict";
import test from "node:test";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { createWorkspaceRoleCatalog, cloneWorkspaceRoleCatalog, listRoleDescriptors } from "../src/shared/roles.js";
import { workspaceMembersResource } from "../src/shared/resources/workspaceMembersResource.js";
import { workspaceSettingsResource, WORKSPACE_SETTINGS_FIELD_KEYS } from "../src/shared/resources/workspaceSettingsResource.js";
import { workspacePendingInvitationsResource } from "../src/shared/resources/workspacePendingInvitationsResource.js";
import { createService as createMembersService } from "../src/server/workspaceMembers/workspaceMembersService.js";
import { createService as createSettingsService } from "../src/server/workspaceSettings/workspaceSettingsService.js";
import { createService as createPendingService } from "../src/server/workspacePendingInvitations/workspacePendingInvitationsService.js";
import { renderDefaultWorkspaceInviteEmail } from "../src/server/workspaceMembers/defaultWorkspaceInviteEmail.js";

const config = {
  roleCatalog: {
    workspace: { defaultInviteRole: "worker" },
    roles: {
      owner: { label: "Owner", assignable: true, permissions: ["*"] },
      worker: { label: " Member ", assignable: true, permissions: ["training.view"] },
      safety_manager: { label: "Operator", assignable: true, inherits: "worker", permissions: ["training.manage"] },
      administrator: { label: "Controller", assignable: true, inherits: "safety_manager", permissions: ["workspace.members.manage"] },
      training_assessor: { label: "Training assessor", assignable: true, permissions: ["training.assess"] }
    }
  }
};
const catalog = createWorkspaceRoleCatalog(config);
const workspace = { id: "7", slug: "example", name: "Example", ownerUserId: "9", avatarUrl: "" };
const expectedLabels = ["Owner", "Member", "Operator", "Controller", "Training assessor"];

function output(resource, operation, value) {
  return validateSchemaPayload(resource.operations[operation].output, value, { phase: "output" });
}

test("configured labels survive creation, cloning and listing without changing role policy", () => {
  for (const roles of [catalog.roles, cloneWorkspaceRoleCatalog(catalog).roles, listRoleDescriptors(config)]) {
    assert.deepEqual(roles.map((role) => role.label), expectedLabels);
    assert.equal(roles[0].assignable, false);
    assert.deepEqual(roles[2].permissions, ["training.view", "training.manage"]);
    assert.deepEqual(roles[4].permissions, ["training.assess"]);
  }
  assert.equal(catalog.defaultInviteRole, "worker");
  assert.equal(catalog.assignableRoleIds.includes("owner"), false);
  assert.equal(Object.isFrozen(catalog.roles[1]), true);
  const clone = cloneWorkspaceRoleCatalog(catalog);
  clone.roles[1].label = "Edited";
  assert.equal(catalog.roles[1].label, "Member");
});

test("missing, whitespace and non-string labels retain the original descriptor shape", () => {
  const roles = createWorkspaceRoleCatalog({ roleCatalog: { roles: {
    member: { assignable: true, permissions: [] },
    blank: { label: "   ", permissions: [] },
    invalid: { label: 123, permissions: [] }
  } } }).roles;
  assert.equal(roles.every((role) => !Object.hasOwn(role, "label")), true);
  assert.deepEqual(cloneWorkspaceRoleCatalog({ roles }).roles, roles);
});

test("Members and Invitations response validation preserves labels and saved role IDs", async () => {
  let savedRole = "worker";
  const service = createMembersService({
    roleCatalog: catalog,
    inviteExpiresInMs: 60_000,
    workspaceMembershipsRepository: {
      async listActiveByWorkspaceId() {
        return [{ userId: "11", roleSid: savedRole, status: "active", displayName: "Person", email: "person@example.com" }];
      },
      async findByWorkspaceIdAndUserId() { return { userId: "11", roleSid: savedRole, status: "active" }; },
      async upsertMembership(_workspaceId, _userId, patch) { savedRole = patch.roleSid; }
    },
    workspaceInvitesRepository: { async listPendingByWorkspaceIdWithWorkspace() { return []; } }
  });
  for (const roleSid of ["worker", "safety_manager", "administrator", "training_assessor"]) {
    await service.updateMemberRole(workspace, { memberUserId: "11", roleSid });
    const reloaded = output(workspaceMembersResource, "membersList", await service.listMembers(workspace));
    assert.equal(savedRole, roleSid);
    assert.equal(reloaded.members[0].roleSid, roleSid);
    assert.deepEqual(reloaded.roleCatalog.roles.map((role) => role.label), expectedLabels);
  }
  const roles = output(workspaceMembersResource, "rolesList", await service.listRoles());
  assert.deepEqual(roles.roles.map((role) => role.label), expectedLabels);
  const invites = output(workspaceMembersResource, "invitesList", await service.listInvites(workspace));
  assert.deepEqual(invites.roleCatalog.roles.map((role) => role.label), expectedLabels);
  await assert.rejects(service.updateMemberRole(workspace, { memberUserId: "11", roleSid: "Controller" }), /Validation failed/);
  await assert.rejects(service.updateMemberRole(workspace, { memberUserId: "11", roleSid: "owner" }), /Validation failed/);
});

test("Workspace Settings response validation preserves configured labels", async () => {
  const service = createSettingsService({
    roleCatalog: catalog,
    workspaceSettingsRepository: {
      async ensureForWorkspaceId() {
        return { ...Object.fromEntries(WORKSPACE_SETTINGS_FIELD_KEYS.map((key) => [key, "#123456"])), invitesEnabled: true };
      }
    }
  });
  const response = output(workspaceSettingsResource, "view", await service.getWorkspaceSettings(workspace, {
    context: { actor: { id: "9" }, permissions: ["workspace.settings.view"] }
  }));
  assert.deepEqual(response.roleCatalog.roles.map((role) => role.label), expectedLabels);
});

test("pending and resolved invitation responses derive labels while acceptance stores the role ID", async () => {
  const tokenHash = "a".repeat(64);
  const token = encodeInviteTokenHash(tokenHash);
  const invite = { id: "10", workspaceId: "7", workspaceSlug: "example", workspaceName: "Example", roleSid: "safety_manager", status: "pending", email: "person@example.com", expiresAt: "2099-01-01T00:00:00.000Z", tokenHash };
  let membership;
  const service = createPendingService({
    roleCatalog: catalog,
    workspaceInvitesRepository: {
      async listPendingByEmail() { return [invite]; },
      async findByTokenHashWithWorkspace() { return invite; },
      async findPendingByTokenHash() { return invite; },
      async withTransaction(work) { return work({}); },
      async markAcceptedById() {}
    },
    workspaceMembershipsRepository: { async upsertMembership(_workspaceId, _userId, patch) { membership = patch; } }
  });
  const user = { id: "11", email: invite.email };
  const pending = output(workspacePendingInvitationsResource, "list", { pendingInvites: await service.listPendingInvitesForUser(user) });
  const resolved = output(workspacePendingInvitationsResource, "resolve", await service.resolveInviteByToken(token));
  assert.equal(pending.pendingInvites[0].roleLabel, "Operator");
  assert.equal(resolved.roleLabel, "Operator");
  assert.equal(resolved.roleSid, "safety_manager");
  await service.acceptInviteByToken({ user, token });
  assert.deepEqual(membership, { roleSid: "safety_manager", status: "active" });
  assert.equal(Object.hasOwn(invite, "roleLabel"), false);
});

test("default invitation email uses the configured label with HTML escaping and the original fallback", () => {
  const labelled = renderDefaultWorkspaceInviteEmail({ roleSid: "worker", roleLabel: " Member <team> " });
  assert.match(labelled.text, /as Member <team>/u);
  assert.match(labelled.html, /as Member &lt;team&gt;/u);
  assert.match(renderDefaultWorkspaceInviteEmail({ roleSid: "worker" }).text, /as worker/u);
});
