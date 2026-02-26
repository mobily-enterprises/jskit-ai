import assert from "node:assert/strict";
import test from "node:test";

import { createConsoleActionContributor } from "@jskit-ai/workspace-console-service-core";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../shared/eventTypes.js";
import { createSettingsActionContributor } from "../server/runtime/actions/contributors/settings.contributor.js";
import { createDeg2radHistoryActionContributor } from "../server/runtime/actions/contributors/deg2radHistory.contributor.js";
import { createConsoleErrorsActionContributor } from "../server/runtime/actions/contributors/consoleErrors.contributor.js";

function getAction(contributor, actionId) {
  return contributor.actions.find((action) => action.id === actionId);
}

test("settings action contributor publishes realtime for synced mutation actions", async () => {
  const published = [];
  const contributor = createSettingsActionContributor({
    userSettingsService: {
      async getForUser() {
        return {};
      },
      async updateProfile() {
        return { ok: true };
      },
      async uploadAvatar() {
        return { ok: true };
      },
      async deleteAvatar() {
        return { ok: true };
      },
      async updatePreferences() {
        return { ok: true };
      },
      async updateNotifications() {
        return { ok: true };
      },
      async updateChat() {
        return { ok: true };
      },
      async changePassword() {
        return { ok: true };
      },
      async setPasswordMethodEnabled() {
        return { ok: true };
      },
      async startOAuthProviderLink() {
        return { redirectUrl: "https://example.test" };
      },
      async unlinkOAuthProvider() {
        return { ok: true };
      },
      async logoutOtherSessions() {
        return { ok: true };
      }
    },
    authService: {
      async oauthComplete() {
        return { ok: true };
      }
    },
    realtimeEventsService: {
      createEventEnvelope(payload) {
        return {
          eventId: "evt_settings",
          ...payload
        };
      },
      publish(payload) {
        published.push(payload);
      }
    }
  });

  const updateProfileAction = getAction(contributor, "settings.profile.update");
  const oauthLinkStartAction = getAction(contributor, "settings.security.oauth.link.start");

  await updateProfileAction.execute(
    {
      displayName: "Updated User"
    },
    {
      actor: {
        id: 12
      },
      requestMeta: {
        commandId: "cmd_settings_1",
        sourceClientId: "cli_settings_1"
      }
    }
  );

  await oauthLinkStartAction.execute(
    {
      provider: "google",
      returnTo: "/account/settings"
    },
    {
      actor: {
        id: 12
      },
      requestMeta: {
        commandId: "cmd_settings_2",
        sourceClientId: "cli_settings_1"
      }
    }
  );

  assert.equal(published.length, 1);
  assert.equal(published[0].eventType, REALTIME_EVENT_TYPES.USER_SETTINGS_UPDATED);
  assert.equal(published[0].topic, REALTIME_TOPICS.SETTINGS);
  assert.equal(published[0].commandId, "cmd_settings_1");
  assert.equal(published[0].sourceClientId, "cli_settings_1");
  assert.equal(published[0].actorUserId, 12);
  assert.deepEqual(published[0].targetUserIds, [12]);
});

