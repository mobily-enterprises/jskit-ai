import assert from "node:assert/strict";
import test from "node:test";
import { workspaceDirectoryActionSpecifications } from "../src/server/workspaceDirectory/workspaceDirectoryActions.js";
import { workspacePendingInvitationsActionSpecifications } from "../src/server/workspacePendingInvitations/workspacePendingInvitationsActions.js";
import { workspaceMembersActionSpecifications } from "../src/server/workspaceMembers/workspaceMembersActions.js";
import { workspaceSettingsActionSpecifications } from "../src/server/workspaceSettings/workspaceSettingsActions.js";

test("workspace settings action specifications stay explicit", () => {
  assert.deepEqual(
    workspaceSettingsActionSpecifications.map((action) => action.id),
    ["workspace.settings.read", "workspace.settings.update"]
  );
  assert.deepEqual(workspaceSettingsActionSpecifications[0].surfaces, ["*"]);
  assert.deepEqual(workspaceSettingsActionSpecifications[1].surfaces, ["*"]);
  assert.deepEqual(workspaceSettingsActionSpecifications[1].channels, ["api", "assistant_tool", "automation", "internal"]);
  assert.equal(workspaceSettingsActionSpecifications[1].extensions?.assistant?.description, "Update workspace settings.");
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
    result: { value: { invitesEnabled: true } },
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

test("workspace invite actions carry recipient lookup as delivery policy, not service metadata", async () => {
  const action = workspaceMembersActionSpecifications.find((entry) => entry.id === "workspace.invite.create");
  const context = {
    actor: { id: 7 },
    visibilityContext: { visibility: "workspace", scopeKind: "workspace", scopeOwnerId: 11 },
    requestMeta: { resolvedWorkspaceContext: { workspace: { id: 11, slug: "acme" } } }
  };
  const events = await Promise.all(action.events.map((builder) => builder({
    input: { workspaceSlug: "acme", email: "reader@example.test", roleSid: "member" },
    result: { value: { createdInviteId: 91 } },
    context
  })));
  assert.equal(events[0].operation, "created");
  assert.equal(events[1].entityId, "91");
  assert.equal(typeof events[1].realtime.audience.userQuery, "function");
  const rows = await events[1].realtime.audience.userQuery({
    event: events[1],
    knex() {
      return {
        join() { return this; },
        where(field, value) {
          assert.equal(field, "wi.id");
          assert.equal(value, "91");
          return this;
        },
        async first() { return { user_id: 55 }; }
      };
    }
  });
  assert.deepEqual(rows, [{ userId: "55" }]);
});

test("accepting an invitation declares directory/member refresh while refusal does not", async () => {
  const action = workspacePendingInvitationsActionSpecifications.find(
    (entry) => entry.id === "workspace.invite.redeem"
  );
  async function emittedNames(decision) {
    const built = await Promise.all(action.events.map((builder) => builder({
      input: { decision, token: "opaque" },
      result: { value: { workspaceId: 11 } },
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
