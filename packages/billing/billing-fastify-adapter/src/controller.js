import { AppError } from "@jskit-ai/server-runtime-core/errors";

const BILLING_ACTION_IDS = Object.freeze({
  PLANS_LIST: "workspace.billing.plans.list",
  PRODUCTS_LIST: "workspace.billing.products.list",
  PURCHASES_LIST: "workspace.billing.purchases.list",
  PLAN_STATE_GET: "workspace.billing.plan_state.get",
  PAYMENT_METHODS_LIST: "workspace.billing.payment_methods.list",
  PAYMENT_METHODS_SYNC: "workspace.billing.payment_methods.sync",
  PAYMENT_METHOD_DEFAULT_SET: "workspace.billing.payment_methods.default.set",
  PAYMENT_METHOD_DETACH: "workspace.billing.payment_methods.detach",
  PAYMENT_METHOD_REMOVE: "workspace.billing.payment_methods.remove",
  LIMITATIONS_GET: "workspace.billing.limitations.get",
  TIMELINE_LIST: "workspace.billing.timeline.list",
  CHECKOUT_START: "workspace.billing.checkout.start",
  PLAN_CHANGE_REQUEST: "workspace.billing.plan_change.request",
  PLAN_CHANGE_CANCEL_PENDING: "workspace.billing.plan_change.cancel_pending",
  PORTAL_CREATE: "workspace.billing.portal.create",
  PAYMENT_LINK_CREATE: "workspace.billing.payment_link.create"
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

function createController({ billingWebhookService, actionExecutor }) {
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }
  if (!billingWebhookService) {
    throw new Error("billingWebhookService is required.");
  }

  async function listPlans(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PLANS_LIST,
      request
    });

    reply.code(200).send(response);
  }

  async function listProducts(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PRODUCTS_LIST,
      request
    });

    reply.code(200).send(response);
  }

  async function listPurchases(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PURCHASES_LIST,
      request
    });

    reply.code(200).send(response);
  }

  async function getPlanState(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PLAN_STATE_GET,
      request
    });

    reply.code(200).send(response);
  }

  async function listPaymentMethods(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PAYMENT_METHODS_LIST,
      request
    });

    reply.code(200).send(response);
  }

  async function syncPaymentMethods(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PAYMENT_METHODS_SYNC,
      request
    });

    reply.code(200).send(response);
  }

  async function setDefaultPaymentMethod(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PAYMENT_METHOD_DEFAULT_SET,
      request,
      input: {
        ...(request.body || {}),
        paymentMethodId: request.params?.paymentMethodId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function detachPaymentMethod(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PAYMENT_METHOD_DETACH,
      request,
      input: {
        ...(request.body || {}),
        paymentMethodId: request.params?.paymentMethodId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function removePaymentMethod(request, reply) {
    const idempotencyKey = requireIdempotencyKey(request);
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PAYMENT_METHOD_REMOVE,
      request,
      input: {
        ...(request.body || {}),
        paymentMethodId: request.params?.paymentMethodId,
        idempotencyKey
      }
    });

    reply.code(200).send(response);
  }

  async function getLimitations(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.LIMITATIONS_GET,
      request
    });

    reply.code(200).send(response);
  }

  async function getTimeline(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.TIMELINE_LIST,
      request,
      input: request.query || {}
    });

    reply.code(200).send(response);
  }

  async function startCheckout(request, reply) {
    requireIdempotencyKey(request);
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.CHECKOUT_START,
      request,
      input: request.body || {}
    });

    reply.code(200).send(response);
  }

  async function requestPlanChange(request, reply) {
    requireIdempotencyKey(request);
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PLAN_CHANGE_REQUEST,
      request,
      input: request.body || {}
    });

    reply.code(200).send(response);
  }

  async function cancelPendingPlanChange(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PLAN_CHANGE_CANCEL_PENDING,
      request
    });

    reply.code(200).send(response);
  }

  async function createPortalSession(request, reply) {
    requireIdempotencyKey(request);
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PORTAL_CREATE,
      request,
      input: request.body || {}
    });

    reply.code(200).send(response);
  }

  async function createPaymentLink(request, reply) {
    requireIdempotencyKey(request);
    const response = await executeAction(actionExecutor, {
      actionId: BILLING_ACTION_IDS.PAYMENT_LINK_CREATE,
      request,
      input: request.body || {}
    });

    reply.code(200).send(response);
  }

  async function processStripeWebhook(request, reply) {
    const rawBody = request.rawBody || null;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new AppError(400, "Webhook raw body is required.");
    }

    await billingWebhookService.processProviderEvent({
      provider: "stripe",
      rawBody,
      signatureHeader: request.headers?.["stripe-signature"]
    });

    reply.code(200).send({
      ok: true
    });
  }

  async function processPaddleWebhook(request, reply) {
    const rawBody = request.rawBody || null;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      throw new AppError(400, "Webhook raw body is required.");
    }

    await billingWebhookService.processProviderEvent({
      provider: "paddle",
      rawBody,
      signatureHeader: request.headers?.["paddle-signature"]
    });

    reply.code(200).send({
      ok: true
    });
  }

  return {
    listPlans,
    listProducts,
    listPurchases,
    getPlanState,
    listPaymentMethods,
    syncPaymentMethods,
    setDefaultPaymentMethod,
    detachPaymentMethod,
    removePaymentMethod,
    getLimitations,
    getTimeline,
    startCheckout,
    requestPlanChange,
    cancelPendingPlanChange,
    createPortalSession,
    createPaymentLink,
    processStripeWebhook,
    processPaddleWebhook
  };
}

const __testables = {
  normalizeIdempotencyKey,
  requireIdempotencyKey
};

export { createController, __testables };
