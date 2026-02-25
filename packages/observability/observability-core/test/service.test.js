import assert from "node:assert/strict";
import test from "node:test";

import { createMetricsRegistry } from "../src/metricsRegistry.js";
import { createService as createObservabilityService } from "../src/service.js";

test("observability service records guardrail metrics and structured log payload", () => {
  const registry = createMetricsRegistry();
  const warnings = [];
  const service = createObservabilityService({
    metricsRegistry: registry,
    logger: {
      warn(payload, message) {
        warnings.push({ payload, message });
      }
    },
    guardrailLogLabel: "billing.guardrail"
  });

  service.recordGuardrail({
    code: "BILLING_CHECKOUT_PROVIDER_ERROR",
    domain: "billing",
    operationKey: "op_123",
    providerEventId: "evt_123",
    billableEntityId: "42",
    measure: "age_seconds",
    value: 75
  });
  service.recordRealtimeEvent({
    event: "subscription_evicted",
    outcome: "failure",
    surface: "admin",
    phase: "fanout",
    code: "forbidden"
  });

  const output = registry.renderPrometheusMetrics();
  assert.match(output, /app_billing_guardrail_events_total\{code="BILLING_CHECKOUT_PROVIDER_ERROR"\} 1/);
  assert.match(
    output,
    /app_billing_guardrail_measurement_sum\{code="BILLING_CHECKOUT_PROVIDER_ERROR",measure="age_seconds"\} 75/
  );
  assert.match(
    output,
    /app_realtime_events_total\{event="subscription_evicted",outcome="failure",surface="admin",phase="fanout",code="forbidden"\} 1/
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, "billing.guardrail");
  assert.deepEqual(warnings[0].payload, {
    code: "BILLING_CHECKOUT_PROVIDER_ERROR",
    domain: "billing",
    operation_key: "op_123",
    provider_event_id: "evt_123",
    billable_entity_id: 42,
    measure: "age_seconds",
    value: 75
  });
});

test("observability service falls back to db error metric when guardrail hooks are unavailable", () => {
  const dbErrorCalls = [];
  const service = createObservabilityService({
    metricsRegistry: {
      contentType: "text/plain",
      observeHttpRequest() {},
      recordDbError(payload) {
        dbErrorCalls.push(payload);
      },
      recordConsoleErrorIngestion() {},
      recordAuthFailure() {},
      recordSecurityAuditEvent() {},
      recordAiTurn() {},
      recordAiToolCall() {},
      renderPrometheusMetrics() {
        return "";
      }
    },
    logger: null
  });

  service.recordGuardrail({
    code: "BILLING_RECONCILIATION_REPAIR_FAILURE"
  });

  assert.deepEqual(dbErrorCalls, [
    {
      code: "BILLING_RECONCILIATION_REPAIR_FAILURE"
    }
  ]);
});

test("observability service skips count guardrails when count is zero or negative", () => {
  const registry = createMetricsRegistry();
  const warnings = [];
  const service = createObservabilityService({
    metricsRegistry: registry,
    logger: {
      warn(payload, message) {
        warnings.push({ payload, message });
      }
    }
  });

  service.recordGuardrail({
    code: "BILLING_PENDING_CHECKOUT_REPLAY_DEADLINE_NEARING",
    measure: "count",
    value: 0
  });
  service.recordGuardrail({
    code: "BILLING_PENDING_CHECKOUT_REPLAY_DEADLINE_NEARING",
    measure: "count",
    value: -3
  });

  const output = registry.renderPrometheusMetrics();
  assert.doesNotMatch(output, /BILLING_PENDING_CHECKOUT_REPLAY_DEADLINE_NEARING/);
  assert.equal(warnings.length, 0);
});

test("observability service scoped logger enables debug per LOG_DEBUG_SCOPES-style rules", () => {
  const debugWrites = [];
  const service = createObservabilityService({
    logger: {
      debug(...args) {
        debugWrites.push(args);
      }
    },
    debugScopes: "billing.checkout,auth,-auth.tokens"
  });

  const billingLogger = service.createScopedLogger("billing.checkout");
  const authTokensLogger = service.createScopedLogger("auth.tokens");
  const chatLogger = service.createScopedLogger("chat");

  billingLogger.debug({ checkout_id: "cs_123" }, "billing.checkout.blocking.debug");
  authTokensLogger.debug({ token_id: "t_123" }, "auth.tokens.debug");
  chatLogger.debug({ thread_id: "th_123" }, "chat.debug");

  assert.deepEqual(debugWrites, [["[billing.checkout]", { checkout_id: "cs_123" }, "billing.checkout.blocking.debug"]]);
});
