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
  BILLING_PURCHASES_LIST: "console.billing.purchases.list",
  BILLING_PURCHASE_REFUND: "console.billing.purchase.refund",
  BILLING_PURCHASE_VOID: "console.billing.purchase.void",
  BILLING_PURCHASE_CORRECTION_CREATE: "console.billing.purchase.correction.create",
  BILLING_PLAN_ASSIGNMENTS_LIST: "console.billing.plan_assignments.list",
  BILLING_PLAN_ASSIGNMENT_CREATE: "console.billing.plan_assignment.create",
  BILLING_PLAN_ASSIGNMENT_UPDATE: "console.billing.plan_assignment.update",
  BILLING_PLAN_ASSIGNMENT_CANCEL: "console.billing.plan_assignment.cancel",
  BILLING_SUBSCRIPTIONS_LIST: "console.billing.subscriptions.list",
  BILLING_SUBSCRIPTION_CHANGE_PLAN: "console.billing.subscription.change_plan",
  BILLING_SUBSCRIPTION_CANCEL: "console.billing.subscription.cancel",
  BILLING_SUBSCRIPTION_CANCEL_AT_PERIOD_END: "console.billing.subscription.cancel_at_period_end",
  BILLING_ENTITLEMENT_DEFINITIONS_LIST: "console.billing.entitlement_definitions.list",
  BILLING_ENTITLEMENT_DEFINITION_GET: "console.billing.entitlement_definition.get",
  BILLING_PROVIDER_PRICES_LIST: "console.billing.provider_prices.list",
  BILLING_PLAN_CREATE: "console.billing.plan.create",
  BILLING_PRODUCT_CREATE: "console.billing.product.create",
  BILLING_PLAN_UPDATE: "console.billing.plan.update",
  BILLING_PRODUCT_UPDATE: "console.billing.product.update"
});

function normalizeIdempotencyKey(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function requireIdempotencyKey(request) {
  const idempotencyKey = normalizeIdempotencyKey(request?.headers?.["idempotency-key"]);
  if (!idempotencyKey) {
    throw new AppError(400, "Idempotency-Key header is required.", {
      code: "IDEMPOTENCY_KEY_REQUIRED"
    });
  }

  return idempotencyKey;
}

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

  async function listBillingPurchases(request, reply) {
    const query = request.query || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PURCHASES_LIST,
      request,
      input: query
    });

    reply.code(200).send(response);
  }

  async function refundBillingPurchase(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const params = request.params || {};
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PURCHASE_REFUND,
      request,
      input: {
        ...payload,
        purchaseId: params.purchaseId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function voidBillingPurchase(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const params = request.params || {};
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PURCHASE_VOID,
      request,
      input: {
        ...payload,
        purchaseId: params.purchaseId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function createBillingPurchaseCorrection(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const params = request.params || {};
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PURCHASE_CORRECTION_CREATE,
      request,
      input: {
        ...payload,
        purchaseId: params.purchaseId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function listBillingPlanAssignments(request, reply) {
    const query = request.query || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PLAN_ASSIGNMENTS_LIST,
      request,
      input: query
    });

    reply.code(200).send(response);
  }

  async function createBillingPlanAssignment(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PLAN_ASSIGNMENT_CREATE,
      request,
      input: {
        ...payload,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function updateBillingPlanAssignment(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const params = request.params || {};
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PLAN_ASSIGNMENT_UPDATE,
      request,
      input: {
        ...payload,
        assignmentId: params.assignmentId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function cancelBillingPlanAssignment(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const params = request.params || {};
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_PLAN_ASSIGNMENT_CANCEL,
      request,
      input: {
        ...payload,
        assignmentId: params.assignmentId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function listBillingSubscriptions(request, reply) {
    const query = request.query || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_SUBSCRIPTIONS_LIST,
      request,
      input: query
    });

    reply.code(200).send(response);
  }

  async function changeBillingSubscriptionPlan(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const params = request.params || {};
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_SUBSCRIPTION_CHANGE_PLAN,
      request,
      input: {
        ...payload,
        providerSubscriptionId: params.providerSubscriptionId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function cancelBillingSubscription(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const params = request.params || {};
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_SUBSCRIPTION_CANCEL,
      request,
      input: {
        ...payload,
        providerSubscriptionId: params.providerSubscriptionId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function cancelBillingSubscriptionAtPeriodEnd(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const params = request.params || {};
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_SUBSCRIPTION_CANCEL_AT_PERIOD_END,
      request,
      input: {
        ...payload,
        providerSubscriptionId: params.providerSubscriptionId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function listBillingEntitlementDefinitions(request, reply) {
    const query = request.query || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_ENTITLEMENT_DEFINITIONS_LIST,
      request,
      input: query
    });

    reply.code(200).send(response);
  }

  async function getBillingEntitlementDefinition(request, reply) {
    const params = request.params || {};
    const response = await executeAction(actionExecutor, {
      actionId: CONSOLE_ACTION_IDS.BILLING_ENTITLEMENT_DEFINITION_GET,
      request,
      input: {
        definitionId: params.definitionId
      }
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
    listBillingPurchases,
    refundBillingPurchase,
    voidBillingPurchase,
    createBillingPurchaseCorrection,
    listBillingPlanAssignments,
    createBillingPlanAssignment,
    updateBillingPlanAssignment,
    cancelBillingPlanAssignment,
    listBillingSubscriptions,
    changeBillingSubscriptionPlan,
    cancelBillingSubscription,
    cancelBillingSubscriptionAtPeriodEnd,
    listBillingEntitlementDefinitions,
    getBillingEntitlementDefinition,
    createBillingPlan,
    createBillingProduct,
    listBillingProviderPrices,
    updateBillingPlan,
    updateBillingProduct
  };
}

export { createController };