test("deg2rad history contributor publishes realtime for calculate mutations", async () => {
  const published = [];
  const contributor = createDeg2radHistoryActionContributor({
    deg2radService: {
      validateAndNormalizeInput(input) {
        return {
          DEG2RAD_degrees: String(input?.DEG2RAD_degrees || "0"),
          DEG2RAD_degreesDecimal: {
            mul() {
              return {
                div() {
                  return {
                    isFinite() {
                      return true;
                    },
                    toFixed() {
                      return "3.141592653590";
                    }
                  };
                }
              };
            }
          }
        };
      },
      calculateDeg2rad(input) {
        return {
          DEG2RAD_operation: "DEG2RAD",
          DEG2RAD_formula: "DEG2RAD(x) = x * PI / 180",
          DEG2RAD_degrees: String(input?.DEG2RAD_degrees || "0"),
          DEG2RAD_radians: "3.141592653590"
        };
      }
    },
    deg2radHistoryService: {
      async appendCalculation() {
        return {
          id: "00000000-0000-4000-8000-000000000055"
        };
      },
      async listForUser() {
        return {
          entries: [],
          page: 1,
          pageSize: 10
        };
      }
    },
    realtimeEventsService: {
      createEventEnvelope(payload) {
        return {
          eventId: "evt_history",
          ...payload
        };
      },
      publish(payload) {
        published.push(payload);
      }
    }
  });

  const calculateAction = getAction(contributor, "deg2rad.calculate");
  await calculateAction.execute(
    {
      DEG2RAD_operation: "DEG2RAD",
      DEG2RAD_degrees: 180
    },
    {
      actor: {
        id: 7
      },
      workspace: {
        id: 33,
        slug: "acme"
      },
      requestMeta: {
        commandId: "cmd_history_1",
        sourceClientId: "cli_history_1"
      }
    }
  );

  assert.equal(published.length, 1);
  assert.equal(published[0].eventType, REALTIME_EVENT_TYPES.USER_HISTORY_UPDATED);
  assert.equal(published[0].topic, REALTIME_TOPICS.HISTORY);
  assert.equal(published[0].workspaceSlug, "acme");
  assert.equal(published[0].workspaceId, 33);
  assert.equal(published[0].commandId, "cmd_history_1");
  assert.equal(published[0].sourceClientId, "cli_history_1");
  assert.equal(published[0].entityId, "00000000-0000-4000-8000-000000000055");
  assert.deepEqual(published[0].targetUserIds, [7]);
  assert.equal(published[0].payload.historyId, "00000000-0000-4000-8000-000000000055");
});

test("console errors contributor publishes realtime for command mutations", async () => {
  const published = [];
  const contributor = createConsoleErrorsActionContributor({
    consoleErrorsService: {
      async listBrowserErrors() {
        return {
          entries: []
        };
      },
      async getBrowserError() {
        return null;
      },
      async listServerErrors() {
        return {
          entries: []
        };
      },
      async getServerError() {
        return null;
      },
      async recordBrowserError() {
        return undefined;
      },
      async simulateServerError() {
        return {
          ok: true
        };
      }
    },
    realtimeEventsService: {
      createEventEnvelope(payload) {
        return {
          eventId: "evt_console_errors",
          ...payload
        };
      },
      publish(payload) {
        published.push(payload);
      }
    }
  });

  await getAction(contributor, "console.errors.browser.record").execute(
    {
      message: "browser crash"
    },
    {
      actor: {
        id: 88
      },
      requestMeta: {
        commandId: "cmd_console_errors_1",
        sourceClientId: "cli_console_errors_1"
      }
    }
  );

  await getAction(contributor, "console.errors.server.simulate").execute(
    {
      kind: "type_error"
    },
    {
      actor: {
        id: 88
      },
      requestMeta: {
        commandId: "cmd_console_errors_2",
        sourceClientId: "cli_console_errors_1"
      }
    }
  );

  assert.equal(published.length, 2);
  assert.equal(published[0].topic, REALTIME_TOPICS.CONSOLE_ERRORS);
  assert.equal(published[0].eventType, REALTIME_EVENT_TYPES.CONSOLE_ERRORS_UPDATED);
  assert.deepEqual(published[0].targetUserIds, [88]);
  assert.equal(published[1].topic, REALTIME_TOPICS.CONSOLE_ERRORS);
  assert.equal(published[1].eventType, REALTIME_EVENT_TYPES.CONSOLE_ERRORS_UPDATED);
  assert.deepEqual(published[1].targetUserIds, [88]);
});

