import assert from "node:assert/strict";
import test from "node:test";
import { registerAccountProfile } from "../src/server/accountProfile/registerAccountProfile.js";
import { registerAccountPreferences } from "../src/server/accountPreferences/registerAccountPreferences.js";
import { registerAccountNotifications } from "../src/server/accountNotifications/registerAccountNotifications.js";
import { registerConsoleSettings } from "../src/server/consoleSettings/registerConsoleSettings.js";
import { registerWorkspaceMembers } from "../src/server/workspaceMembers/registerWorkspaceMembers.js";
import { registerWorkspacePendingInvitations } from "../src/server/workspacePendingInvitations/registerWorkspacePendingInvitations.js";
import {
  ACCOUNT_SETTINGS_CHANGED_EVENT,
  CONSOLE_SETTINGS_CHANGED_EVENT,
  USERS_BOOTSTRAP_CHANGED_EVENT,
  WORKSPACE_MEMBERS_CHANGED_EVENT,
  WORKSPACE_INVITES_CHANGED_EVENT,
  WORKSPACES_CHANGED_EVENT,
  WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT
} from "../src/shared/events/usersEvents.js";

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
  assert.equal(profile?.metadata?.events?.updateProfile?.[0]?.realtime?.event, ACCOUNT_SETTINGS_CHANGED_EVENT);
  assert.equal(profile?.metadata?.events?.updateProfile?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);
  assert.equal(profile?.metadata?.events?.uploadAvatar?.[0]?.realtime?.event, ACCOUNT_SETTINGS_CHANGED_EVENT);
  assert.equal(profile?.metadata?.events?.uploadAvatar?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);
  assert.equal(profile?.metadata?.events?.deleteAvatar?.[0]?.realtime?.event, ACCOUNT_SETTINGS_CHANGED_EVENT);
  assert.equal(profile?.metadata?.events?.deleteAvatar?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);

  const preferencesApp = createAppDouble();
  registerAccountPreferences(preferencesApp.app);
  const preferences = findServiceCall(preferencesApp.serviceCalls, "users.accountPreferences.service");
  assert.equal(preferences?.metadata?.events?.updatePreferences?.[0]?.realtime?.event, ACCOUNT_SETTINGS_CHANGED_EVENT);
  assert.equal(preferences?.metadata?.events?.updatePreferences?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);

  const notificationsApp = createAppDouble();
  registerAccountNotifications(notificationsApp.app);
  const notifications = findServiceCall(notificationsApp.serviceCalls, "users.accountNotifications.service");
  assert.equal(notifications?.metadata?.events?.updateNotifications?.[0]?.realtime?.event, ACCOUNT_SETTINGS_CHANGED_EVENT);
  assert.equal(notifications?.metadata?.events?.updateNotifications?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);
});

test("console settings register publishes console.settings.changed", () => {
  const payload = createAppDouble();
  registerConsoleSettings(payload.app);
  const consoleSettings = findServiceCall(payload.serviceCalls, "users.console.settings.service");
  assert.equal(consoleSettings?.metadata?.events?.updateSettings?.[0]?.realtime?.event, CONSOLE_SETTINGS_CHANGED_EVENT);
});

test("workspace register functions publish members/invites/workspace-list realtime events", async () => {
  const membersApp = createAppDouble();
  registerWorkspaceMembers(membersApp.app);
  const members = findServiceCall(membersApp.serviceCalls, "users.workspace.members.service");
  assert.equal(members?.metadata?.events?.updateMemberRole?.[0]?.realtime?.event, WORKSPACE_MEMBERS_CHANGED_EVENT);
  assert.equal(members?.metadata?.events?.updateMemberRole?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);
  assert.equal(members?.metadata?.events?.removeMember?.[0]?.realtime?.event, WORKSPACE_MEMBERS_CHANGED_EVENT);
  assert.equal(members?.metadata?.events?.removeMember?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);
  assert.equal(members?.metadata?.events?.createInvite?.[0]?.realtime?.event, WORKSPACE_INVITES_CHANGED_EVENT);
  assert.equal(members?.metadata?.events?.createInvite?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);
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
  assert.equal(members?.metadata?.events?.revokeInvite?.[0]?.realtime?.event, WORKSPACE_INVITES_CHANGED_EVENT);
  assert.equal(members?.metadata?.events?.revokeInvite?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);
  assert.equal(members?.metadata?.events?.revokeInvite?.[1]?.entityId?.({ result: { revokedInviteId: 19 } }), 19);
  assert.equal(members?.metadata?.events?.revokeInvite?.[1]?.realtime?.audience?.preset, "event_scope");
  assert.equal(typeof members?.metadata?.events?.revokeInvite?.[1]?.realtime?.audience?.userQuery, "function");

  const pendingApp = createAppDouble();
  registerWorkspacePendingInvitations(pendingApp.app);
  const pending = findServiceCall(pendingApp.serviceCalls, "users.workspace.pending-invitations.service");
  assert.equal(
    pending?.metadata?.events?.acceptInviteByToken?.[0]?.realtime?.event,
    WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT
  );
  assert.equal(pending?.metadata?.events?.acceptInviteByToken?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);
  assert.equal(pending?.metadata?.events?.acceptInviteByToken?.[2]?.realtime?.event, WORKSPACES_CHANGED_EVENT);
  assert.equal(
    pending?.metadata?.events?.refuseInviteByToken?.[0]?.realtime?.event,
    WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT
  );
  assert.equal(pending?.metadata?.events?.refuseInviteByToken?.[1]?.realtime?.event, USERS_BOOTSTRAP_CHANGED_EVENT);
});
