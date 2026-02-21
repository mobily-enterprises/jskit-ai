import { createHmac, timingSafeEqual } from "node:crypto";

import { AppError } from "../../../../lib/errors.js";
import { BILLING_PROVIDER_PADDLE } from "../../constants.js";
import { isBillingProviderError } from "../shared/providerError.contract.js";
import { mapPaddleProviderError } from "./errorMapping.js";

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallbackValue;
  }

  return parsed;
}

function normalizeApiBaseUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "https://api.paddle.com";
  }

  return normalized.replace(/\/+$/, "");
}

function normalizeSecret(value) {
  return String(value || "").trim();
}

function normalizeWebhookSignatureHeader(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function toUnixEpochSeconds(value) {
  if (value == null || value === "") {
    return null;
  }

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    if (asNumber > 1_000_000_000_000) {
      return Math.floor(asNumber / 1000);
    }
    return Math.floor(asNumber);
  }

  const asDate = new Date(value);
  const time = asDate.getTime();
  if (!Number.isFinite(time) || time < 0) {
    return null;
  }

  return Math.floor(time / 1000);
}

function toNullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[String(key)] = String(entry == null ? "" : entry);
  }
  return output;
}

function parseAmountToMinorUnits(value) {
  if (value == null || value === "") {
    return 0;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return 0;
  }

  if (/^-?\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber)) {
    return 0;
  }

  return Math.round(asNumber * 100);
}

function parsePaddleSignatureHeader(headerValue) {
  const normalizedHeader = normalizeWebhookSignatureHeader(headerValue);
  if (!normalizedHeader) {
    return {
      timestamp: "",
      h1: ""
    };
  }

  const pairs = normalizedHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);

  let timestamp = "";
  let h1 = "";
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim().toLowerCase();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }

    if (key === "ts") {
      timestamp = value;
    } else if (key === "h1" && !h1) {
      h1 = value;
    }
  }

  return {
    timestamp,
    h1: h1.toLowerCase()
  };
}

function buildPaddleSignaturePayload({ timestamp, rawBody }) {
  return `${String(timestamp || "").trim()}:${String(rawBody || "")}`;
}

function normalizeCheckoutStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "open";
  }

  if (
    normalized === "completed" ||
    normalized === "paid" ||
    normalized === "billed" ||
    normalized === "active"
  ) {
    return "complete";
  }

  if (
    normalized === "canceled" ||
    normalized === "cancelled" ||
    normalized === "expired" ||
    normalized === "past_due"
  ) {
    return "expired";
  }

  return "open";
}

function normalizeSubscriptionStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "incomplete";
  }

  if (normalized === "paused") {
    return "paused";
  }

  if (normalized === "past_due") {
    return "past_due";
  }

  if (normalized === "active" || normalized === "trialing") {
    return normalized;
  }

  if (normalized === "canceled" || normalized === "cancelled") {
    return "canceled";
  }

  return "incomplete";
}

function normalizeCurrencyCode(value, fallback = "USD") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (/^[A-Z]{3}$/.test(normalized)) {
    return normalized;
  }

  const fallbackNormalized = String(fallback || "")
    .trim()
    .toUpperCase();
  if (/^[A-Z]{3}$/.test(fallbackNormalized)) {
    return fallbackNormalized;
  }

  return "USD";
}

function normalizeMinorUnitAmount(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return String(parsed);
}

function normalizeCheckoutLineItemToPaddleItem(lineItem, { defaultCurrency = "USD" } = {}) {
  const entry = lineItem && typeof lineItem === "object" ? lineItem : {};
  const quantity = Math.max(1, Number(entry?.quantity || 1));
  const priceId = toNullableString(entry?.price || entry?.price_id);
  if (priceId) {
    return {
      price_id: priceId,
      quantity
    };
  }

  const inlinePriceData = entry?.price_data && typeof entry.price_data === "object" ? entry.price_data : null;
  if (!inlinePriceData) {
    return null;
  }

  const amount = normalizeMinorUnitAmount(inlinePriceData.unit_amount);
  const productData = inlinePriceData.product_data && typeof inlinePriceData.product_data === "object" ? inlinePriceData.product_data : {};
  const name = toNullableString(productData.name || entry?.name || entry?.description);
  if (!amount || !name) {
    return null;
  }

  const description = toNullableString(productData.description) || name;
  const currencyCode = normalizeCurrencyCode(inlinePriceData.currency, defaultCurrency);

  return {
    quantity,
    price: {
      name,
      description,
      unit_price: {
        amount,
        currency_code: currencyCode
      },
      product: {
        name,
        tax_category: "standard"
      }
    }
  };
}

