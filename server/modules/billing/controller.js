import { AppError } from "../../lib/errors.js";

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

function createController({ billingService, billingWebhookService }) {
  if (!billingService) {
    throw new Error("billingService is required.");
  }
  if (!billingWebhookService) {
    throw new Error("billingWebhookService is required.");
  }

  async function listPlans(request, reply) {
    const response = await billingService.listPlans({
      request,
      user: request.user
    });

    reply.code(200).send(response);
  }

  async function getSubscriptionSnapshot(request, reply) {
    const response = await billingService.getSnapshot({
      request,
      user: request.user
    });

    reply.code(200).send(response);
  }

  async function getPlanState(request, reply) {
    const response = await billingService.getPlanState({
      request,
      user: request.user
    });

    reply.code(200).send(response);
  }

  async function listPaymentMethods(request, reply) {
    const response = await billingService.listPaymentMethods({
      request,
      user: request.user
    });

    reply.code(200).send(response);
  }

  async function syncPaymentMethods(request, reply) {
    const response = await billingService.syncPaymentMethods({
      request,
      user: request.user
    });

    reply.code(200).send(response);
  }

  async function getLimitations(request, reply) {
    const response = await billingService.getLimitations({
      request,
      user: request.user
    });

    reply.code(200).send(response);
  }

  async function getTimeline(request, reply) {
    const response = await billingService.listTimeline({
      request,
      user: request.user,
      query: request.query || {}
    });

    reply.code(200).send(response);
  }

  async function startCheckout(request, reply) {
    const response = await billingService.startCheckout({
      request,
      user: request.user,
      payload: request.body || {},
      clientIdempotencyKey: requireIdempotencyKey(request)
    });

    reply.code(200).send(response);
  }

  async function requestPlanChange(request, reply) {
    const response = await billingService.requestPlanChange({
      request,
      user: request.user,
      payload: request.body || {},
      clientIdempotencyKey: requireIdempotencyKey(request)
    });

    reply.code(200).send(response);
  }

  async function cancelPendingPlanChange(request, reply) {
    const response = await billingService.cancelPendingPlanChange({
      request,
      user: request.user
    });

    reply.code(200).send(response);
  }

  async function createPortalSession(request, reply) {
    const response = await billingService.createPortalSession({
      request,
      user: request.user,
      payload: request.body || {},
      clientIdempotencyKey: requireIdempotencyKey(request)
    });

    reply.code(200).send(response);
  }

  async function createPaymentLink(request, reply) {
    const response = await billingService.createPaymentLink({
      request,
      user: request.user,
      payload: request.body || {},
      clientIdempotencyKey: requireIdempotencyKey(request)
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
    getPlanState,
    getSubscriptionSnapshot,
    listPaymentMethods,
    syncPaymentMethods,
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
