import assert from "node:assert/strict";
import test from "node:test";
import { registerAccountProfile } from "../src/server/accountProfile/registerAccountProfile.js";
import { registerAccountPreferences } from "../src/server/accountPreferences/registerAccountPreferences.js";
import { registerAccountNotifications } from "../src/server/accountNotifications/registerAccountNotifications.js";

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
