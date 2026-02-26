import assert from "node:assert/strict";
import test from "node:test";

import { createActionRuntimeServices } from "../server/runtime/actions/index.js";
import { ACTION_IDS, ACTION_ID_VALUES } from "../shared/actionIds.js";

function createRepositoryConfig() {
  return {
    actions: {
      assistant: {
        enabled: true,
        exposedActionIds: [],
        blockedActionIds: []
      },
      internal: {
        enabled: true,
        exposedActionIds: [],
        blockedActionIds: []
      }
    }
  };
}

function createServiceStubs() {
  return {
    authService: {
      async register(payload) {
        return {
          ok: true,
          payload
        };
      },
      async login(payload) {
        return {
          ok: true,
          payload
        };
      },
      async requestOtpLogin(payload) {
        return {
          ok: true,
          payload
        };
      },
      async verifyOtpLogin(payload) {
        return {
          ok: true,
          payload
        };
      },
      async oauthStart(payload) {
        return {
          url: "/oauth",
          payload
        };
      },
      async oauthComplete(payload) {
        return {
          ok: true,
          payload
        };
      },
      async requestPasswordReset(payload) {
        return {
          ok: true,
          payload
        };
      },
      async completePasswordRecovery(payload) {
        return {
          ok: true,
          payload
        };
      },
      async resetPassword() {
        return {
          ok: true
        };
      },
      async authenticateRequest() {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: false
        };
      }
    },
    workspaceService: {
      async buildBootstrapPayload() {
        return {
          ok: true
        };
      },
      async listWorkspacesForUser() {
        return [];
      },
      async listPendingInvitesForUser() {
        return [];
      },
      async selectWorkspaceForUser() {
        return {
          ok: true
        };
      }
    },
    workspaceAdminService: {
      getRoleCatalog() {
        return {};
      },
      async getWorkspaceSettings() {
        return {
          workspace: {
            id: 17
          },
          settings: {}
        };
      },
      async updateWorkspaceSettings(_workspace, payload) {
        return {
          workspace: {
            id: 17,
            name: String(payload?.name || "")
          }
        };
      },
      async listMembers() {
        return {
          members: []
        };
      },
      async updateMemberRole() {
        return {
          members: []
        };
      },
      async listInvites() {
        return {
          invites: []
        };
      },
      async createInvite() {
        return {
          invites: []
        };
      },
      async revokeInvite() {
        return {
          invites: []
        };
      },
      async respondToPendingInviteByToken() {
        return {
          ok: true
        };
      }
    },
    consoleService: {
      async buildBootstrapPayload() {
        return {
          ok: true
        };
      },
      async listRoles() {
        return {
          roleCatalog: {}
        };
      },
      async getAssistantSettings() {
        return {
          settings: {}
        };
      },
      async updateAssistantSettings() {
        return {
          settings: {}
        };
      },
      async listMembers() {
        return {
          members: []
        };
      },
      async updateMemberRole() {
        return {
          members: []
        };
      },
      async listInvites() {
        return {
          invites: []
        };
      },
      async createInvite() {
        return {
          invites: []
        };
      },
      async revokeInvite() {
        return {
          invites: []
        };
      },
      async listPendingInvitesForUser() {
        return [];
      },
      async respondToPendingInviteByToken() {
        return {
          ok: true
        };
      },
      async getBillingSettings() {
        return {
          settings: {}
        };
      },
      async updateBillingSettings() {
        return {
          settings: {}
        };
      },
      async listBillingEvents() {
        return {
          entries: []
        };
      },
      async listBillingPlans() {
        return {
          plans: []
        };
      },
      async listBillingProducts() {
        return {
          products: []
        };
      },
      async createBillingPlan() {
        return {
          plan: {
            id: 1
          }
        };
      },
      async createBillingProduct() {
        return {
          product: {
            id: 1
          }
        };
      },
      async listBillingProviderPrices() {
        return {
          prices: []
        };
      },
      async updateBillingPlan() {
        return {
          plan: {
            id: 1
          }
        };
      },
      async updateBillingProduct() {
        return {
          product: {
            id: 1
          }
        };
      },
      async listEntitlementDefinitions() {
        return {
          entries: []
        };
      },
      async getEntitlementDefinition() {
        return {
          definition: null
        };
      },
      async createEntitlementDefinition() {
        return {
          definition: {
            id: 1
          }
        };
      },
      async updateEntitlementDefinition() {
        return {
          definition: {
            id: 1
          }
        };
      },
      async deleteEntitlementDefinition() {
        return {
          deleted: true
        };
      },
      async archiveBillingPlan() {
        return {
          plan: {
            id: 1
          }
        };
      },
      async unarchiveBillingPlan() {
        return {
          plan: {
            id: 1
          }
        };
      },
      async deleteBillingPlan() {
        return {
          deleted: true
        };
      },
      async archiveBillingProduct() {
        return {
          product: {
            id: 1
          }
        };
      },
      async unarchiveBillingProduct() {
        return {
          product: {
            id: 1
          }
        };
      },
      async deleteBillingProduct() {
        return {
          deleted: true
        };
      },
      async listPurchasesForConsole() {
        return {
          purchases: []
        };
      },
      async refundPurchaseForConsole() {
        return {
          purchase: {
            id: 1
          }
        };
      },
      async voidPurchaseForConsole() {
        return {
          purchase: {
            id: 1
          }
        };
      },
      async createPurchaseCorrectionForConsole() {
        return {
          correction: {
            id: 1
          }
        };
      },
      async listPlanAssignmentsForConsole() {
        return {
          entries: []
        };
      },
      async createPlanAssignmentForConsole() {
        return {
          assignment: {
            id: 1
          }
        };
      },
      async updatePlanAssignmentForConsole() {
        return {
          assignment: {
            id: 1
          }
        };
      },
      async cancelPlanAssignmentForConsole() {
        return {
          assignment: {
            id: 1
          }
        };
      },
      async listSubscriptionsForConsole() {
        return {
          entries: []
        };
      },
      async changeSubscriptionPlanForConsole() {
        return {
          subscription: {
            id: "sub_1"
          }
        };
      },
      async cancelSubscriptionForConsole() {
        return {
          subscription: {
            id: "sub_1"
          }
        };
      },
      async cancelSubscriptionAtPeriodEndForConsole() {
        return {
          subscription: {
            id: "sub_1"
          }
        };
      }
    },
    chatService: {
      async ensureWorkspaceRoom() {
        return {
          ok: true
        };
      },
      async ensureDm() {
        return {
          ok: true
        };
      },
      async listDmCandidates() {
        return {
          entries: []
        };
      },
      async listInbox() {
        return {
          entries: []
        };
      },
      async getThread() {
        return {
          thread: {
            id: 1
          }
        };
      },
      async listThreadMessages() {
        return {
          entries: []
        };
      },
      async sendThreadMessage() {
        return {
          message: {
            id: 1
          }
        };
      },
      async markThreadRead() {
        return {
          ok: true
        };
      },
      async addReaction() {
        return {
          ok: true
        };
      },
      async removeReaction() {
        return {
          ok: true
        };
      },
      async emitThreadTyping() {
        return {
          ok: true
        };
      },
      async reserveThreadAttachment() {
        return {
          attachment: {
            id: 1
          }
        };
      },
      async uploadThreadAttachment() {
        return {
          attachment: {
            id: 1
          }
        };
      },
      async deleteThreadAttachment() {},
      async getAttachmentContent() {
        return {
          contentType: "text/plain",
          contentDisposition: "inline",
          contentBuffer: Buffer.from("ok")
        };
      }
    },
    socialService: {
      async listFeed() {
        return {
          items: []
        };
      },
      async getPost() {
        return {
          post: {
            id: 1
          },
          comments: []
        };
      },
      async createPost() {
        return {
          post: {
            id: 1
          }
        };
      },
      async updatePost() {
        return {
          post: {
            id: 1
          }
        };
      },
      async deletePost() {
        return {
          deleted: true
        };
      },
      async createComment() {
        return {
          comment: {
            id: 1
          }
        };
      },
      async deleteComment() {
        return {
          deleted: true
        };
      },
      async requestFollow() {
        return {
          follow: {
            id: 1
          }
        };
      },
      async acceptFollow() {
        return {
          follow: {
            id: 1
          }
        };
      },
      async rejectFollow() {
        return {
          follow: {
            id: 1
          }
        };
      },
      async undoFollow() {
        return {
          follow: {
            id: 1
          }
        };
      },
      async searchActors() {
        return {
          items: []
        };
      },
      async getActorProfile() {
        return {
          actor: {
            id: 1
          },
          counts: {
            followers: 0,
            following: 0
          }
        };
      },
      async listNotifications() {
        return {
          items: []
        };
      },
      async markNotificationsRead() {
        return {
          updated: true,
          notificationIds: []
        };
      },
      async listModerationRules() {
        return {
          items: []
        };
      },
      async createModerationRule() {
        return {
          rule: {
            id: 1
          }
        };
      },
      async deleteModerationRule() {
        return {
          deleted: true
        };
      },
      async processInboxActivity() {
        return {
          accepted: true,
          eventId: 1
        };
      },
      async deliverOutboxBatch() {
        return {
          processedCount: 0,
          results: []
        };
      },
      async getWebFinger() {
        return {
          subject: "acct:user@example.com",
          links: []
        };
      },
      async getActorDocument() {
        return {
          id: "https://example.com/ap/actors/user"
        };
      },
      async getFollowersCollection() {
        return {
          orderedItems: []
        };
      },
      async getFollowingCollection() {
        return {
          orderedItems: []
        };
      },
      async getOutboxCollection() {
        return {
          orderedItems: []
        };
      },
      async getObjectDocument() {
        return {
          id: "https://example.com/ap/objects/1"
        };
      }
    },
    billingService: {
      async listPlans() {
        return {
          plans: []
        };
      },
      async getPlanState() {
        return {
          currentPlan: null
        };
      },
      async listProducts() {
        return {
          products: []
        };
      },
      async listPurchases() {
        return {
          purchases: []
        };
      },
      async listPaymentMethods() {
        return {
          paymentMethods: []
        };
      },
      async syncPaymentMethods() {
        return {
          paymentMethods: []
        };
      },
      async setDefaultPaymentMethod() {
        return {
          paymentMethods: []
        };
      },
      async detachPaymentMethod() {
        return {
          paymentMethods: []
        };
      },
      async removePaymentMethod() {
        return {
          paymentMethods: []
        };
      },
      async getLimitations() {
        return {
          limitations: []
        };
      },
      async listTimeline() {
        return {
          entries: []
        };
      },
      async startCheckout() {
        return {
          checkoutUrl: "https://example.test/checkout"
        };
      },
      async requestPlanChange() {
        return {
          mode: "applied"
        };
      },
      async cancelPendingPlanChange() {
        return {
          canceled: true
        };
      },
      async createPortalSession() {
        return {
          url: "https://example.test/portal"
        };
      },
      async createPaymentLink() {
        return {
          url: "https://example.test"
        };
      },
      async executeWithEntitlementConsumption({ action } = {}) {
        return action({ trx: null });
      }
    },
    userSettingsService: {
      async getForUser() {
        return {
          security: {
            mfa: {
              status: "not_enabled"
            }
          }
        };
      },
      async updateProfile() {
        return {
          ok: true
        };
      },
      async uploadAvatar() {
        return {
          ok: true
        };
      },
      async deleteAvatar() {
        return {
          ok: true
        };
      },
      async updatePreferences() {
        return {
          ok: true
        };
      },
      async updateNotifications() {
        return {
          ok: true
        };
      },
      async updateChat() {
        return {
          ok: true
        };
      },
      async changePassword() {
        return {
          ok: true
        };
      },
      async setPasswordMethodEnabled() {
        return {
          ok: true
        };
      },
      async startOAuthProviderLink() {
        return {
          url: "/oauth/link"
        };
      },
      async unlinkOAuthProvider() {
        return {
          ok: true
        };
      },
      async logoutOtherSessions() {
        return {
          ok: true
        };
      }
    },
    alertsService: {
      async listForUser() {
        return {
          entries: [],
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 1,
          unreadCount: 0,
          readThroughAlertId: null
        };
      },
      async markAllReadForUser() {
        return {
          unreadCount: 0,
          readThroughAlertId: null
        };
      }
    },
    projectsService: {
      async list() {
        return {
          entries: []
        };
      },
      async get() {
        return {
          project: {
            id: 1
          }
        };
      },
      async create() {
        return {
          project: {
            id: 1
          }
        };
      },
      async update() {
        return {
          project: {
            id: 1
          }
        };
      },
      async replace() {
        return {
          project: {
            id: 1
          }
        };
      },
      async countActiveForWorkspace() {
        return 0;
      }
    },
    deg2radService: {
      validateAndNormalizeInput(payload) {
        return {
          ...payload,
          DEG2RAD_degreesDecimal: {
            mul() {
              return {
                div() {
                  return {
                    isFinite() {
                      return true;
                    },
                    toFixed() {
                      return "0.000000000000";
                    }
                  };
                }
              };
            }
          }
        };
      },
      calculateDeg2rad() {
        return {
          DEG2RAD_operation: "DEG2RAD",
          DEG2RAD_formula: "DEG2RAD(x) = x * PI / 180",
          DEG2RAD_degrees: "0.000000000000",
          DEG2RAD_radians: "0.000000000000"
        };
      }
    },
    deg2radHistoryService: {
      async appendCalculation() {
        return {
          id: "history-1"
        };
      },
      async listForUser() {
        return {
          entries: []
        };
      }
    },
    aiService: {
      isEnabled() {
        return true;
      },
      validateChatTurnInput() {
        return {};
      },
      async streamChatTurn() {}
    },
    aiTranscriptsService: {
      async listWorkspaceConversations() {
        return {
          entries: []
        };
      },
      async listWorkspaceConversationsForUser() {
        return {
          entries: []
        };
      },
      async getWorkspaceConversationMessages() {
        return {
          entries: []
        };
      },
      async getWorkspaceConversationMessagesForUser() {
        return {
          entries: []
        };
      },
      async exportWorkspaceConversation() {
        return {
          entries: []
        };
      },
      async listConsoleConversations() {
        return {
          entries: []
        };
      },
      async getConsoleConversationMessages() {
        return {
          entries: []
        };
      },
      async exportConsoleMessages() {
        return {
          entries: []
        };
      }
    },
    consoleErrorsService: {
      async listBrowserErrors() {
        return {
          entries: []
        };
      },
      async getBrowserError() {
        return {
          entry: null
        };
      },
      async listServerErrors() {
        return {
          entries: []
        };
      },
      async getServerError() {
        return {
          entry: null
        };
      },
      async recordBrowserError() {
        return {
          ok: true
        };
      },
      async simulateServerError() {
        return {
          ok: true
        };
      }
    },
    communicationsService: {
      async sendSms() {
        return {
          ok: true
        };
      }
    }
  };
}

