import assert from "node:assert/strict";
import test from "node:test";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { createWorkspaceDirectoryActions } from "../src/server/workspaceDirectory/workspaceDirectoryActions.js";
import { createWorkspacePendingInvitationsActions } from "../src/server/workspacePendingInvitations/workspacePendingInvitationsActions.js";
import { createWorkspaceMembersActions } from "../src/server/workspaceMembers/workspaceMembersActions.js";
import { createWorkspaceSettingsActions } from "../src/server/workspaceSettings/workspaceSettingsActions.js";

// The definitions only; no test here executes an action.
const workspaceDirectoryActionSpecifications = createWorkspaceDirectoryActions({ workspaceService: {} });
const workspacePendingInvitationsActionSpecifications = createWorkspacePendingInvitationsActions({ workspacePendingInvitationsService: {} });
const workspaceMembersActionSpecifications = createWorkspaceMembersActions({ workspaceMembersService: {} });
const workspaceSettingsActionSpecifications = createWorkspaceSettingsActions({ workspaceSettingsService: {} });

test("workspace settings action specifications stay explicit", () => {
  assert.deepEqual(
    workspaceSettingsActionSpecifications.map((action) => action.id),
    ["workspace.settings.read", "workspace.settings.update"]
  );
  assert.deepEqual(workspaceSettingsActionSpecifications[0].surfaces, ["*"]);
  assert.deepEqual(workspaceSettingsActionSpecifications[1].surfaces, ["*"]);
  assert.deepEqual(workspaceSettingsActionSpecifications[1].channels, ["api", "assistant_tool", "automation", "internal"]);
  assert.equal(workspaceSettingsActionSpecifications[1].extensions?.assistant?.description, "Update the active workspace appearance and invitation settings.");
});

test("workspace actions array excludes workspace settings actions", () => {
  const otherWorkspaceActionIds = [
    ...workspaceDirectoryActionSpecifications,
    ...workspacePendingInvitationsActionSpecifications,
    ...workspaceMembersActionSpecifications
  ].map((action) => action.id);

  assert.equal(
    otherWorkspaceActionIds.includes("workspace.settings.read"),
    false
  );
  assert.equal(
    otherWorkspaceActionIds.includes("workspace.settings.update"),
    false
  );
});

test("workspace directory actions stay thin and defer output validation to routes", () => {
  const listAction = workspaceDirectoryActionSpecifications.find((action) => action.id === "workspace.workspaces.list");
  assert.ok(listAction);
  assert.equal(listAction.output, null);
});

test("workspace directory read/update actions stay thin and defer output validation to routes", () => {
  const readAction = workspaceDirectoryActionSpecifications.find((action) => action.id === "workspace.workspaces.read");
  const updateAction = workspaceDirectoryActionSpecifications.find((action) => action.id === "workspace.workspaces.update");

  assert.ok(readAction);
  assert.ok(updateAction);
  assert.equal(readAction.output, null);
  assert.equal(updateAction.output, null);
});

test("workspace mutation actions declare their domain and bootstrap changes explicitly", async () => {
  const context = {
    actor: { id: 7 },
    visibilityContext: { visibility: "workspace", scopeKind: "workspace", scopeOwnerId: 11 },
    requestMeta: {
      resolvedWorkspaceContext: {
        workspace: { id: 11, slug: "acme" }
      }
    }
  };
  const settingsAction = workspaceSettingsActionSpecifications.find(
    (action) => action.id === "workspace.settings.update"
  );
  const events = await Promise.all(settingsAction.events.map((builder) => builder({
    input: { workspaceSlug: "acme", invitesEnabled: true },
    result: returnJsonApiData({ invitesEnabled: true }),
    context
  })));

  assert.deepEqual(events.map((event) => event.realtime.event), [
    "workspace.settings.changed",
    "users.bootstrap.changed"
  ]);
  assert.deepEqual(events[0].scope, { kind: "workspace", id: "11" });
  assert.equal(events[0].entityId, "11");
  assert.deepEqual(events[0].realtime.payload, { workspaceSlug: "acme" });
});

