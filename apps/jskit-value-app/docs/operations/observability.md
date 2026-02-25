# Observability Runbook

Last updated: 2026-02-25 (UTC)

This project exposes Prometheus-format metrics at `GET /api/v1/metrics`.
Action runtime executions are also observable through structured logs and audit events.

## 1) Endpoint and environment

Environment variables:

- `METRICS_ENABLED` (default: `true`)
- `METRICS_BEARER_TOKEN` (default: empty)

Behavior:

- When `METRICS_ENABLED=false`, `/api/v1/metrics` returns `404`.
- When `METRICS_BEARER_TOKEN` is set, callers must send:
  - `Authorization: Bearer <token>`

## 2) Metric inventory

HTTP and platform:

- `app_http_requests_total{method,route,surface,status_class}`
- `app_http_request_duration_seconds_bucket{method,route,surface,le}`
- `app_http_request_duration_seconds_sum{method,route,surface}`
- `app_http_request_duration_seconds_count{method,route,surface}`
- `app_http_4xx_total{route,surface}`
- `app_http_5xx_total{route,surface}`
- `app_db_errors_total{code}`

Security and error ingestion:

- `app_console_error_ingestion_total{source,outcome}`
- `app_auth_failures_total{reason,surface}`
- `app_security_audit_events_total{action,outcome,surface}`

AI:

- `app_ai_turns_total{surface,provider,outcome}`
- `app_ai_turn_duration_seconds_bucket{surface,provider,outcome,le}`
- `app_ai_turn_duration_seconds_sum{surface,provider,outcome}`
- `app_ai_turn_duration_seconds_count{surface,provider,outcome}`
- `app_ai_tool_calls_total{tool,outcome}`

Billing guardrails:

- `app_billing_guardrail_events_total{code}`
- `app_billing_guardrail_measurement_bucket{code,measure,le}`
- `app_billing_guardrail_measurement_sum{code,measure}`
- `app_billing_guardrail_measurement_count{code,measure}`

Notes:

- `route` uses Fastify route templates (for example, `/api/v1/workspace/invites/:inviteId`) to avoid high cardinality.
- Do not add user identifiers or request IDs to labels.

Social/federation operational usage:

- Track social API health with route filters such as:
  - `/api/v1/workspace/social/*`
  - `/api/v1/workspace/admin/social/*`
- Track federation ingress/lookup endpoint behavior via:
  - `/.well-known/webfinger`
  - `/ap/inbox`
  - `/ap/actors/:username/inbox`
  - `/ap/actors/:username`

## 3) Action runtime telemetry (current behavior)

The canonical action pipeline emits telemetry in three places:

1. Structured runtime logs (`action.execution`).
2. Security audit events (`app_security_audit_events_total` by action/outcome/surface).
3. Optional observability adapter hooks in `server/runtime/actions/observabilityAdapters.js`.

### Structured runtime logs

Every action execution emits `action.execution` with:

- `action`
- `version`
- `channel`
- `surface`
- `requestId`
- `durationMs`
- `outcome` (`success` | `failure` | `replay`)
- `errorCode`
- `idempotencyReplay`

The observability adapter also emits debug logs (`action.execution.observed`) when scoped debugging is enabled.

### Observability hook methods

The action runtime invokes these methods on `observabilityService` when implemented:

- `recordActionExecutionStart`
- `recordActionExecution`
- `recordActionAuthorizationDenied`
- `recordActionValidationFailed`
- `recordActionIdempotentReplay`

### Current metrics status for actions

The default `@jskit-ai/observability-core` metrics registry does not currently expose dedicated `app_action_*` counters/histograms. Today, action-level operations monitoring is done through:

- `action.execution` structured logs,
- audit event metrics (`app_security_audit_events_total`),
- domain-specific metrics (HTTP/AI/billing guardrails).

## 4) Scrape configuration

Prometheus scrape job example:

```yaml
scrape_configs:
  - job_name: jskit-app
    metrics_path: /api/v1/metrics
    scheme: https
    static_configs:
      - targets: ["your-host.example.com"]
    # Optional when METRICS_BEARER_TOKEN is set:
    authorization:
      type: Bearer
      credentials: "${METRICS_BEARER_TOKEN}"
```

## 5) Alert rules

Rule-file template is included at `ops/observability/prometheus-alerts.yml`.

### Uptime alert

Trigger when readiness is unavailable for 5 minutes:

```promql
sum_over_time(up{job="jskit-app"}[5m]) == 0
```

If your platform supports HTTP health checks directly, alert when `GET /api/v1/ready` is non-200 for 5 minutes.

### Error-rate alert

Trigger when 5xx ratio exceeds 2% for 10 minutes, with a minimum traffic floor:

```promql
(
  sum(rate(app_http_5xx_total[5m]))
  /
  clamp_min(sum(rate(app_http_requests_total[5m])), 1)
) > 0.02
and
sum(rate(app_http_requests_total[5m])) > 0.2
```

### Action failure proxy alert (audit-backed)

Use audit metrics as the action-failure signal until dedicated action counters exist:

```promql
sum(rate(app_security_audit_events_total{outcome="failure"}[5m])) > 0
```

Tune this by action filter for high-value operations.

## 6) Dashboard starter panels

### p95 latency

```promql
histogram_quantile(
  0.95,
  sum by (le) (rate(app_http_request_duration_seconds_bucket{route!="/api/v1/metrics"}[5m]))
)
```

### Error rate

```promql
sum(rate(app_http_5xx_total[5m]))
/
clamp_min(sum(rate(app_http_requests_total[5m])), 1)
```

### Auth failures by reason

```promql
sum by (reason) (increase(app_auth_failures_total[1h]))
```

### Invite redemption funnel (24h)

Invites created:

```promql
sum(increase(app_security_audit_events_total{
  action=~"workspace.invite.created|console.invite.created",
  outcome="success"
}[24h]))
```

Invites redeemed successfully:

```promql
sum(increase(app_security_audit_events_total{
  action=~"workspace.invite.redeemed|console.invite.redeemed",
  outcome="success"
}[24h]))
```

Invite redemption failures:

```promql
sum(increase(app_security_audit_events_total{
  action=~"workspace.invite.redeemed|console.invite.redeemed",
  outcome="failure"
}[24h]))
```

### Action outcomes by action (audit proxy)

```promql
sum by (action, outcome) (
  rate(app_security_audit_events_total[5m])
)
```

### Action failures by surface (audit proxy)

```promql
sum by (surface) (
  rate(app_security_audit_events_total{outcome="failure"}[5m])
)
```

### Social + federation error-rate slice (5m)

```promql
sum(rate(app_http_5xx_total{route=~"/api/v1/workspace/social.*|/api/v1/workspace/admin/social.*|/ap.*|/.well-known/webfinger"}[5m]))
/
clamp_min(sum(rate(app_http_requests_total{route=~"/api/v1/workspace/social.*|/api/v1/workspace/admin/social.*|/ap.*|/.well-known/webfinger"}[5m])), 1)
```

## 7) Action telemetry verification checklist

- Execute a known action (for example, `workspace.settings.update`).
- Confirm one `action.execution` log entry with expected `action`, `channel`, and `surface`.
- Confirm audit event signal increments (`app_security_audit_events_total`) for that action/outcome.
- For denied calls, confirm `403` plus corresponding failure/deny telemetry.
