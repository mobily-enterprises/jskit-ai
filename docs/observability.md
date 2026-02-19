# Observability Runbook

This project exposes Prometheus-format metrics at `GET /api/metrics`.

## 1) Endpoint and environment

Environment variables:

- `METRICS_ENABLED` (default: `true`)
- `METRICS_BEARER_TOKEN` (default: empty)

Behavior:

- When `METRICS_ENABLED=false`, `/api/metrics` returns `404`.
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

Notes:

- `route` uses Fastify route templates (for example, `/api/workspace/invites/:inviteId`) to avoid high cardinality.
- Do not add user identifiers or request IDs to labels.

## 3) Scrape configuration

Prometheus scrape job example:

```yaml
scrape_configs:
  - job_name: annuity-app
    metrics_path: /api/metrics
    scheme: https
    static_configs:
      - targets: ["your-host.example.com"]
    # Optional when METRICS_BEARER_TOKEN is set:
    authorization:
      type: Bearer
      credentials: "${METRICS_BEARER_TOKEN}"
```

## 4) Alert rules

Rule-file template is included at `ops/observability/prometheus-alerts.yml`.

### Uptime alert

Trigger when readiness is unavailable for 5 minutes:

```promql
sum_over_time(up{job="annuity-app"}[5m]) == 0
```

If your platform supports HTTP health checks directly, alert when `GET /api/ready` is non-200 for 5 minutes.

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

## 5) Dashboard starter panels

### p95 latency

```promql
histogram_quantile(
  0.95,
  sum by (le) (rate(app_http_request_duration_seconds_bucket{route!="/api/metrics"}[5m]))
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