function normalizeCheckoutSessionFromTransaction(transaction) {
  const entry = transaction && typeof transaction === "object" ? transaction : {};
  return {
    id: toNullableString(entry.id),
    status: normalizeCheckoutStatus(entry.status),
    url: toNullableString(entry?.checkout?.url || entry?.checkout_url || entry?.url),
    expires_at: toUnixEpochSeconds(entry?.checkout?.expires_at || entry?.expires_at),
    customer: toNullableString(entry.customer_id || entry?.customer?.id),
    subscription: toNullableString(entry.subscription_id || entry?.subscription?.id),
    metadata: normalizeMetadata(entry.custom_data || entry.metadata)
  };
}

function normalizeSubscriptionFromPaddle(subscription) {
  const entry = subscription && typeof subscription === "object" ? subscription : {};
  const recurringItems = Array.isArray(entry.items) ? entry.items : [];

  return {
    id: toNullableString(entry.id),
    status: normalizeSubscriptionStatus(entry.status),
    customer: toNullableString(entry.customer_id || entry?.customer?.id),
    created: toUnixEpochSeconds(entry.started_at || entry.created_at),
    current_period_end: toUnixEpochSeconds(entry.next_billed_at || entry.current_billing_period?.ends_at),
    trial_end: toUnixEpochSeconds(entry.trial_end_at || entry.trial_period?.ends_at),
    canceled_at: toUnixEpochSeconds(entry.canceled_at || entry.cancelled_at),
    cancel_at_period_end:
      String(entry?.scheduled_change?.action || "")
        .trim()
        .toLowerCase() === "cancel",
    ended_at: toUnixEpochSeconds(entry.ended_at || entry.canceled_at || entry.cancelled_at),
    customer_email: toNullableString(entry?.customer?.email),
    metadata: normalizeMetadata(entry.custom_data || entry.metadata),
    items: {
      data: recurringItems.map((item) => ({
        id: toNullableString(item.id),
        quantity: Number(item.quantity || 1),
        metadata: normalizeMetadata(item.custom_data || item.metadata),
        deleted: false,
        price: {
          id: toNullableString(item.price_id || item?.price?.id)
        }
      }))
    }
  };
}

function normalizeInvoiceFromTransaction(transaction) {
  const entry = transaction && typeof transaction === "object" ? transaction : {};
  const totals = entry?.details?.totals && typeof entry.details.totals === "object" ? entry.details.totals : {};
  const totalMinorUnits = parseAmountToMinorUnits(totals.total || totals.grand_total || entry.amount);
  const isPaid = normalizeCheckoutStatus(entry.status) === "complete";

  return {
    id: toNullableString(entry.id),
    subscription: toNullableString(entry.subscription_id || entry?.subscription?.id),
    customer: toNullableString(entry.customer_id || entry?.customer?.id),
    status: isPaid ? "paid" : "open",
    currency: toNullableString(totals.currency_code || entry.currency_code || entry.currency),
    total: totalMinorUnits,
    amount_paid: isPaid ? totalMinorUnits : 0,
    amount_due: isPaid ? 0 : totalMinorUnits,
    attempt_count: Number(entry.attempt_count || 1),
    next_payment_attempt: toUnixEpochSeconds(entry.next_payment_attempt_at || entry.next_billed_at),
    customer_email: toNullableString(entry?.customer?.email),
    metadata: normalizeMetadata(entry.custom_data || entry.metadata),
    created: toUnixEpochSeconds(entry.billed_at || entry.created_at || entry.updated_at)
  };
}

