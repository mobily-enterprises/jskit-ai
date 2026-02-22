import { AppError } from "../../../../lib/errors.js";
import { BILLING_PROVIDER_STRIPE, resolveProviderSdkName } from "../../constants.js";
import { mapStripeProviderError } from "./errorMapping.js";

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallbackValue;
  }

  return parsed;
}

function normalizeApiVersion(value) {
  return String(value || "").trim();
}

function normalizeSecret(value) {
  return String(value || "").trim();
}

function toNullableInteger(value, { minimum = null } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (minimum != null && parsed < minimum) {
    return null;
  }
  return parsed;
}

function toNullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function mapStripePriceRecord(price) {
  const recurring = price?.recurring && typeof price.recurring === "object" ? price.recurring : null;
  const product = price?.product && typeof price.product === "object" ? price.product : null;
  const currency = toNullableString(price?.currency);
  return {
    id: String(price?.id || ""),
    provider: BILLING_PROVIDER_STRIPE,
    productId: toNullableString(product?.id || price?.product),
    productName: toNullableString(product?.name),
    nickname: toNullableString(price?.nickname),
    currency: currency ? currency.toUpperCase() : null,
    unitAmountMinor: toNullableInteger(price?.unit_amount, { minimum: 0 }),
    interval: toNullableString(recurring?.interval),
    intervalCount: toNullableInteger(recurring?.interval_count, { minimum: 1 }),
    usageType: toNullableString(recurring?.usage_type),
    active: Boolean(price?.active)
  };
}

function resolveDefaultPaymentMethodId(customer) {
  const candidate = customer?.invoice_settings?.default_payment_method;
  if (!candidate) {
    return null;
  }

  if (typeof candidate === "string") {
    const normalized = String(candidate || "").trim();
    return normalized || null;
  }

  const nestedId = String(candidate?.id || "").trim();
  return nestedId || null;
}

function resolvePrimarySubscriptionItemId(subscription) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const activeItem =
    items.find((item) => item && !item.deleted && String(item?.price?.type || "recurring").trim() !== "one_time") || null;
  const fallback = activeItem || items[0] || null;
  const itemId = String(fallback?.id || "").trim();
  return itemId || null;
}

async function loadStripeModule() {
  const mod = await import("stripe");
  const StripeCtor = mod?.default || mod?.Stripe || null;
  if (!StripeCtor) {
    throw new Error("Stripe SDK module did not expose a constructor.");
  }

  return {
    StripeCtor,
    moduleVersion: String(StripeCtor.PACKAGE_VERSION || StripeCtor.VERSION || "").trim() || "unknown"
  };
}