test("action runtime services scaffold action registry and executor", async () => {
  const runtime = createActionRuntimeServices({
    services: createServiceStubs(),
    repositories: {},
    repositoryConfig: createRepositoryConfig(),
    appConfig: {},
    rbacManifest: {}
  });

  assert.equal(typeof runtime.actionRegistry.execute, "function");
  assert.equal(typeof runtime.actionRegistry.executeStream, "function");
  assert.equal(typeof runtime.actionExecutor.execute, "function");
  assert.equal(typeof runtime.actionExecutor.executeStream, "function");
  assert.equal(typeof runtime.actionExecutor.listDefinitions, "function");
  assert.equal(typeof runtime.actionExecutor.getDefinition, "function");

  const definitions = runtime.actionRegistry.listDefinitions();
  assert.ok(definitions.length > 0);

  const actionIds = new Set(definitions.map((definition) => definition.id));
  const versionKeys = definitions.map((definition) => `${definition.id}@v${definition.version}`);
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  assert.equal(new Set(versionKeys).size, versionKeys.length);

  const expectedActionIds = [
    ACTION_IDS.WORKSPACE_SETTINGS_UPDATE,
    ACTION_IDS.WORKSPACE_INVITE_CREATE,
    ACTION_IDS.WORKSPACE_MEMBER_ROLE_UPDATE,
    ACTION_IDS.CONSOLE_INVITE_CREATE,
    ACTION_IDS.CONSOLE_MEMBER_ROLE_UPDATE,
    ACTION_IDS.WORKSPACE_BILLING_PLAN_CHANGE_REQUEST,
    ACTION_IDS.WORKSPACE_BILLING_PAYMENT_LINK_CREATE,
    ACTION_IDS.CONSOLE_BILLING_PLAN_CREATE,
    ACTION_IDS.CONSOLE_BILLING_PLAN_UPDATE,
    ACTION_IDS.CONSOLE_BILLING_PRODUCT_CREATE,
    ACTION_IDS.CONSOLE_BILLING_PRODUCT_UPDATE,
    ACTION_IDS.CONSOLE_BILLING_ENTITLEMENT_DEFINITIONS_LIST,
    ACTION_IDS.CONSOLE_BILLING_ENTITLEMENT_DEFINITION_GET,
    ACTION_IDS.CONSOLE_BILLING_ENTITLEMENT_DEFINITION_CREATE,
    ACTION_IDS.CONSOLE_BILLING_ENTITLEMENT_DEFINITION_UPDATE,
    ACTION_IDS.CONSOLE_BILLING_ENTITLEMENT_DEFINITION_DELETE,
    ACTION_IDS.CONSOLE_BILLING_PLAN_ARCHIVE,
    ACTION_IDS.CONSOLE_BILLING_PLAN_UNARCHIVE,
    ACTION_IDS.CONSOLE_BILLING_PLAN_DELETE,
    ACTION_IDS.CONSOLE_BILLING_PRODUCT_ARCHIVE,
    ACTION_IDS.CONSOLE_BILLING_PRODUCT_UNARCHIVE,
    ACTION_IDS.CONSOLE_BILLING_PRODUCT_DELETE,
    ACTION_IDS.CONSOLE_BILLING_PURCHASES_LIST,
    ACTION_IDS.CONSOLE_BILLING_PURCHASE_REFUND,
    ACTION_IDS.CONSOLE_BILLING_PURCHASE_VOID,
    ACTION_IDS.CONSOLE_BILLING_PURCHASE_CORRECTION_CREATE,
    ACTION_IDS.CONSOLE_BILLING_PLAN_ASSIGNMENTS_LIST,
    ACTION_IDS.CONSOLE_BILLING_PLAN_ASSIGNMENT_CREATE,
    ACTION_IDS.CONSOLE_BILLING_PLAN_ASSIGNMENT_UPDATE,
    ACTION_IDS.CONSOLE_BILLING_PLAN_ASSIGNMENT_CANCEL,
    ACTION_IDS.CONSOLE_BILLING_SUBSCRIPTIONS_LIST,
    ACTION_IDS.CONSOLE_BILLING_SUBSCRIPTION_CHANGE_PLAN,
    ACTION_IDS.CONSOLE_BILLING_SUBSCRIPTION_CANCEL,
    ACTION_IDS.CONSOLE_BILLING_SUBSCRIPTION_CANCEL_AT_PERIOD_END,
    ACTION_IDS.WORKSPACE_BILLING_PAYMENT_METHODS_DEFAULT_SET,
    ACTION_IDS.WORKSPACE_BILLING_PAYMENT_METHODS_DETACH,
    ACTION_IDS.WORKSPACE_BILLING_PAYMENT_METHODS_REMOVE,
    ACTION_IDS.CHAT_THREAD_MESSAGE_SEND,
    ACTION_IDS.CHAT_ATTACHMENT_UPLOAD,
    ACTION_IDS.SOCIAL_FEED_READ,
    ACTION_IDS.SOCIAL_POST_CREATE,
    ACTION_IDS.SOCIAL_FOLLOW_REQUEST,
    ACTION_IDS.SOCIAL_NOTIFICATIONS_LIST,
    ACTION_IDS.SOCIAL_MODERATION_RULE_CREATE,
    ACTION_IDS.SOCIAL_FEDERATION_INBOX_PROCESS,
    ACTION_IDS.SOCIAL_FEDERATION_OUTBOX_GET,
    ACTION_IDS.SETTINGS_ALERTS_LIST,
    ACTION_IDS.SETTINGS_ALERTS_READ_ALL,
    ACTION_IDS.PROJECTS_CREATE,
    ACTION_IDS.PROJECTS_UPDATE,
    ACTION_IDS.DEG2RAD_CALCULATE,
    ACTION_IDS.HISTORY_LIST
  ];

  for (const actionId of expectedActionIds) {
    assert.equal(actionIds.has(actionId), true, `${actionId} should be registered.`);
  }

  assert.equal(definitionsById.get(ACTION_IDS.CONSOLE_BILLING_PLAN_DELETE)?.idempotency, "required");
  assert.equal(definitionsById.get(ACTION_IDS.CONSOLE_BILLING_PURCHASE_REFUND)?.idempotency, "required");
  assert.equal(definitionsById.get(ACTION_IDS.CONSOLE_BILLING_ENTITLEMENT_DEFINITION_CREATE)?.idempotency, "optional");
  assert.equal(
    definitionsById.get(ACTION_IDS.WORKSPACE_BILLING_PAYMENT_METHODS_DEFAULT_SET)?.idempotency,
    "required"
  );
  assert.equal(definitionsById.get(ACTION_IDS.CONSOLE_BILLING_SUBSCRIPTIONS_LIST)?.surfaces.includes("console"), true);
  assert.equal(
    definitionsById.get(ACTION_IDS.WORKSPACE_BILLING_PAYMENT_METHODS_REMOVE)?.surfaces.includes("admin"),
    true
  );

  assert.equal(definitionsById.get(ACTION_IDS.WORKSPACE_INVITE_CREATE)?.channels.includes("assistant_tool"), true);
  assert.equal(definitionsById.get(ACTION_IDS.PROJECTS_LIST)?.channels.includes("assistant_tool"), true);
  assert.equal(definitionsById.get(ACTION_IDS.PROJECTS_GET)?.channels.includes("assistant_tool"), true);
  assert.equal(definitionsById.get(ACTION_IDS.PROJECTS_CREATE)?.channels.includes("assistant_tool"), true);
  assert.equal(definitionsById.get(ACTION_IDS.PROJECTS_UPDATE)?.channels.includes("assistant_tool"), true);
  assert.equal(definitionsById.get(ACTION_IDS.DEG2RAD_CALCULATE)?.channels.includes("assistant_tool"), true);
  assert.equal(definitionsById.get(ACTION_IDS.HISTORY_LIST)?.channels.includes("assistant_tool"), true);
  assert.equal(definitionsById.get(ACTION_IDS.CONSOLE_BILLING_PURCHASE_REFUND)?.channels.includes("assistant_tool"), true);
  assert.equal(
    definitionsById.get(ACTION_IDS.CONSOLE_BILLING_SUBSCRIPTION_CHANGE_PLAN)?.channels.includes("assistant_tool"),
    true
  );
  assert.equal(
    definitionsById.get(ACTION_IDS.WORKSPACE_BILLING_PAYMENT_METHODS_DEFAULT_SET)?.channels.includes("assistant_tool"),
    true
  );
  assert.equal(
    definitionsById.get(ACTION_IDS.WORKSPACE_BILLING_PAYMENT_METHODS_REMOVE)?.channels.includes("assistant_tool"),
    true
  );
  assert.equal(
    typeof definitionsById.get(ACTION_IDS.PROJECTS_CREATE)?.assistantTool?.inputJsonSchema,
    "object"
  );
  assert.equal(
    typeof definitionsById.get(ACTION_IDS.DEG2RAD_CALCULATE)?.assistantTool?.inputJsonSchema,
    "object"
  );
  assert.deepEqual(
    definitionsById.get(ACTION_IDS.DEG2RAD_CALCULATE)?.assistantTool?.inputJsonSchema?.required,
    ["DEG2RAD_operation", "DEG2RAD_degrees"]
  );
  assert.equal(
    Object.hasOwn(definitionsById.get(ACTION_IDS.DEG2RAD_CALCULATE)?.assistantTool?.inputJsonSchema?.properties || {}, "degrees"),
    false
  );
  assert.equal(
    typeof definitionsById.get(ACTION_IDS.CONSOLE_BILLING_PURCHASE_REFUND)?.assistantTool?.inputJsonSchema,
    "object"
  );
  assert.equal(
    definitionsById.get(ACTION_IDS.CONSOLE_BILLING_PURCHASE_REFUND)?.assistantTool?.inputJsonSchema?.required.includes(
      "confirm"
    ),
    true
  );
  assert.equal(
    definitionsById
      .get(ACTION_IDS.WORKSPACE_BILLING_PAYMENT_METHODS_REMOVE)
      ?.assistantTool?.inputJsonSchema?.required.includes("reason"),
    true
  );

  const response = await runtime.actionExecutor.execute({
    actionId: ACTION_IDS.WORKSPACE_SETTINGS_READ,
    input: {},
    context: {
      channel: "api",
      surface: "admin",
      actor: {
        id: 42,
        email: "user@example.test"
      },
      workspace: {
        id: 17,
        slug: "acme"
      },
      permissions: ["workspace.settings.view"]
    }
  });

  assert.deepEqual(response, {
    workspace: {
      id: 17
    },
    settings: {}
  });
});

test("ACTION_IDS does not contain duplicate action identifiers", () => {
  const uniqueActionIdValues = new Set(ACTION_ID_VALUES);
  assert.equal(uniqueActionIdValues.size, ACTION_ID_VALUES.length);
});

test("social moderation actions can be configured as operator-only visibility", async () => {
  const repositoryConfig = createRepositoryConfig();
  repositoryConfig.social = {
    moderation: {
      accessMode: "operator"
    }
  };

  const runtime = createActionRuntimeServices({
    services: createServiceStubs(),
    repositories: {},
    repositoryConfig,
    appConfig: {},
    rbacManifest: {}
  });

  const definitions = runtime.actionRegistry.listDefinitions();
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const moderationActionIds = [
    ACTION_IDS.SOCIAL_MODERATION_RULES_LIST,
    ACTION_IDS.SOCIAL_MODERATION_RULE_CREATE,
    ACTION_IDS.SOCIAL_MODERATION_RULE_DELETE
  ];

  for (const actionId of moderationActionIds) {
    const definition = definitionsById.get(actionId);
    assert.equal(definition?.visibility, "operator");
    assert.equal(typeof definition?.permission, "function");
    assert.equal(await definition.permission({ permissions: [] }, {}), true);
  }
});
