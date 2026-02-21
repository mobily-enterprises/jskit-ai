import assert from "node:assert/strict";
import test from "node:test";

import { createMetricsRegistry } from "../server/lib/observability/metrics.js";

test("metrics registry records HTTP request counters and latency histogram", () => {
  const registry = createMetricsRegistry({
    httpDurationBuckets: [0.1, 0.5, 1]
  });

  registry.observeHttpRequest({
    method: "get",
    route: "/api/health",
    surface: "app",
    statusCode: 503,
    durationMs: 220
  });

  const output = registry.renderPrometheusMetrics();
  assert.match(
    output,
    /app_http_requests_total\{method="GET",route="\/api\/health",surface="app",status_class="5xx"\} 1/
  );
  assert.match(output, /app_http_5xx_total\{route="\/api\/health",surface="app"\} 1/);
  assert.match(
    output,
    /app_http_request_duration_seconds_bucket\{method="GET",route="\/api\/health",surface="app",le="0.5"\} 1/
  );
  assert.match(
    output,
    /app_http_request_duration_seconds_sum\{method="GET",route="\/api\/health",surface="app"\} 0.22/
  );
});

test("metrics registry records db, auth, ingestion, and audit event counters", () => {
  const registry = createMetricsRegistry();

  registry.recordDbError({ code: "er_dup_entry" });
  registry.recordConsoleErrorIngestion({ source: "browser", outcome: "success" });
  registry.recordAuthFailure({ reason: "unauthenticated", surface: "console" });
  registry.recordSecurityAuditEvent({
    action: "workspace.invite.redeemed",
    outcome: "failure",
    surface: "admin"
  });
  registry.recordAiTurn({
    surface: "app",
    provider: "openai",
    outcome: "timeout",
    durationMs: 2100
  });
  registry.recordAiToolCall({
    tool: "workspace_rename",
    outcome: "forbidden"
  });
  registry.recordBillingGuardrailEvent({
    code: "billing_checkout_provider_error"
  });
  registry.recordBillingGuardrailMeasurement({
    code: "billing_checkout_recovery_verification_pending",
    measure: "age_seconds",
    value: 120
  });
  registry.recordBillingGuardrailMeasurement({
    code: "billing_checkout_recovery_verification_pending",
    measure: "count",
    value: 4
  });
  registry.recordBillingGuardrailMeasurement({
    code: "billing_ignore_null_measurement",
    measure: "count",
    value: null
  });

  const output = registry.renderPrometheusMetrics();
  assert.match(output, /app_db_errors_total\{code="ER_DUP_ENTRY"\} 1/);
  assert.match(output, /app_console_error_ingestion_total\{source="browser",outcome="success"\} 1/);
  assert.match(output, /app_auth_failures_total\{reason="unauthenticated",surface="console"\} 1/);
  assert.match(
    output,
    /app_security_audit_events_total\{action="workspace\.invite\.redeemed",outcome="failure",surface="admin"\} 1/
  );
  assert.match(output, /app_ai_turns_total\{surface="app",provider="openai",outcome="timeout"\} 1/);
  assert.match(
    output,
    /app_ai_turn_duration_seconds_sum\{surface="app",provider="openai",outcome="timeout"\} 2.1/
  );
  assert.match(output, /app_ai_tool_calls_total\{tool="workspace_rename",outcome="forbidden"\} 1/);
  assert.match(
    output,
    /app_billing_guardrail_events_total\{code="BILLING_CHECKOUT_PROVIDER_ERROR"\} 1/
  );
  assert.match(
    output,
    /app_billing_guardrail_measurement_count\{code="BILLING_CHECKOUT_RECOVERY_VERIFICATION_PENDING",measure="age_seconds"\} 1/
  );
  assert.match(
    output,
    /app_billing_guardrail_measurement_sum\{code="BILLING_CHECKOUT_RECOVERY_VERIFICATION_PENDING",measure="age_seconds"\} 120/
  );
  assert.match(
    output,
    /app_billing_guardrail_measurement_sum\{code="BILLING_CHECKOUT_RECOVERY_VERIFICATION_PENDING",measure="count"\} 4/
  );
  assert.doesNotMatch(output, /BILLING_IGNORE_NULL_MEASUREMENT/);
});
