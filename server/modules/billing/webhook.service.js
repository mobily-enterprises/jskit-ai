import { AppError } from "../../lib/errors.js";
import { isMysqlDuplicateEntryError } from "../../lib/primitives/mysqlErrors.js";
import { BILLING_PROVIDER_STRIPE } from "./constants.js";
import {
  createService as createWebhookProjectionService,
  parseUnixEpochSeconds
} from "./webhookProjection.service.js";

const STRIPE_REQUIRED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed"
]);

function toNullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function createService({
  billingRepository,
  stripeSdkService,
  billingCheckoutSessionService,
  stripeWebhookEndpointSecret,
  observabilityService = null,
  payloadRetentionDays = 30
}) {
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (typeof billingRepository.transaction !== "function") {
    throw new Error("billingRepository.transaction is required.");
  }
  if (!stripeSdkService || typeof stripeSdkService.verifyWebhookEvent !== "function") {
    throw new Error("stripeSdkService.verifyWebhookEvent is required.");
  }
  if (!billingCheckoutSessionService) {
    throw new Error("billingCheckoutSessionService is required.");
  }

  const endpointSecret = String(stripeWebhookEndpointSecret || "").trim();
  if (!endpointSecret) {
    throw new Error("stripeWebhookEndpointSecret is required.");
  }
  const normalizedPayloadRetentionDays = Math.max(1, Number(payloadRetentionDays) || 30);

  const projectionService = createWebhookProjectionService({
    billingRepository,
    billingCheckoutSessionService,
    stripeSdkService,
    observabilityService
  });

  async function resolveBillableEntityIdFromCustomerId(customerId, trx) {
    const providerCustomerId = toNullableString(customerId);
    if (!providerCustomerId || typeof billingRepository.findCustomerByProviderCustomerId !== "function") {
      return null;
    }

    const customer = await billingRepository.findCustomerByProviderCustomerId(
      {
        provider: BILLING_PROVIDER_STRIPE,
        providerCustomerId
      },
      trx ? { trx } : {}
    );
    return toPositiveInteger(customer?.billableEntityId);
  }

  async function resolveBillableEntityIdFromSubscriptionId(providerSubscriptionId, trx) {
    const normalizedSubscriptionId = toNullableString(providerSubscriptionId);
    if (!normalizedSubscriptionId || typeof billingRepository.findSubscriptionByProviderSubscriptionId !== "function") {
      return null;
    }

    const subscription = await billingRepository.findSubscriptionByProviderSubscriptionId(
      {
        provider: BILLING_PROVIDER_STRIPE,
        providerSubscriptionId: normalizedSubscriptionId
      },
      trx ? { trx } : {}
    );
    return toPositiveInteger(subscription?.billableEntityId);
  }

  async function resolveExistingBillableEntityId(candidateBillableEntityId, trx) {
    const normalizedBillableEntityId = toPositiveInteger(candidateBillableEntityId);
    if (!normalizedBillableEntityId) {
      return null;
    }

    if (typeof billingRepository.findBillableEntityById !== "function") {
      return normalizedBillableEntityId;
    }

    const billableEntity = await billingRepository.findBillableEntityById(
      normalizedBillableEntityId,
      trx ? { trx } : {}
    );
    return billableEntity ? normalizedBillableEntityId : null;
  }

  async function extractCorrelationFromStripeEvent(event, { trx } = {}) {
    const eventType = String(event?.type || "").trim();
    const eventObject = event?.data?.object && typeof event.data.object === "object" ? event.data.object : {};
    const metadata = eventObject?.metadata && typeof eventObject.metadata === "object" ? eventObject.metadata : {};

    let billableEntityId = await resolveExistingBillableEntityId(metadata.billable_entity_id, trx);
    const operationKey = toNullableString(metadata.operation_key);

    if (!billableEntityId) {
      if (
        eventType === "checkout.session.completed" ||
        eventType === "checkout.session.expired" ||
        eventType === "customer.subscription.created" ||
        eventType === "customer.subscription.updated" ||
        eventType === "customer.subscription.deleted"
      ) {
        billableEntityId = await resolveBillableEntityIdFromCustomerId(eventObject.customer, trx);
      }
    }

    if (!billableEntityId && (eventType === "invoice.paid" || eventType === "invoice.payment_failed")) {
      billableEntityId = await resolveBillableEntityIdFromSubscriptionId(eventObject.subscription, trx);
      if (!billableEntityId) {
        billableEntityId = await resolveBillableEntityIdFromCustomerId(eventObject.customer, trx);
      }
    }

    return {
      billableEntityId,
      operationKey
    };
  }

  function buildCorrelationPatch(...candidates) {
    let billableEntityId = null;
    let operationKey = null;

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      if (!billableEntityId) {
        billableEntityId = toPositiveInteger(candidate.billableEntityId);
      }
      if (!operationKey) {
        operationKey = toNullableString(candidate.operationKey);
      }
    }

    const patch = {};
    if (billableEntityId) {
      patch.billableEntityId = billableEntityId;
    }
    if (operationKey) {
      patch.operationKey = operationKey;
    }
    return patch;
  }

  function recordGuardrail(code, context = {}) {
    const payload = {
      code,
      ...(context && typeof context === "object" ? context : {})
    };

    if (observabilityService && typeof observabilityService.recordBillingGuardrail === "function") {
      observabilityService.recordBillingGuardrail(payload);
      return;
    }

    if (!observabilityService || typeof observabilityService.recordDbError !== "function") {
      return;
    }

    observabilityService.recordDbError({
      code
    });
  }

  async function lockOrCreateWebhookEvent({
    providerEventId,
    eventType,
    providerCreatedAt,
    payloadJson,
    billableEntityId,
    operationKey,
    now,
    trx
  }) {
    let existing = await billingRepository.findWebhookEventByProviderEventId(
      {
        provider: BILLING_PROVIDER_STRIPE,
        providerEventId
      },
      {
        trx,
        forUpdate: true
      }
    );

    if (!existing) {
      try {
        await billingRepository.insertWebhookEvent(
          {
            provider: BILLING_PROVIDER_STRIPE,
            providerEventId,
            eventType,
            providerCreatedAt,
            billableEntityId,
            operationKey,
            status: "received",
            receivedAt: now,
            processingStartedAt: null,
            attemptCount: 0,
            payloadJson,
            payloadRetentionUntil: new Date(now.getTime() + normalizedPayloadRetentionDays * 24 * 60 * 60 * 1000)
          },
          { trx }
        );
      } catch (error) {
        if (!isMysqlDuplicateEntryError(error)) {
          throw error;
        }
      }

      existing = await billingRepository.findWebhookEventByProviderEventId(
        {
          provider: BILLING_PROVIDER_STRIPE,
          providerEventId
        },
        {
          trx,
          forUpdate: true
        }
      );
    }

    if (!existing) {
      throw new AppError(500, "Failed to initialize webhook event state.");
    }

    if (existing) {
      const correlationPatch = {};
      if (!existing.billableEntityId && billableEntityId) {
        correlationPatch.billableEntityId = billableEntityId;
      }
      if (!existing.operationKey && operationKey) {
        correlationPatch.operationKey = operationKey;
      }
      if (Object.keys(correlationPatch).length > 0) {
        await billingRepository.updateWebhookEventById(existing.id, correlationPatch, { trx });
        existing = await billingRepository.findWebhookEventByProviderEventId(
          {
            provider: BILLING_PROVIDER_STRIPE,
            providerEventId
          },
          {
            trx,
            forUpdate: true
          }
        );
      }
    }

    return existing;
  }

  async function routeStripeEvent(event, eventContext) {
    const eventType = String(event?.type || "").trim();

    if (eventType === "checkout.session.completed") {
      await projectionService.handleCheckoutSessionCompleted(event.data?.object, eventContext);
      return;
    }

    if (eventType === "checkout.session.expired") {
      await projectionService.handleCheckoutSessionExpired(event.data?.object, eventContext);
      return;
    }

    if (
      eventType === "customer.subscription.created" ||
      eventType === "customer.subscription.updated" ||
      eventType === "customer.subscription.deleted"
    ) {
      await projectionService.projectSubscriptionFromStripe(event.data?.object, eventContext);
      return;
    }

    if (eventType === "invoice.paid" || eventType === "invoice.payment_failed") {
      await projectionService.projectInvoiceAndPaymentFromStripe(event.data?.object, {
        ...eventContext,
        eventType
      });
    }
  }

  async function processEventTransaction(event) {
    const providerEventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "").trim();
    const providerCreatedAt = parseUnixEpochSeconds(event?.created) || new Date();
    const now = new Date();
    const initialCorrelation = await extractCorrelationFromStripeEvent(event);

    await billingRepository.transaction(async (trx) => {
      await lockOrCreateWebhookEvent({
        providerEventId,
        eventType,
        providerCreatedAt,
        billableEntityId: initialCorrelation.billableEntityId,
        operationKey: initialCorrelation.operationKey,
        payloadJson: event,
        now,
        trx
      });
    });

    try {
      const result = await billingRepository.transaction(async (trx) => {
        const eventRow = await billingRepository.findWebhookEventByProviderEventId(
          {
            provider: BILLING_PROVIDER_STRIPE,
            providerEventId
          },
          {
            trx,
            forUpdate: true
          }
        );
        if (!eventRow) {
          throw new AppError(500, "Failed to load webhook event state.");
        }

        if (eventRow.status === "processed") {
          return {
            duplicate: true,
            eventId: providerEventId,
            eventType
          };
        }

        const processingCorrelation = buildCorrelationPatch(
          await extractCorrelationFromStripeEvent(event, { trx }),
          eventRow
        );

        await billingRepository.updateWebhookEventById(
          eventRow.id,
          {
            status: "processing",
            processingStartedAt: now,
            attemptCount: Number(eventRow.attemptCount || 0) + 1,
            errorText: null,
            ...processingCorrelation
          },
          { trx }
        );

        await routeStripeEvent(event, {
          trx,
          providerEventId,
          providerCreatedAt,
          billableEntityId: processingCorrelation.billableEntityId || eventRow.billableEntityId || null
        });

        const processedCorrelation = buildCorrelationPatch(
          await extractCorrelationFromStripeEvent(event, { trx }),
          processingCorrelation,
          eventRow
        );

        await billingRepository.updateWebhookEventById(
          eventRow.id,
          {
            status: "processed",
            processedAt: now,
            errorText: null,
            ...processedCorrelation
          },
          { trx }
        );

        return {
          duplicate: false,
          eventId: providerEventId,
          eventType
        };
      });

      return result;
    } catch (error) {
      await billingRepository.transaction(async (trx) => {
        const eventRow = await billingRepository.findWebhookEventByProviderEventId(
          {
            provider: BILLING_PROVIDER_STRIPE,
            providerEventId
          },
          {
            trx,
            forUpdate: true
          }
        );
        if (!eventRow || eventRow.status === "processed") {
          return;
        }

        const failedCorrelation = buildCorrelationPatch(initialCorrelation, eventRow);

        await billingRepository.updateWebhookEventById(
          eventRow.id,
          {
            status: "failed",
            lastFailedAt: now,
            errorText: String(error?.message || "Webhook processing failed."),
            ...failedCorrelation
          },
          { trx }
        );
      });

      recordGuardrail("BILLING_WEBHOOK_PROCESSING_FAILED", {
        providerEventId
      });

      throw error;
    }
  }

  async function processProviderEvent({ provider, rawBody, signatureHeader }) {
    const normalizedProvider = String(provider || "")
      .trim()
      .toLowerCase();
    if (normalizedProvider !== BILLING_PROVIDER_STRIPE) {
      throw new AppError(400, "Unsupported billing webhook provider.");
    }

    if (!Buffer.isBuffer(rawBody)) {
      throw new AppError(400, "Webhook raw body is required.");
    }

    const signature = String(signatureHeader || "").trim();
    if (!signature) {
      throw new AppError(400, "Stripe signature header is required.");
    }

    const event = await stripeSdkService.verifyWebhookEvent({
      rawBody,
      signatureHeader: signature,
      endpointSecret
    });

    const eventType = String(event?.type || "").trim();
    if (!STRIPE_REQUIRED_EVENT_TYPES.has(eventType)) {
      return {
        ignored: true,
        eventId: String(event?.id || ""),
        eventType
      };
    }

    const processed = await processEventTransaction(event);
    return {
      ignored: false,
      ...processed
    };
  }

  async function reprocessStoredEvent({ eventPayload }) {
    if (!eventPayload || typeof eventPayload !== "object") {
      throw new AppError(400, "Stored billing webhook payload is required for replay.");
    }

    const providerEventId = String(eventPayload?.id || "").trim();
    if (!providerEventId) {
      throw new AppError(400, "Stored billing webhook payload is missing provider event id.");
    }

    return processEventTransaction(eventPayload);
  }

  return {
    processProviderEvent,
    reprocessStoredEvent
  };
}

const __testables = {
  STRIPE_REQUIRED_EVENT_TYPES
};

export { STRIPE_REQUIRED_EVENT_TYPES, createService, __testables };
