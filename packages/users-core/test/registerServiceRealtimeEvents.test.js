import assert from "node:assert/strict";
import test from "node:test";
import { registerAccountProfile } from "../src/server/accountProfile/registerAccountProfile.js";
import { registerAccountPreferences } from "../src/server/accountPreferences/registerAccountPreferences.js";
import { registerAccountNotifications } from "../src/server/accountNotifications/registerAccountNotifications.js";
import { registerConsoleSettings } from "../src/server/consoleSettings/registerConsoleSettings.js";
import { registerWorkspaceMembers } from "../src/server/workspaceMembers/registerWorkspaceMembers.js";
import { registerWorkspacePendingInvitations } from "../src/server/workspacePendingInvitations/registerWorkspacePendingInvitations.js";

function createAppDouble() {
  const serviceCalls = [];

  return {
    serviceCalls,
    app: {
      singleton() {
        return this;
      },
      service(token, factory, metadata) {
        serviceCalls.push({
          token,
          factory,
          metadata
        });
        return this;
      },
      actions() {
        return this;
      }
    }
  };
}

function findServiceCall(serviceCalls, token) {
  return serviceCalls.find((entry) => entry.token === token) || null;
}

test("account register functions publish account.settings.changed for update operations", () => {
  const profileApp = createAppDouble();
  registerAccountProfile(profileApp.app);
  const profile = findServiceCall(profileApp.serviceCalls, "users.accountProfile.service");
  assert.equal(profile?.metadata?.events?.updateProfile?.[0]?.realtime?.event, "account.settings.changed");
  assert.equal(profile?.metadata?.events?.updateProfile?.[1]?.realtime?.event, "users.bootstrap.changed");
  assert.equal(profile?.metadata?.events?.uploadAvatar?.[0]?.realtime?.event, "account.settings.changed");
  assert.equal(profile?.metadata?.events?.uploadAvatar?.[1]?.realtime?.event, "users.bootstrap.changed");
  assert.equal(profile?.metadata?.events?.deleteAvatar?.[0]?.realtime?.event, "account.settings.changed");
  assert.equal(profile?.metadata?.events?.deleteAvatar?.[1]?.realtime?.event, "users.bootstrap.changed");

  const preferencesApp = createAppDouble();
  registerAccountPreferences(preferencesApp.app);
  const preferences = findServiceCall(preferencesApp.serviceCalls, "users.accountPreferences.service");
  assert.equal(preferences?.metadata?.events?.updatePreferences?.[0]?.realtime?.event, "account.settings.changed");
  assert.equal(preferences?.metadata?.events?.updatePreferences?.[1]?.realtime?.event, "users.bootstrap.changed");

  const notificationsApp = createAppDouble();
  registerAccountNotifications(notificationsApp.app);
  const notifications = findServiceCall(notificationsApp.serviceCalls, "users.accountNotifications.service");
  assert.equal(notifications?.metadata?.events?.updateNotifications?.[0]?.realtime?.event, "account.settings.changed");
  assert.equal(notifications?.metadata?.events?.updateNotifications?.[1]?.realtime?.event, "users.bootstrap.changed");
});

test("console settings register publishes console.settings.changed", () => {
  const payload = createAppDouble();
  registerConsoleSettings(payload.app);
  const consoleSettings = findServiceCall(payload.serviceCalls, "users.console.settings.service");
  assert.equal(consoleSettings?.metadata?.events?.updateSettings?.[0]?.realtime?.event, "console.settings.changed");
});

