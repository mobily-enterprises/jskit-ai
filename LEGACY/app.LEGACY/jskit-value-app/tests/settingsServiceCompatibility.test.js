import assert from "node:assert/strict";
import test from "node:test";
import { __testables } from "../server/modules/settings/service.js";

test("settings service compatibility fixtures preserve preferences/notifications/chat parsing", () => {
  const preferencesFixture = {
    theme: " dark ",
    locale: "en-GB",
    timeZone: "Europe/London",
    dateFormat: "dmy",
    numberFormat: "dot-comma",
    currencyCode: "eur",
    avatarSize: "96"
  };

  assert.deepEqual(__testables.parsePreferencesInput(preferencesFixture), {
    patch: {
      theme: "dark",
      locale: "en-GB",
      timeZone: "Europe/London",
      dateFormat: "dmy",
      numberFormat: "dot-comma",
      currencyCode: "EUR",
      avatarSize: 96
    },
    fieldErrors: {}
  });

  const notificationsFixture = {
    productUpdates: false,
    accountActivity: true,
    securityAlerts: true
  };

  assert.deepEqual(__testables.parseNotificationsInput(notificationsFixture), {
    patch: {
      productUpdates: false,
      accountActivity: true,
      securityAlerts: true
    },
    fieldErrors: {}
  });

  const chatFixture = {
    publicChatId: " user-7 ",
    allowWorkspaceDms: false,
    allowGlobalDms: true,
    requireSharedWorkspaceForGlobalDm: false,
    discoverableByPublicChatId: true
  };

  assert.deepEqual(__testables.parseChatInput(chatFixture), {
    patch: {
      publicChatId: "user-7",
      allowWorkspaceDms: false,
      allowGlobalDms: true,
      requireSharedWorkspaceForGlobalDm: false,
      discoverableByPublicChatId: true
    },
    fieldErrors: {}
  });
});
