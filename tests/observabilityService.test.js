import assert from "node:assert/strict";
import test from "node:test";

import { createMetricsRegistry } from "../server/lib/observability/metrics.js";
import { createService as createObservabilityService } from "../server/modules/observability/service.js";

test("observability service records billing guardrail metrics and structured log payload", () => {
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

  service.recordBillingGuardrail({
    code: "BILLING_CHECKOUT_PROVIDER_ERROR",
    operationKey: "op_123",
    providerEventId: "evt_123",
    billableEntityId: "42",
    measure: "age_seconds",
    value: 75
  });

  const output = registry.renderPrometheusMetrics();
  assert.match(
    output,
    /app_billing_guardrail_events_total\{code="BILLING_CHECKOUT_PROVIDER_ERROR"\} 1/
  );
  assert.match(
    output,
    /app_billing_guardrail_measurement_sum\{code="BILLING_CHECKOUT_PROVIDER_ERROR",measure="age_seconds"\} 75/
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, "billing.guardrail");
  assert.deepEqual(warnings[0].payload, {
    code: "BILLING_CHECKOUT_PROVIDER_ERROR",
    operation_key: "op_123",
    provider_event_id: "evt_123",
    billable_entity_id: 42,
    measure: "age_seconds",
    value: 75
  });
});

test("observability service falls back to db error metric when billing guardrail hooks are unavailable", () => {
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

  service.recordBillingGuardrail({
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

  service.recordBillingGuardrail({
    code: "BILLING_PENDING_CHECKOUT_REPLAY_DEADLINE_NEARING",
    measure: "count",
    value: 0
  });
  service.recordBillingGuardrail({
    code: "BILLING_PENDING_CHECKOUT_REPLAY_DEADLINE_NEARING",
    measure: "count",
    value: -3
  });

  const output = registry.renderPrometheusMetrics();
  assert.doesNotMatch(output, /BILLING_PENDING_CHECKOUT_REPLAY_DEADLINE_NEARING/);
  assert.equal(warnings.length, 0);
});

test("observability service records code-only guardrails without synthetic zero measurements", () => {
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

  service.recordBillingGuardrail({
    code: "BILLING_WEBHOOK_PROCESSING_FAILED",
    providerEventId: "evt_123"
  });

  const output = registry.renderPrometheusMetrics();
  assert.match(output, /app_billing_guardrail_events_total\{code="BILLING_WEBHOOK_PROCESSING_FAILED"\} 1/);
  assert.doesNotMatch(output, /app_billing_guardrail_measurement_sum\{code="BILLING_WEBHOOK_PROCESSING_FAILED"/);
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].payload, {
    code: "BILLING_WEBHOOK_PROCESSING_FAILED",
    operation_key: null,
    provider_event_id: "evt_123",
    billable_entity_id: null,
    measure: null,
    value: null
  });
});
