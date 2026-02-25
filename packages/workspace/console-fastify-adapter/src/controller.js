import { AppError } from "@jskit-ai/server-runtime-core/errors";

const CONSOLE_ACTION_IDS = Object.freeze({
  BOOTSTRAP_READ: "console.bootstrap.read",
  ROLES_LIST: "console.roles.list",
  SETTINGS_READ: "console.settings.read",
  SETTINGS_UPDATE: "console.settings.update",
  BILLING_SETTINGS_READ: "console.billing.settings.read",
  BILLING_SETTINGS_UPDATE: "console.billing.settings.update",
  MEMBERS_LIST: "console.members.list",
  MEMBER_ROLE_UPDATE: "console.member.role.update",
  INVITES_LIST: "console.invites.list",
  INVITE_CREATE: "console.invite.create",
  INVITE_REVOKE: "console.invite.revoke",
  INVITATIONS_PENDING_LIST: "console.invitations.pending.list",
  INVITE_REDEEM: "console.invite.redeem",
  AI_TRANSCRIPTS_LIST: "console.ai.transcripts.list",
  AI_TRANSCRIPT_MESSAGES_GET: "console.ai.transcript.messages.get",
  AI_TRANSCRIPTS_EXPORT: "console.ai.transcripts.export",
  BILLING_EVENTS_LIST: "console.billing.events.list",
  BILLING_PLANS_LIST: "console.billing.plans.list",
  BILLING_PRODUCTS_LIST: "console.billing.products.list",
  BILLING_PROVIDER_PRICES_LIST: "console.billing.provider_prices.list",
  BILLING_PLAN_CREATE: "console.billing.plan.create",
  BILLING_PRODUCT_CREATE: "console.billing.product.create",
  BILLING_PLAN_UPDATE: "console.billing.plan.update",
  BILLING_PRODUCT_UPDATE: "console.billing.product.update"
});

async function executeAction(actionExecutor, { actionId, request, input = {} }) {
  return actionExecutor.execute({
    actionId,
    input,
    context: {
      request,
      channel: "api"
    }
  });
}

function createController({ aiTranscriptsService = null, actionExecutor }) {
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }

  async function bootstrap(request, reply) {
    const payload = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BOOTSTRAP_READ,
      request
    });
    reply.code(200).send(payload);
  }

  async function listRoles(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.ROLES_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async function getAssistantSettings(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.SETTINGS_READ,
      request
    });
    reply.code(200).send(response);
  }

  async function updateAssistantSettings(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.SETTINGS_UPDATE,
      request,
      input: payload
    });

    reply.code(200).send(response);
  }

  async function getBillingSettings(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_SETTINGS_READ,
      request
    });
    reply.code(200).send(response);
  }

  async function updateBillingSettings(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_SETTINGS_UPDATE,
      request,
      input: payload
    });

    reply.code(200).send(response);
  }

  async function listMembers(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.MEMBERS_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async function updateMemberRole(request, reply) {
    const memberUserId = request.params?.memberUserId;
    const roleId = request.body?.roleId;
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.MEMBER_ROLE_UPDATE,
      request,
      input: {
        memberUserId,
        roleId
      }
    });

    reply.code(200).send(response);
  }

  async function listInvites(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.INVITES_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async function createInvite(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.INVITE_CREATE,
      request,
      input: payload
    });

    reply.code(200).send(response);
  }

  async function revokeInvite(request, reply) {
    const inviteId = request.params?.inviteId;
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.INVITE_REVOKE,
      request,
      input: {
        inviteId
      }
    });

    reply.code(200).send(response);
  }

  async function listPendingInvites(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.INVITATIONS_PENDING_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async function respondToPendingInviteByToken(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.INVITE_REDEEM,
      request,
      input: payload
    });

    reply.code(200).send(response);
  }

  function ensureAiTranscriptsService() {
    if (!aiTranscriptsService) {
      throw new AppError(501, "AI transcripts service is not available.");
    }
  }

  async function listAiTranscripts(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.AI_TRANSCRIPTS_LIST,
      request,
      input: query
    });

    reply.code(200).send(response);
  }

  async function getAiTranscriptMessages(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};
    const conversationId = request.params?.conversationId;

    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.AI_TRANSCRIPT_MESSAGES_GET,
      request,
      input: {
        ...query,
        conversationId
      }
    });

    reply.code(200).send(response);
  }

  async function exportAiTranscripts(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};

    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.AI_TRANSCRIPTS_EXPORT,
      request,
      input: query
    });

    reply.code(200).send(response);
  }

  async function listBillingEvents(request, reply) {
    const query = request.query || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_EVENTS_LIST,
      request,
      input: query
    });

    reply.code(200).send(response);
  }

  async function listBillingPlans(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PLANS_LIST,
      request
    });

    reply.code(200).send(response);
  }

  async function listBillingProducts(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PRODUCTS_LIST,
      request
    });

    reply.code(200).send(response);
  }

  async function listBillingProviderPrices(request, reply) {
    const query = request.query || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PROVIDER_PRICES_LIST,
      request,
      input: query
    });

    reply.code(200).send(response);
  }

  async function createBillingPlan(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PLAN_CREATE,
      request,
      input: payload
    });

    reply.code(200).send(response);
  }

  async function createBillingProduct(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PRODUCT_CREATE,
      request,
      input: payload
    });

    reply.code(200).send(response);
  }

  async function updateBillingPlan(request, reply) {
    const params = request.params || {};
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PLAN_UPDATE,
      request,
      input: {
        ...payload,
        planId: params.planId
      }
    });

    reply.code(200).send(response);
  }

  async function updateBillingProduct(request, reply) {
    const params = request.params || {};
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PRODUCT_UPDATE,
      request,
      input: {
        ...payload,
        productId: params.productId
      }
    });

    reply.code(200).send(response);
  }

  return {
    bootstrap,
    listRoles,
    getAssistantSettings,
    updateAssistantSettings,
    getBillingSettings,
    updateBillingSettings,
    listMembers,
    updateMemberRole,
    listInvites,
    createInvite,
    revokeInvite,
    listPendingInvites,
    respondToPendingInviteByToken,
    listAiTranscripts,
    getAiTranscriptMessages,
    exportAiTranscripts,
    listBillingEvents,
    listBillingPlans,
    listBillingProducts,
    createBillingPlan,
    createBillingProduct,
    listBillingProviderPrices,
    updateBillingPlan,
    updateBillingProduct
  };
}

export { createController };