function createService({
  enabled = false,
  secretKey = "",
  apiVersion = "",
  maxNetworkRetries = 2,
  timeoutMs = 30_000,
  stripeLoader = loadStripeModule
} = {}) {
  const providerSdkName = resolveProviderSdkName(BILLING_PROVIDER_STRIPE);
  const billingEnabled = enabled === true;
  const normalizedSecretKey = normalizeSecret(secretKey);
  const normalizedApiVersion = normalizeApiVersion(apiVersion);
  const normalizedMaxNetworkRetries = parsePositiveInteger(maxNetworkRetries, 2);
  const normalizedTimeoutMs = parsePositiveInteger(timeoutMs, 30_000);

  let clientPromise = null;
  let sdkVersion = "unknown";

  async function runStripeOperation(operation, work) {
    try {
      return await work();
    } catch (error) {
      throw mapStripeProviderError(error, {
        operation
      });
    }
  }

  async function getClient() {
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    if (!normalizedSecretKey) {
      throw new Error("BILLING_STRIPE_SECRET_KEY is required when BILLING_ENABLED=true.");
    }

    if (!normalizedApiVersion) {
      throw new Error("BILLING_STRIPE_API_VERSION is required when BILLING_ENABLED=true.");
    }

    if (!clientPromise) {
      clientPromise = stripeLoader().then(({ StripeCtor, moduleVersion }) => {
        sdkVersion = moduleVersion;

        return new StripeCtor(normalizedSecretKey, {
          apiVersion: normalizedApiVersion,
          maxNetworkRetries: normalizedMaxNetworkRetries,
          timeout: normalizedTimeoutMs
        });
      });
    }

    return clientPromise;
  }

  async function createCheckoutSession({ params, idempotencyKey }) {
    return runStripeOperation("checkout_create", async () => {
      const client = await getClient();
      return client.checkout.sessions.create(params, {
        idempotencyKey
      });
    });
  }

  async function createPaymentLink({ params, idempotencyKey }) {
    return runStripeOperation("payment_link_create", async () => {
      const client = await getClient();
      return client.paymentLinks.create(params, {
        idempotencyKey
      });
    });
  }

  async function createPrice({ params, idempotencyKey }) {
    return runStripeOperation("price_create", async () => {
      const client = await getClient();
      return client.prices.create(params, {
        idempotencyKey
      });
    });
  }

  async function listPrices({ limit = 100, active = true } = {}) {
    return runStripeOperation("prices_list", async () => {
      const client = await getClient();
      const cappedLimit = Math.max(1, Math.min(100, Number(limit) || 100));
      const normalizedActive = active === false ? false : true;
      const list = await client.prices.list({
        limit: cappedLimit,
        active: normalizedActive,
        expand: ["data.product"]
      });
      const prices = Array.isArray(list?.data) ? list.data : [];
      return prices.map(mapStripePriceRecord);
    });
  }

  async function retrievePrice({ priceId } = {}) {
    const normalizedPriceId = String(priceId || "").trim();
    if (!normalizedPriceId) {
      throw new AppError(400, "Stripe price id is required.");
    }

    return runStripeOperation("price_retrieve", async () => {
      const client = await getClient();
      const price = await client.prices.retrieve(normalizedPriceId, {
        expand: ["product"]
      });
      return mapStripePriceRecord(price);
    });
  }

  async function createBillingPortalSession({ params, idempotencyKey }) {
    return runStripeOperation("portal_create", async () => {
      const client = await getClient();
      return client.billingPortal.sessions.create(params, {
        idempotencyKey
      });
    });
  }

  async function verifyWebhookEvent({ rawBody, signatureHeader, endpointSecret }) {
    return runStripeOperation("webhook_verify", async () => {
      const client = await getClient();
      const payloadBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
      return client.webhooks.constructEvent(payloadBuffer, signatureHeader, endpointSecret);
    });
  }

  async function retrieveCheckoutSession({ sessionId, expand = [] }) {
    return runStripeOperation("checkout_retrieve", async () => {
      const client = await getClient();
      return client.checkout.sessions.retrieve(sessionId, {
        expand
      });
    });
  }

  async function retrieveSubscription({ subscriptionId, expand = [] }) {
    return runStripeOperation("subscription_retrieve", async () => {
      const client = await getClient();
      return client.subscriptions.retrieve(subscriptionId, {
        expand
      });
    });
  }

  async function retrieveInvoice({ invoiceId, expand = [] }) {
    return runStripeOperation("invoice_retrieve", async () => {
      const client = await getClient();
      return client.invoices.retrieve(invoiceId, {
        expand
      });
    });
  }

  async function expireCheckoutSession({ sessionId }) {
    return runStripeOperation("checkout_expire", async () => {
      const client = await getClient();
      return client.checkout.sessions.expire(sessionId);
    });
  }

  async function cancelSubscription({ subscriptionId, cancelAtPeriodEnd = false }) {
    const normalizedSubscriptionId = String(subscriptionId || "").trim();
    if (!normalizedSubscriptionId) {
      throw new AppError(400, "Stripe subscription id is required.");
    }

    return runStripeOperation("subscription_cancel", async () => {
      const client = await getClient();
      if (cancelAtPeriodEnd) {
        return client.subscriptions.update(normalizedSubscriptionId, {
          cancel_at_period_end: true
        });
      }

      return client.subscriptions.del(normalizedSubscriptionId);
    });
  }

  async function setSubscriptionCancelAtPeriodEnd({ subscriptionId, cancelAtPeriodEnd = false }) {
    const normalizedSubscriptionId = String(subscriptionId || "").trim();
    if (!normalizedSubscriptionId) {
      throw new AppError(400, "Stripe subscription id is required.");
    }

    return runStripeOperation("subscription_set_cancel_at_period_end", async () => {
      const client = await getClient();
      return client.subscriptions.update(normalizedSubscriptionId, {
        cancel_at_period_end: Boolean(cancelAtPeriodEnd)
      });
    });
  }

  async function updateSubscriptionPlan({
    subscriptionId,
    providerPriceId,
    subscriptionItemId = null,
    prorationBehavior = "create_prorations",
    billingCycleAnchor = "unchanged",
    paymentBehavior = null
  }) {
    const normalizedSubscriptionId = String(subscriptionId || "").trim();
    if (!normalizedSubscriptionId) {
      throw new AppError(400, "Stripe subscription id is required.");
    }

    const normalizedProviderPriceId = String(providerPriceId || "").trim();
    if (!normalizedProviderPriceId) {
      throw new AppError(400, "Stripe provider price id is required.");
    }

    return runStripeOperation("subscription_update_plan", async () => {
      const client = await getClient();

      let resolvedSubscriptionItemId = String(subscriptionItemId || "").trim();
      if (!resolvedSubscriptionItemId) {
        const currentSubscription = await client.subscriptions.retrieve(normalizedSubscriptionId, {
          expand: ["items.data.price"]
        });
        resolvedSubscriptionItemId = resolvePrimarySubscriptionItemId(currentSubscription);
      }

      if (!resolvedSubscriptionItemId) {
        throw new AppError(409, "Stripe subscription has no mutable items.");
      }

      const params = {
        cancel_at_period_end: false,
        proration_behavior: String(prorationBehavior || "create_prorations").trim() || "create_prorations",
        items: [
          {
            id: resolvedSubscriptionItemId,
            price: normalizedProviderPriceId,
            quantity: 1
          }
        ],
        expand: ["latest_invoice.payment_intent", "items.data.price"]
      };

      const normalizedAnchor = String(billingCycleAnchor || "").trim();
      if (normalizedAnchor) {
        params.billing_cycle_anchor = normalizedAnchor;
      }

      const normalizedPaymentBehavior = String(paymentBehavior || "").trim();
      if (normalizedPaymentBehavior) {
        params.payment_behavior = normalizedPaymentBehavior;
      }

      return client.subscriptions.update(normalizedSubscriptionId, params);
    });
  }

  async function listCustomerPaymentMethods({ customerId, type = "card", limit = 100 }) {
    const normalizedCustomerId = String(customerId || "").trim();
    if (!normalizedCustomerId) {
      throw new AppError(400, "Stripe customer id is required.");
    }

    return runStripeOperation("payment_methods_list", async () => {
      const client = await getClient();
      const cappedLimit = Math.max(1, Math.min(100, Number(limit) || 100));
      const normalizedType = String(type || "").trim() || "card";
      const paymentMethods = [];
      let hasMore = false;
      let cursor = null;
      const maxPages = 50;
      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const list = await client.customers.listPaymentMethods(normalizedCustomerId, {
          type: normalizedType,
          limit: cappedLimit,
          ...(cursor ? { starting_after: cursor } : {})
        });

        const pageMethods = Array.isArray(list?.data) ? list.data : [];
        paymentMethods.push(...pageMethods);

        hasMore = Boolean(list?.has_more);
        if (!hasMore) {
          break;
        }

        const lastId = String(pageMethods[pageMethods.length - 1]?.id || "").trim();
        if (!lastId) {
          break;
        }

        cursor = lastId;
      }

      let defaultPaymentMethodId = null;
      try {
        const customer = await client.customers.retrieve(normalizedCustomerId, {
          expand: ["invoice_settings.default_payment_method"]
        });
        defaultPaymentMethodId = resolveDefaultPaymentMethodId(customer);
      } catch {
        defaultPaymentMethodId = null;
      }

      return {
        paymentMethods,
        defaultPaymentMethodId,
        hasMore
      };
    });
  }

  async function listCheckoutSessionsByOperationKey({ operationKey, limit = 5 }) {
    return runStripeOperation("checkout_sessions_list", async () => {
      const client = await getClient();
      const cappedLimit = Math.max(1, Math.min(100, Number(limit) || 5));

      const list = await client.checkout.sessions.list({
        limit: cappedLimit
      });
      const sessions = Array.isArray(list?.data) ? list.data : [];
      return sessions.filter((session) => {
        const metadata = session?.metadata && typeof session.metadata === "object" ? session.metadata : {};
        return String(metadata.operation_key || "") === String(operationKey || "");
      });
    });
  }

  async function getSdkProvenance() {
    if (!billingEnabled) {
      return {
        provider: BILLING_PROVIDER_STRIPE,
        providerSdkName,
        providerSdkVersion: "disabled",
        providerApiVersion: normalizedApiVersion || ""
      };
    }

    await getClient();

    return {
      provider: BILLING_PROVIDER_STRIPE,
      providerSdkName,
      providerSdkVersion: sdkVersion,
      providerApiVersion: normalizedApiVersion
    };
  }

  return {
    enabled: billingEnabled,
    provider: BILLING_PROVIDER_STRIPE,
    getClient,
    createCheckoutSession,
    createPaymentLink,
    createPrice,
    listPrices,
    retrievePrice,
    createBillingPortalSession,
    verifyWebhookEvent,
    retrieveCheckoutSession,
    retrieveSubscription,
    retrieveInvoice,
    expireCheckoutSession,
    cancelSubscription,
    setSubscriptionCancelAtPeriodEnd,
    updateSubscriptionPlan,
    listCustomerPaymentMethods,
    listCheckoutSessionsByOperationKey,
    getSdkProvenance
  };
}

const __testables = {
  parsePositiveInteger,
  normalizeApiVersion,
  normalizeSecret,
  toNullableInteger,
  toNullableString,
  mapStripePriceRecord,
  resolvePrimarySubscriptionItemId,
  resolveDefaultPaymentMethodId,
  loadStripeModule
};

export { createService, __testables };