test("console contributor publishes realtime for settings, members, invites, and billing command actions", async () => {
  const published = [];
  const methods = [
    "buildBootstrapPayload",
    "listRoles",
    "getAssistantSettings",
    "updateAssistantSettings",
    "listMembers",
    "updateMemberRole",
    "listInvites",
    "createInvite",
    "revokeInvite",
    "listPendingInvitesForUser",
    "respondToPendingInviteByToken",
    "getBillingSettings",
    "updateBillingSettings",
    "listBillingEvents",
    "listBillingPlans",
    "listBillingProducts",
    "createBillingPlan",
    "createBillingProduct",
    "listBillingProviderPrices",
    "updateBillingPlan",
    "updateBillingProduct",
    "listEntitlementDefinitions",
    "getEntitlementDefinition",
    "createEntitlementDefinition",
    "updateEntitlementDefinition",
    "deleteEntitlementDefinition",
    "archiveBillingPlan",
    "unarchiveBillingPlan",
    "deleteBillingPlan",
    "archiveBillingProduct",
    "unarchiveBillingProduct",
    "deleteBillingProduct",
    "listPurchasesForConsole",
    "refundPurchaseForConsole",
    "voidPurchaseForConsole",
    "createPurchaseCorrectionForConsole",
    "listPlanAssignmentsForConsole",
    "createPlanAssignmentForConsole",
    "updatePlanAssignmentForConsole",
    "cancelPlanAssignmentForConsole",
    "listSubscriptionsForConsole",
    "changeSubscriptionPlanForConsole",
    "cancelSubscriptionForConsole",
    "cancelSubscriptionAtPeriodEndForConsole"
  ];
  const consoleService = {};
  for (const methodName of methods) {
    consoleService[methodName] = async () => ({});
  }
  consoleService.listPendingInvitesForUser = async () => [];

  const contributor = createConsoleActionContributor({
    consoleService,
    realtimeEventsService: {
      createEventEnvelope(payload) {
        return {
          eventId: "evt_console",
          ...payload
        };
      },
      publish(payload) {
        published.push(payload);
      }
    },
    realtimeTopics: REALTIME_TOPICS,
    realtimeEventTypes: REALTIME_EVENT_TYPES
  });

  const memberUpdateAction = getAction(contributor, "console.member.role.update");
  const inviteCreateAction = getAction(contributor, "console.invite.create");
  const settingsUpdateAction = getAction(contributor, "console.settings.update");
  const billingUpdateAction = getAction(contributor, "console.billing.settings.update");
  const membersListAction = getAction(contributor, "console.members.list");

  await memberUpdateAction.execute(
    {
      memberUserId: 21,
      roleId: "moderator"
    },
    {
      actor: {
        id: 5
      },
      requestMeta: {
        commandId: "cmd_console_1",
        sourceClientId: "cli_console_1"
      }
    }
  );

  await inviteCreateAction.execute(
    {
      email: "person@example.com",
      roleId: "moderator"
    },
    {
      actor: {
        id: 5
      },
      requestMeta: {
        commandId: "cmd_console_2",
        sourceClientId: "cli_console_1"
      }
    }
  );

  await settingsUpdateAction.execute(
    {
      assistantSystemPromptWorkspace: "Professional"
    },
    {
      actor: {
        id: 5
      },
      requestMeta: {
        commandId: "cmd_console_3",
        sourceClientId: "cli_console_1"
      }
    }
  );

  await billingUpdateAction.execute(
    {
      checkoutUrl: "https://billing.example.test"
    },
    {
      actor: {
        id: 5
      },
      requestMeta: {
        commandId: "cmd_console_4",
        sourceClientId: "cli_console_1"
      }
    }
  );

  await membersListAction.execute(
    {},
    {
      actor: {
        id: 5
      }
    }
  );

  assert.equal(published.length, 4);
  assert.equal(published[0].topic, REALTIME_TOPICS.CONSOLE_MEMBERS);
  assert.equal(published[0].eventType, REALTIME_EVENT_TYPES.CONSOLE_MEMBERS_UPDATED);
  assert.equal(published[1].topic, REALTIME_TOPICS.CONSOLE_INVITES);
  assert.equal(published[1].eventType, REALTIME_EVENT_TYPES.CONSOLE_INVITES_UPDATED);
  assert.equal(published[2].topic, REALTIME_TOPICS.CONSOLE_SETTINGS);
  assert.equal(published[2].eventType, REALTIME_EVENT_TYPES.CONSOLE_SETTINGS_UPDATED);
  assert.equal(published[3].topic, REALTIME_TOPICS.CONSOLE_BILLING);
  assert.equal(published[3].eventType, REALTIME_EVENT_TYPES.CONSOLE_BILLING_UPDATED);
  assert.deepEqual(
    published.map((entry) => entry.targetUserIds),
    [[5], [5], [5], [5]]
  );
});
