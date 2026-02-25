import assert from "node:assert/strict";
import test from "node:test";

import { createActionRuntimeServices } from "../server/runtime/actions/index.js";
import { ACTION_IDS } from "../shared/actionIds.js";

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
  assert.equal(actionIds.has(ACTION_IDS.WORKSPACE_SETTINGS_UPDATE), true);
  assert.equal(actionIds.has(ACTION_IDS.WORKSPACE_INVITE_CREATE), true);
  assert.equal(actionIds.has(ACTION_IDS.WORKSPACE_MEMBER_ROLE_UPDATE), true);
  assert.equal(actionIds.has(ACTION_IDS.CONSOLE_INVITE_CREATE), true);
  assert.equal(actionIds.has(ACTION_IDS.CONSOLE_MEMBER_ROLE_UPDATE), true);
  assert.equal(actionIds.has(ACTION_IDS.WORKSPACE_BILLING_PLAN_CHANGE_REQUEST), true);
  assert.equal(actionIds.has(ACTION_IDS.WORKSPACE_BILLING_PAYMENT_LINK_CREATE), true);
  assert.equal(actionIds.has(ACTION_IDS.CONSOLE_BILLING_PLAN_CREATE), true);
  assert.equal(actionIds.has(ACTION_IDS.CONSOLE_BILLING_PLAN_UPDATE), true);
  assert.equal(actionIds.has(ACTION_IDS.CONSOLE_BILLING_PRODUCT_CREATE), true);
  assert.equal(actionIds.has(ACTION_IDS.CONSOLE_BILLING_PRODUCT_UPDATE), true);
  assert.equal(actionIds.has(ACTION_IDS.CHAT_THREAD_MESSAGE_SEND), true);
  assert.equal(actionIds.has(ACTION_IDS.CHAT_ATTACHMENT_UPLOAD), true);

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