test("making and changing a workspace are entity changes of the workspace, named by the id the action answers", async () => {
  const context = { actor: { id: 7 }, requestMeta: {} };
  const [create, update] = ["workspace.workspaces.create", "workspace.workspaces.update"]
    .map((id) => workspaceDirectoryActionSpecifications.find((action) => action.id === id));
  assert.deepEqual([create.events.length, update.events.length], [1, 1]);
  const [created] = await Promise.all(create.events.map((builder) => builder({
    input: { name: "Acme" },
    result: returnJsonApiData({ id: "11", slug: "acme", name: "Acme", ownerUserId: "7" }),
    context
  })));
  assert.deepEqual([created.type, created.source, created.entity, created.operation, created.entityId], ["entity.changed", "workspace", "workspace", "created", "11"]);
  assert.equal(created.realtime, undefined);
  const [updated] = await Promise.all(update.events.map((builder) => builder({
    input: { workspaceSlug: "acme", name: "Acme Ltd" },
    result: returnJsonApiData({ id: "11", slug: "acme", name: "Acme Ltd", ownerUserId: "7" }),
    context
  })));
  assert.deepEqual([updated.entity, updated.operation, updated.entityId], ["workspace", "updated", "11"]);
});

test("workspace invite actions reach the invite's recipient through the members service, once per event", async () => {
  const lookups = [];
  const [create, revoke] = ["workspace.invite.create", "workspace.invite.revoke"].map((id) => createWorkspaceMembersActions({
    workspaceMembersService: {
      async inviteRecipientUserIds(inviteId, options) {
        lookups.push({ inviteId, options });
        return ["55"];
      }
    }
  }).find((entry) => entry.id === id));
  const context = {
    actor: { id: 7 },
    visibilityContext: { visibility: "workspace", scopeKind: "workspace", scopeOwnerId: 11 },
    requestMeta: { resolvedWorkspaceContext: { workspace: { id: 11, slug: "acme" } } }
  };
  const created = await Promise.all(create.events.map((builder) => builder({
    input: { workspaceSlug: "acme", email: "reader@example.test", roleSid: "member" },
    result: returnJsonApiData({ createdInviteId: 91 }),
    context
  })));
  assert.equal(created[0].operation, "created");
  assert.equal(created[1].entityId, "91");
  assert.equal(created[1].realtime.audience.preset, "event_scope");
  const options = { context: { visibilityContext: { visibility: "workspace", scopeKind: "workspace", scopeOwnerId: "11" } } };
  assert.deepEqual(await created[1].realtime.audience.audienceUsers({ event: created[1], options }), ["55"]);
  assert.deepEqual(lookups, [{ inviteId: "91", options }]);

  const revoked = await Promise.all(revoke.events.map((builder) => builder({
    input: { workspaceSlug: "acme", inviteId: "92" },
    result: returnJsonApiData({ revokedInviteId: 92 }),
    context
  })));
  assert.equal(revoked[1].entityId, "92");
  await revoked[1].realtime.audience.audienceUsers({ event: revoked[1], options });
  assert.equal(lookups.at(-1).inviteId, "92");
});

test("accepting an invitation declares directory/member refresh while refusal does not", async () => {
  const action = workspacePendingInvitationsActionSpecifications.find(
    (entry) => entry.id === "workspace.invite.redeem"
  );
  async function emittedNames(decision) {
    const built = await Promise.all(action.events.map((builder) => builder({
      input: { decision, token: "opaque" },
      result: returnJsonApiData({ workspaceId: 11 }),
      context: { actor: { id: 7 } }
    })));
    return built.filter(Boolean).map((event) => event.realtime.event);
  }
  assert.deepEqual(await emittedNames("accept"), [
    "workspace.invitations.pending.changed",
    "users.bootstrap.changed",
    "workspaces.changed",
    "workspace.members.changed",
    "workspace.invites.changed"
  ]);
  assert.deepEqual(await emittedNames("refuse"), [
    "workspace.invitations.pending.changed",
    "users.bootstrap.changed",
    "workspace.invites.changed"
  ]);
});
