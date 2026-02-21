import { AppError } from "../../lib/errors.js";
import { isMysqlDuplicateEntryError } from "../../lib/primitives/mysqlErrors.js";
import { BILLING_DEFAULT_PROVIDER, BILLING_PROVIDER_PADDLE, BILLING_PROVIDER_STRIPE } from "./constants.js";
import {
  createService as createWebhookProjectionService,
  parseUnixEpochSeconds
} from "./webhookProjection.service.js";
import { createService as createStripeWebhookTranslationService } from "./providers/stripe/webhookTranslation.service.js";
import {
  PADDLE_EVENT_TYPE_MAP,
  createService as createPaddleWebhookTranslationService,
  mapPaddleEventType,
  normalizePaddleEventToCanonical
} from "./providers/paddle/webhookTranslation.service.js";
import {
  REQUIRED_CANONICAL_BILLING_WEBHOOK_EVENT_TYPES,
  normalizeBillingWebhookProvider
} from "./providers/shared/webhookTranslation.contract.js";
import { createService as createBillingWebhookTranslationRegistryService } from "./providers/shared/webhookTranslationRegistry.service.js";

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

function createService(options = {}) {
  const {
    billingRepository,
    billingProviderAdapter,
    billingProviderRegistryService,
    billingCheckoutSessionService,
    billingWebhookTranslationRegistryService = null,
    stripeWebhookEndpointSecret,
    paddleWebhookEndpointSecret,
    observabilityService = null,
    payloadRetentionDays = 30
  } = options;
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (typeof billingRepository.transaction !== "function") {
    throw new Error("billingRepository.transaction is required.");
  }
  const providerAdapter = billingProviderAdapter;
  if (!providerAdapter || typeof providerAdapter.verifyWebhookEvent !== "function") {
    throw new Error("billingProviderAdapter.verifyWebhookEvent is required.");
  }
  if (!billingCheckoutSessionService) {
    throw new Error("billingCheckoutSessionService is required.");
  }

  const endpointSecretByProvider = {
    [BILLING_PROVIDER_STRIPE]: String(stripeWebhookEndpointSecret || "").trim(),
    [BILLING_PROVIDER_PADDLE]: String(paddleWebhookEndpointSecret || "").trim()
  };

  const webhookTranslationRegistry =
    billingWebhookTranslationRegistryService ||
    createBillingWebhookTranslationRegistryService({
      translators: [createStripeWebhookTranslationService(), createPaddleWebhookTranslationService()],
      defaultProvider: BILLING_DEFAULT_PROVIDER
    });
  const supportedWebhookProviders = new Set(
    typeof webhookTranslationRegistry.listProviders === "function"
      ? webhookTranslationRegistry.listProviders()
      : [BILLING_PROVIDER_STRIPE, BILLING_PROVIDER_PADDLE]
  );

  const normalizedPayloadRetentionDays = Math.max(1, Number(payloadRetentionDays) || 30);

  const projectionServiceByProvider = new Map();

  async function resolveBillableEntityIdFromCustomerId(customerId, provider, trx) {
    const providerCustomerId = toNullableString(customerId);
    if (!providerCustomerId || typeof billingRepository.findCustomerByProviderCustomerId !== "function") {
      return null;
    }

    const customer = await billingRepository.findCustomerByProviderCustomerId(
      {
        provider,
        providerCustomerId
      },
      trx ? { trx } : {}
    );
    return toPositiveInteger(customer?.billableEntityId);
  }

  async function resolveBillableEntityIdFromSubscriptionId(providerSubscriptionId, provider, trx) {
    const normalizedSubscriptionId = toNullableString(providerSubscriptionId);
    if (!normalizedSubscriptionId || typeof billingRepository.findSubscriptionByProviderSubscriptionId !== "function") {
      return null;
    }

    const subscription = await billingRepository.findSubscriptionByProviderSubscriptionId(
      {
        provider,
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

  async function extractCorrelationFromEvent(event, { provider, trx } = {}) {
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
        billableEntityId = await resolveBillableEntityIdFromCustomerId(eventObject.customer, provider, trx);
      }
    }

    if (!billableEntityId && (eventType === "invoice.paid" || eventType === "invoice.payment_failed")) {
      billableEntityId = await resolveBillableEntityIdFromSubscriptionId(eventObject.subscription, provider, trx);
      if (!billableEntityId) {
        billableEntityId = await resolveBillableEntityIdFromCustomerId(eventObject.customer, provider, trx);
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

  function resolveProviderAdapter(provider) {
    if (billingProviderRegistryService && typeof billingProviderRegistryService.resolveProvider === "function") {
      return billingProviderRegistryService.resolveProvider(provider);
    }
    return providerAdapter;
  }

  function resolveWebhookTranslator(provider) {
    const normalizedProvider = normalizeBillingWebhookProvider(provider);
    if (!normalizedProvider) {
      throw new AppError(400, "Unsupported billing webhook provider.");
    }

    if (!webhookTranslationRegistry || typeof webhookTranslationRegistry.resolveProvider !== "function") {
      throw new AppError(500, "Billing webhook translation registry is unavailable.");
    }

    try {
      return webhookTranslationRegistry.resolveProvider(normalizedProvider);
    } catch {
      throw new AppError(400, "Unsupported billing webhook provider.");
    }
  }

  function resolveProjectionService(provider) {
    const normalizedProvider = normalizeBillingWebhookProvider(provider);
    if (projectionServiceByProvider.has(normalizedProvider)) {
      return projectionServiceByProvider.get(normalizedProvider);
    }

    const scopedProviderAdapter = resolveProviderAdapter(normalizedProvider);
    const projectionService = createWebhookProjectionService({
      billingRepository,
      billingCheckoutSessionService,
      billingProviderAdapter: scopedProviderAdapter,
      observabilityService
    });
    projectionServiceByProvider.set(normalizedProvider, projectionService);
    return projectionService;
  }

  async function lockOrCreateWebhookEvent({
    providerEventId,
    eventType,
    providerCreatedAt,
    payloadJson,
    billableEntityId,
    operationKey,
    provider,
    now,
    trx
  }) {
    let existing = await billingRepository.findWebhookEventByProviderEventId(
      {
        provider,
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
            provider,
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
          provider,
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
            provider,
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

  async function routeEvent(event, eventContext) {
    const projectionService = resolveProjectionService(eventContext.provider);
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
      await projectionService.projectSubscription(event.data?.object, eventContext);
      return;
    }

    if (eventType === "invoice.paid" || eventType === "invoice.payment_failed") {
      await projectionService.projectInvoiceAndPayment(event.data?.object, {
        ...eventContext,
        eventType
      });
    }
  }

  async function processEventTransaction(event, { provider }) {
    const providerEventId = String(event?.id || "").trim();
    const eventType = String(event?.type || "").trim();
    const providerCreatedAt = parseUnixEpochSeconds(event?.created) || new Date();
    const now = new Date();
    const initialCorrelation = await extractCorrelationFromEvent(event, {
      provider
    });

    await billingRepository.transaction(async (trx) => {
      await lockOrCreateWebhookEvent({
        providerEventId,
        eventType,
        providerCreatedAt,
        billableEntityId: initialCorrelation.billableEntityId,
        operationKey: initialCorrelation.operationKey,
        provider,
        payloadJson: event,
        now,
        trx
      });
    });

    try {
      const result = await billingRepository.transaction(async (trx) => {
        const eventRow = await billingRepository.findWebhookEventByProviderEventId(
          {
            provider,
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
          await extractCorrelationFromEvent(event, { provider, trx }),
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

        await routeEvent(event, {
          trx,
          providerEventId,
          providerCreatedAt,
          provider,
          billableEntityId: processingCorrelation.billableEntityId || eventRow.billableEntityId || null
        });

        const processedCorrelation = buildCorrelationPatch(
          await extractCorrelationFromEvent(event, { provider, trx }),
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
            provider,
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
    const normalizedProvider = normalizeBillingWebhookProvider(provider);
    if (!supportedWebhookProviders.has(normalizedProvider)) {
      throw new AppError(400, "Unsupported billing webhook provider.");
    }

    if (!Buffer.isBuffer(rawBody)) {
      throw new AppError(400, "Webhook raw body is required.");
    }

    const signature = String(signatureHeader || "").trim();
    if (!signature) {
      throw new AppError(
        400,
        normalizedProvider === BILLING_PROVIDER_PADDLE
          ? "Paddle signature header is required."
          : "Stripe signature header is required."
      );
    }

    const endpointSecret = String(endpointSecretByProvider[normalizedProvider] || "").trim();
    if (!endpointSecret) {
      throw new AppError(500, `Billing webhook endpoint secret is not configured for provider "${normalizedProvider}".`);
    }

    const scopedProviderAdapter = resolveProviderAdapter(normalizedProvider);
    if (!scopedProviderAdapter || typeof scopedProviderAdapter.verifyWebhookEvent !== "function") {
      throw new AppError(500, `Billing webhook adapter is unavailable for provider "${normalizedProvider}".`);
    }
    const scopedWebhookTranslator = resolveWebhookTranslator(normalizedProvider);

    const providerEvent = await scopedProviderAdapter.verifyWebhookEvent({
      rawBody,
      signatureHeader: signature,
      endpointSecret
    });
    const canonicalEvent = scopedWebhookTranslator.toCanonicalEvent(providerEvent);

    const eventType = String(canonicalEvent?.type || "").trim();
    if (!scopedWebhookTranslator.supportsCanonicalEventType(eventType)) {
      return {
        ignored: true,
        eventId: String(canonicalEvent?.id || ""),
        eventType
      };
    }

    const processed = await processEventTransaction(canonicalEvent, {
      provider: normalizedProvider
    });
    return {
      ignored: false,
      ...processed
    };
  }

  async function reprocessStoredEvent({ provider = BILLING_DEFAULT_PROVIDER, eventPayload }) {
    if (!eventPayload || typeof eventPayload !== "object") {
      throw new AppError(400, "Stored billing webhook payload is required for replay.");
    }

    const providerEventId = String(eventPayload?.id || "").trim();
    if (!providerEventId) {
      throw new AppError(400, "Stored billing webhook payload is missing provider event id.");
    }

    const normalizedProvider = normalizeBillingWebhookProvider(provider);
    if (!supportedWebhookProviders.has(normalizedProvider)) {
      throw new AppError(400, "Unsupported billing webhook provider.");
    }

    return processEventTransaction(eventPayload, {
      provider: normalizedProvider
    });
  }

  return {
    processProviderEvent,
    reprocessStoredEvent
  };
}

const __testables = {
  REQUIRED_CANONICAL_BILLING_WEBHOOK_EVENT_TYPES,
  PADDLE_EVENT_TYPE_MAP,
  mapPaddleEventType,
  normalizePaddleEventToCanonical
};

export { REQUIRED_CANONICAL_BILLING_WEBHOOK_EVENT_TYPES, PADDLE_EVENT_TYPE_MAP, createService, __testables };