function normalizePaddleWebhookEvent(rawEvent) {
  const entry = rawEvent && typeof rawEvent === "object" ? rawEvent : {};
  return {
    id: toNullableString(entry.event_id || entry.id),
    type: String(entry.event_type || entry.type || "").trim(),
    created: toUnixEpochSeconds(entry.occurred_at || entry.created_at || Date.now()),
    data: {
      object: entry?.data && typeof entry.data === "object" ? entry.data : {}
    },
    raw: entry
  };
}

function buildPaddleError(responseBody, fallbackMessage = "Paddle API request failed.", statusCode = null) {
  const message =
    toNullableString(responseBody?.error?.detail) ||
    toNullableString(responseBody?.error?.message) ||
    toNullableString(responseBody?.detail) ||
    fallbackMessage;
  const error = new Error(message);
  error.code = toNullableString(responseBody?.error?.code) || null;
  error.statusCode = Number(statusCode || responseBody?.error?.status || 0) || null;
  error.details = responseBody;
  return error;
}

function createService({
  enabled = false,
  apiKey = "",
  apiBaseUrl = "https://api.paddle.com",
  timeoutMs = 30_000,
  fetchImpl = globalThis.fetch
} = {}) {
  const billingEnabled = enabled === true;
  const normalizedApiKey = normalizeSecret(apiKey);
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  const normalizedTimeoutMs = parsePositiveInteger(timeoutMs, 30_000);

  async function callPaddleApi({
    method,
    path,
    query = null,
    body = null,
    idempotencyKey = null,
    operation = "unknown"
  }) {
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    if (typeof fetchImpl !== "function") {
      throw new Error("Global fetch is not available for Paddle SDK service.");
    }

    if (!normalizedApiKey) {
      throw new Error("BILLING_PADDLE_API_KEY is required when BILLING_ENABLED=true and BILLING_PROVIDER=paddle.");
    }

    const url = new URL(`${normalizedApiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value == null) {
          continue;
        }
        url.searchParams.set(String(key), String(value));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    const headers = {
      Authorization: `Bearer ${normalizedApiKey}`,
      "Content-Type": "application/json"
    };
    if (idempotencyKey) {
      headers["Idempotency-Key"] = String(idempotencyKey);
    }

    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const json = await response
        .json()
        .catch(() => ({}));
      if (!response.ok) {
        throw mapPaddleProviderError(buildPaddleError(json, "Paddle API request failed.", response.status), {
          operation,
          fallbackStatusCode: response.status,
          providerRequestId: response.headers?.get?.("x-request-id")
        });
      }

      return json?.data != null ? json.data : json;
    } catch (error) {
      if (error instanceof AppError || isBillingProviderError(error)) {
        throw error;
      }
      throw mapPaddleProviderError(error, {
        operation
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function createCheckoutSession({ params, idempotencyKey, operation = "checkout_create" }) {
    const checkoutParams = params && typeof params === "object" ? params : {};
    const lineItems = Array.isArray(checkoutParams.line_items) ? checkoutParams.line_items : [];
    if (lineItems.length < 1) {
      throw new AppError(400, "Paddle checkout requires at least one line item.");
    }
    const defaultCurrency = normalizeCurrencyCode(checkoutParams.currency);
    const mappedItems = lineItems.map((lineItem) =>
      normalizeCheckoutLineItemToPaddleItem(lineItem, {
        defaultCurrency
      })
    );
    if (mappedItems.some((item) => !item)) {
      throw new AppError(400, "Paddle checkout line items must include a provider price id or valid price_data.");
    }
    const items = mappedItems.filter(Boolean);
    if (items.length < 1) {
      throw new AppError(400, "Paddle checkout requires at least one purchasable item.");
    }

    const transaction = await callPaddleApi({
      method: "POST",
      path: "/transactions",
      idempotencyKey,
      operation,
      body: {
        items,
        custom_data: normalizeMetadata(checkoutParams.metadata),
        collection_mode: "automatic"
      }
    });

    return normalizeCheckoutSessionFromTransaction(transaction);
  }

  async function createPaymentLink({ params, idempotencyKey }) {
    const session = await createCheckoutSession({
      params,
      idempotencyKey,
      operation: "payment_link_create"
    });

    return {
      id: toNullableString(session.id),
      url: toNullableString(session.url),
      active: session.status !== "expired"
    };
  }

  async function createPrice({ params, idempotencyKey }) {
    const price = await callPaddleApi({
      method: "POST",
      path: "/prices",
      idempotencyKey,
      operation: "price_create",
      body: params && typeof params === "object" ? params : {}
    });

    return {
      id: toNullableString(price?.id)
    };
  }

  async function createBillingPortalSession({ params }) {
    const payload = params && typeof params === "object" ? params : {};
    const customerId = toNullableString(payload.customer || payload.customer_id);
    if (!customerId) {
      throw new AppError(400, "Paddle customer id is required.");
    }

    const portalSession = await callPaddleApi({
      method: "POST",
      path: "/customer-portal-sessions",
      operation: "portal_create",
      body: {
        customer_id: customerId,
        return_url: toNullableString(payload.return_url || payload.returnUrl)
      }
    });

    return {
      id: toNullableString(portalSession.id || `${customerId}:${Date.now()}`),
      url: toNullableString(portalSession.urls?.general?.overview || portalSession.url || payload.return_url || "")
    };
  }

  async function verifyWebhookEvent({ rawBody, signatureHeader, endpointSecret }) {
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    const normalizedSecret = normalizeSecret(endpointSecret);
    if (!normalizedSecret) {
      throw new Error("BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET is required when BILLING_PROVIDER=paddle.");
    }

    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
    const bodyText = bodyBuffer.toString("utf8");
    const { timestamp, h1 } = parsePaddleSignatureHeader(signatureHeader);
    if (!timestamp || !h1) {
      throw new AppError(400, "Paddle signature header is required.");
    }

    const signedPayload = buildPaddleSignaturePayload({
      timestamp,
      rawBody: bodyText
    });
    const expectedH1 = createHmac("sha256", normalizedSecret).update(signedPayload).digest("hex").toLowerCase();
    const expectedBuffer = Buffer.from(expectedH1);
    const actualBuffer = Buffer.from(String(h1 || "").toLowerCase());
    if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
      throw new AppError(400, "Invalid Paddle signature.");
    }

    let payload = null;
    try {
      payload = JSON.parse(bodyText || "{}");
    } catch {
      throw new AppError(400, "Paddle webhook payload must be valid JSON.");
    }

    return normalizePaddleWebhookEvent(payload);
  }

  async function retrieveCheckoutSession({ sessionId }) {
    const transaction = await callPaddleApi({
      method: "GET",
      path: `/transactions/${encodeURIComponent(String(sessionId || "").trim())}`,
      operation: "checkout_retrieve"
    });
    return normalizeCheckoutSessionFromTransaction(transaction);
  }

  async function retrieveSubscription({ subscriptionId }) {
    const subscription = await callPaddleApi({
      method: "GET",
      path: `/subscriptions/${encodeURIComponent(String(subscriptionId || "").trim())}`,
      operation: "subscription_retrieve"
    });
    return normalizeSubscriptionFromPaddle(subscription);
  }

  async function retrieveInvoice({ invoiceId }) {
    const transaction = await callPaddleApi({
      method: "GET",
      path: `/transactions/${encodeURIComponent(String(invoiceId || "").trim())}`,
      operation: "invoice_retrieve"
    });
    return normalizeInvoiceFromTransaction(transaction);
  }

  async function expireCheckoutSession({ sessionId }) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      throw new AppError(400, "Provider checkout session id is required.");
    }

    try {
      const transaction = await callPaddleApi({
        method: "POST",
        path: `/transactions/${encodeURIComponent(normalizedSessionId)}/cancel`,
        operation: "checkout_expire"
      });
      return normalizeCheckoutSessionFromTransaction(transaction);
    } catch {
      return {
        id: normalizedSessionId,
        status: "expired"
      };
    }
  }

  async function cancelSubscription({ subscriptionId, cancelAtPeriodEnd = false }) {
    const normalizedSubscriptionId = String(subscriptionId || "").trim();
    if (!normalizedSubscriptionId) {
      throw new AppError(400, "Provider subscription id is required.");
    }

    const result = await callPaddleApi({
      method: "POST",
      path: `/subscriptions/${encodeURIComponent(normalizedSubscriptionId)}/cancel`,
      operation: "subscription_cancel",
      body: {
        effective_from:
          cancelAtPeriodEnd === true ? "next_billing_period" : "immediately"
      }
    });

    return normalizeSubscriptionFromPaddle(result);
  }

  async function listCustomerPaymentMethods({ customerId, limit = 100 }) {
    const normalizedCustomerId = String(customerId || "").trim();
    if (!normalizedCustomerId) {
      throw new AppError(400, "Provider customer id is required.");
    }

    const pageSize = Math.max(1, Math.min(100, Number(limit) || 100));
    const result = await callPaddleApi({
      method: "GET",
      path: `/customers/${encodeURIComponent(normalizedCustomerId)}/payment-methods`,
      operation: "payment_methods_list",
      query: {
        per_page: pageSize
      }
    });
    const entries = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];

    const paymentMethods = entries.map((entry) => ({
      id: toNullableString(entry.id),
      type: toNullableString(entry.type) || "card",
      card: {
        brand: toNullableString(entry?.card?.type || entry?.card?.brand),
        last4: toNullableString(entry?.card?.last4 || entry?.card?.last_digits),
        exp_month: parsePositiveInteger(entry?.card?.expiry_month, null),
        exp_year: parsePositiveInteger(entry?.card?.expiry_year, null),
        fingerprint: toNullableString(entry?.card?.fingerprint)
      }
    }));

    return {
      paymentMethods: paymentMethods.filter((entry) => entry.id),
      defaultPaymentMethodId: null,
      hasMore: false
    };
  }

  async function listCheckoutSessionsByOperationKey({ operationKey, limit = 5 }) {
    const normalizedOperationKey = String(operationKey || "").trim();
    if (!normalizedOperationKey) {
      return [];
    }

    const result = await callPaddleApi({
      method: "GET",
      path: "/transactions",
      operation: "checkout_sessions_list",
      query: {
        per_page: Math.max(1, Math.min(100, Number(limit) || 5))
      }
    });
    const entries = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
    return entries
      .filter((entry) => String(entry?.custom_data?.operation_key || "") === normalizedOperationKey)
      .map((entry) => normalizeCheckoutSessionFromTransaction(entry));
  }

  async function getSdkProvenance() {
    return {
      provider: BILLING_PROVIDER_PADDLE,
      providerSdkName: "paddle-rest",
      providerSdkVersion: "http-fetch-v1",
      providerApiVersion: normalizedApiBaseUrl
    };
  }

  return {
    enabled: billingEnabled,
    provider: BILLING_PROVIDER_PADDLE,
    createCheckoutSession,
    createPaymentLink,
    createPrice,
    createBillingPortalSession,
    verifyWebhookEvent,
    retrieveCheckoutSession,
    retrieveSubscription,
    retrieveInvoice,
    expireCheckoutSession,
    cancelSubscription,
    listCustomerPaymentMethods,
    listCheckoutSessionsByOperationKey,
    getSdkProvenance
  };
}

const __testables = {
  parsePositiveInteger,
  normalizeApiBaseUrl,
  normalizeSecret,
  normalizeWebhookSignatureHeader,
  toUnixEpochSeconds,
  toNullableString,
  normalizeMetadata,
  parseAmountToMinorUnits,
  parsePaddleSignatureHeader,
  buildPaddleSignaturePayload,
  normalizeCheckoutStatus,
  normalizeSubscriptionStatus,
  normalizeCheckoutSessionFromTransaction,
  normalizeSubscriptionFromPaddle,
  normalizeInvoiceFromTransaction,
  normalizePaddleWebhookEvent
};

export { createService, __testables };