test("workspace register functions publish members/invites/workspace-list realtime events", async () => {
  const membersApp = createAppDouble();
  registerWorkspaceMembers(membersApp.app);
  const members = findServiceCall(membersApp.serviceCalls, "users.workspace.members.service");
  assert.equal(members?.metadata?.events?.updateMemberRole?.[0]?.realtime?.event, "workspace.members.changed");
  assert.equal(members?.metadata?.events?.updateMemberRole?.[1]?.realtime?.event, "users.bootstrap.changed");
  assert.equal(members?.metadata?.events?.removeMember?.[0]?.realtime?.event, "workspace.members.changed");
  assert.equal(members?.metadata?.events?.removeMember?.[1]?.realtime?.event, "users.bootstrap.changed");
  assert.equal(members?.metadata?.events?.createInvite?.[0]?.realtime?.event, "workspace.invites.changed");
  assert.equal(members?.metadata?.events?.createInvite?.[1]?.realtime?.event, "users.bootstrap.changed");
  assert.equal(members?.metadata?.events?.createInvite?.[1]?.entityId?.({ result: { createdInviteId: 91 } }), 91);
  assert.equal(members?.metadata?.events?.createInvite?.[1]?.realtime?.audience?.preset, "event_scope");
  assert.equal(typeof members?.metadata?.events?.createInvite?.[1]?.realtime?.audience?.userQuery, "function");
  const createInviteAudienceQueryResult = await members?.metadata?.events?.createInvite?.[1]?.realtime?.audience?.userQuery({
    knex() {
      return {
        join() {
          return this;
        },
        where(field, value) {
          assert.equal(field, "wi.id");
          assert.equal(value, 91);
          return this;
        },
        async first() {
          return {
            user_id: 55
          };
        }
      };
    },
    event: {
      entityId: 91
    }
  });
  assert.deepEqual(createInviteAudienceQueryResult, [{ userId: 55 }]);
  assert.equal(members?.metadata?.events?.revokeInvite?.[0]?.realtime?.event, "workspace.invites.changed");
  assert.equal(members?.metadata?.events?.revokeInvite?.[1]?.realtime?.event, "users.bootstrap.changed");
  assert.equal(members?.metadata?.events?.revokeInvite?.[1]?.entityId?.({ result: { revokedInviteId: 19 } }), 19);
  assert.equal(members?.metadata?.events?.revokeInvite?.[1]?.realtime?.audience?.preset, "event_scope");
  assert.equal(typeof members?.metadata?.events?.revokeInvite?.[1]?.realtime?.audience?.userQuery, "function");

  const pendingApp = createAppDouble();
  registerWorkspacePendingInvitations(pendingApp.app);
  const pending = findServiceCall(pendingApp.serviceCalls, "users.workspace.pending-invitations.service");
  const acceptInviteEvents = Array.isArray(pending?.metadata?.events?.acceptInviteByToken)
    ? pending.metadata.events.acceptInviteByToken
    : [];
  const acceptInviteRealtimeEvents = acceptInviteEvents.map((entry) => entry?.realtime?.event).filter(Boolean);
  assert.ok(acceptInviteRealtimeEvents.includes("workspace.invitations.pending.changed"));
  assert.ok(acceptInviteRealtimeEvents.includes("users.bootstrap.changed"));
  assert.ok(acceptInviteRealtimeEvents.includes("workspaces.changed"));
  assert.ok(acceptInviteRealtimeEvents.includes("workspace.members.changed"));
  assert.ok(acceptInviteRealtimeEvents.includes("workspace.invites.changed"));

  const acceptedMembersChange = acceptInviteEvents.find(
    (entry) => entry?.realtime?.event === "workspace.members.changed"
  );
  assert.equal(acceptedMembersChange?.entityId?.({ result: { workspaceId: 9 } }), 9);
  assert.deepEqual(
    acceptedMembersChange?.realtime?.audience?.({
      event: {
        entityId: 9
      }
    }),
    {
      workspaceId: 9
    }
  );

  const acceptedInvitesChange = acceptInviteEvents.find(
    (entry) => entry?.realtime?.event === "workspace.invites.changed"
  );
  assert.equal(acceptedInvitesChange?.entityId?.({ result: { workspaceId: 9 } }), 9);

  const refuseInviteEvents = Array.isArray(pending?.metadata?.events?.refuseInviteByToken)
    ? pending.metadata.events.refuseInviteByToken
    : [];
  const refuseInviteRealtimeEvents = refuseInviteEvents.map((entry) => entry?.realtime?.event).filter(Boolean);
  assert.ok(refuseInviteRealtimeEvents.includes("workspace.invitations.pending.changed"));
  assert.ok(refuseInviteRealtimeEvents.includes("users.bootstrap.changed"));
  assert.ok(refuseInviteRealtimeEvents.includes("workspace.invites.changed"));
});
