# SELF-DEVOP

Detailed blueprint for building a small, reliable, low-cost self-hosted deployment platform for multiple SaaS apps.

This document assumes:

1. You want to ship fast (10 apps in weeks, not quarters).
2. You want low baseline cost.
3. You want enough automation that operations stay manageable.
4. You need Socket.IO + Redis support.
5. You want optional customer custom domains with TLS.

## 0) Executive summary

Do not build "your own cloud." Build a focused mini-PaaS:

1. Docker on each VPS.
2. Caddy as edge proxy and TLS terminator.
3. One control-plane service (UI + API) that manages deployments.
4. Postgres for control-plane metadata.
5. Redis for control-plane job queue.
6. MySQL and Redis for app data (shared early, isolate later).

This gives you:

1. One-click-ish deploys.
2. Structured app/service metadata.
3. Repeatable migrations and rollback.
4. Customer domain onboarding flow.
5. Horizontal growth by adding VPS nodes.

What it does not give you:

1. Full cloud autoscaler/orchestrator.
2. Zero-ops reliability.
3. Managed failover out of the box.

## 1) Scope boundaries (critical)

Keep this project small and sharp. If you exceed this scope, you are rebuilding Kubernetes slowly.

Build now:

1. App deployments on Docker hosts.
2. Rolling replace (or blue/green) per app.
3. Migrations as explicit release step.
4. Health checks + automatic rollback.
5. Logs/metrics collection + alerting.
6. Custom domains + automatic certs.

Do not build now:

1. Custom container scheduler.
2. Multi-region orchestrator.
3. Service mesh.
4. Internal PKI or custom ACME implementation.
5. "Everything as plugins" architecture.

## 2) Suggested reference architecture

For your target (many small SaaS), use this topology:

1. Edge node (public):
   - Caddy
   - Receives all HTTP/HTTPS
   - Routes by host/path to app containers on app nodes
2. App node pool (private network + optional public):
   - Docker Engine
   - App containers
   - Background workers/cron containers
3. Data node (private network only if possible):
   - MySQL
   - Redis
4. Control-plane node:
   - Control API
   - Control UI
   - Deploy worker
   - Control-plane Postgres
   - Control-plane Redis queue
5. Object storage:
   - Backups, artifacts, logs archive

You can collapse this to fewer servers early:

1. VPS A: Edge + all apps.
2. VPS B: MySQL + Redis + control-plane.

Then split when load/risk grows:

1. Move control-plane off data node.
2. Add dedicated app nodes.
3. Add replica/read model where needed.

## 3) Minimal hardware plan

Phase 1 (very lean):

1. `vps-edge-app` (2-4 vCPU, 4-8 GB RAM)
2. `vps-data` (2-4 vCPU, 8 GB RAM, fast disk)

Phase 2 (after traction):

1. `vps-edge` (2-4 vCPU, 4 GB RAM)
2. `vps-app-1` (4 vCPU, 8 GB RAM)
3. `vps-app-2` (4 vCPU, 8 GB RAM)
4. `vps-data-primary` (4 vCPU, 16 GB RAM)
5. `vps-control` (2 vCPU, 4 GB RAM)

Sizing notes:

1. Redis memory needs spike quickly with Socket.IO fanout and cache usage.
2. MySQL needs disk IOPS more than raw CPU in many SaaS workloads.
3. Keep swap enabled but small; avoid memory death spirals.

## 4) Networking and security baseline

Hard requirements:

1. Private network between nodes.
2. Public ingress only on edge (80/443).
3. SSH only from your admin IP/VPN.
4. Data services not public.

Firewall policy model:

1. Edge:
   - allow 80, 443 from internet
   - allow SSH from admin range only
   - allow app-node upstream ports on private network
2. App nodes:
   - allow ingress from edge on app ports only
   - allow SSH from admin range only
3. Data node:
   - allow MySQL/Redis only from app/control nodes
   - deny public ingress for DB/Redis

Host hardening:

1. Disable password SSH login.
2. Disable root SSH login.
3. Use key auth only.
4. Install `fail2ban`.
5. Enable unattended security upgrades.
6. Keep kernel and Docker current.

## 5) Runtime choices

Recommended stack:

1. Ubuntu LTS
2. Docker Engine + Compose
3. Caddy as reverse proxy
4. MySQL 8
5. Redis 7
6. Prometheus + Grafana + Loki (or lighter alternatives)

Why Caddy:

1. Simple config model.
2. Strong automatic HTTPS support.
3. Easy API-based dynamic config.
4. Good websocket reverse proxy behavior.

## 6) Core platform components

Your platform has three logical pieces:

1. Control API
2. Deploy worker
3. Edge config manager

### 6.1 Control API responsibilities

1. Authentication/authorization for your team.
2. App/project/environment metadata.
3. Deployment history and release status.
4. Domain onboarding status.
5. Triggering deploy jobs and migrations.
6. Storing secrets references (not raw secrets when avoidable).

### 6.2 Deploy worker responsibilities

1. Build or pull image.
2. Push image to registry (if building locally).
3. Pull image on target node.
4. Start candidate release.
5. Run `db:migrate`.
6. Health-check release.
7. Switch traffic if healthy.
8. Roll back if unhealthy.

### 6.3 Edge config manager responsibilities

1. Create/update routes from host to upstream app service.
2. Trigger/monitor cert issuance.
3. Apply rate limits where needed.
4. Expose edge status to control API.

## 7) Data model (control-plane)

Suggested core tables:

1. `projects`
2. `services`
3. `environments`
4. `releases`
5. `release_steps`
6. `domains`
7. `certificates`
8. `secrets`
9. `nodes`
10. `deploy_jobs`
11. `audit_events`

Suggested field highlights:

1. `services`
   - `runtime` (node, ruby, go, etc.)
   - `container_port`
   - `healthcheck_path`
2. `releases`
   - `git_sha`
   - `image_digest`
   - `status` (pending/running/healthy/failed/rolled_back)
3. `domains`
   - `hostname`
   - `verification_token`
   - `dns_status`
   - `tls_status`
4. `nodes`
   - `labels` (edge, app, worker)
   - `capacity_cpu`
   - `capacity_ram`
   - `drain_mode`

## 8) Deployment lifecycle (explicit steps)

Each deploy should execute this state machine:

1. `queued`
2. `building`
3. `artifact_ready`
4. `candidate_started`
5. `migrating`
6. `health_validating`
7. `traffic_shifted`
8. `completed`
9. `failed`
10. `rolled_back`

Required release contract:

1. App image is immutable (`image digest`, not mutable tag only).
2. Migrations are idempotent where possible.
3. Health endpoint checks DB and critical dependencies.
4. Rollback command is defined per service.

## 9) Migrations strategy (important)

Never hide migrations. Make them explicit release steps.

Safe migration pattern:

1. Deploy code compatible with old and new schema (expand).
2. Run additive migration.
3. Shift traffic.
4. Backfill if needed.
5. Remove old code paths later (contract).

Rules:

1. Avoid destructive DDL in same release as code switch.
2. Use online schema change patterns for large tables.
3. Keep migration timeout + retry policy explicit.
4. Block release if migration fails.

## 10) Rollout strategy

You can start with "replace-in-place" and evolve to blue/green.

### 10.1 Replace-in-place (MVP)

1. Stop old container.
2. Start new container.
3. Health check.
4. Revert to previous image on fail.

Pros:

1. Very simple.

Cons:

1. Brief downtime risk.

### 10.2 Blue/green (recommended once stable)

1. Keep old release "blue" serving traffic.
2. Start new "green" on separate port/network.
3. Run migrations if safe for compatibility.
4. Probe green until healthy.
5. Flip route to green.
6. Keep blue warm for fast rollback.

Pros:

1. Near-zero downtime.
2. Fast rollback.

Cons:

1. Higher temporary resource use.

## 11) Socket.IO architecture details

### 11.1 Transport behavior

Socket.IO can use:

1. HTTP long-polling (fallback)
2. WebSocket

If fallback polling stays enabled and app is multi-instance:

1. Use sticky sessions at edge/load balancer.

If you force websocket-only transport:

1. Sticky is usually unnecessary for connection affinity.
2. You still need Redis adapter for cross-instance event fanout.

### 11.2 Multi-instance broadcast

Use Socket.IO Redis adapter:

1. Each app instance publishes/subscribes through Redis.
2. Broadcast to room/client works across instances.
3. Without adapter, emits may stay local to one instance.

### 11.3 Operational concerns

1. Configure proxy timeouts for long-lived WS connections.
2. Raise file descriptor limits (`ulimit`) appropriately.
3. Watch Redis memory and eviction policy.
4. Track connection counts and message throughput by app.

## 12) Multi-tenant custom domains workflow

Target UX:

1. Customer enters domain in your app.
2. You show DNS record(s) to set.
3. Certificate auto-issues.
4. Domain becomes active.

Control-plane flow:

1. Create domain record with `pending_dns`.
2. Generate ownership token and expected DNS records.
3. Poll DNS from worker.
4. Once DNS valid, create/update edge route.
5. Trigger cert issuance.
6. Poll cert status until `active`.
7. Mark domain `ready`.

Rate limit protections:

1. Prevent repeated failed issuance attempts.
2. Cache negative checks for short period.
3. Respect ACME/CA rate limits.

## 13) Secrets and config management

Minimum standard:

1. Encrypted secrets at rest.
2. No secrets in git.
3. No plaintext secrets in logs.
4. Per-environment secret scopes.

Implementation options:

1. Start with `sops` + repo-encrypted files and CI decryption.
2. Evolve to Vault or cloud secret manager if complexity grows.

Secret rotation policy:

1. DB passwords every N months.
2. Redis auth rotation with planned cutover.
3. API keys rotated on incident and schedule.

## 14) Observability baseline

Metrics (Prometheus):

1. Host CPU, memory, disk.
2. Container restart counts.
3. HTTP request rates, latency, error rate.
4. WebSocket active connections.
5. Queue depth and job duration.
6. DB/Redis health metrics.

Logs (Loki/ELK):

1. Structured JSON logs.
2. Correlation IDs on every request.
3. Deployment event logs with release IDs.

Alerts:

1. 5xx spike.
2. P95 latency over threshold.
3. Deploy failure rate.
4. DB replication lag (if replicas).
5. Disk near-full.
6. Backup failed.

## 15) Backup and disaster recovery

Backups are useless without restore tests.

Backup plan:

1. MySQL:
   - nightly logical dump
   - periodic physical snapshot if possible
2. Redis:
   - RDB/AOF based on durability needs
3. Control-plane Postgres:
   - nightly dump
4. Config:
   - Caddy config exports
   - control-plane config and secrets metadata

Retention example:

1. Daily backups: 14 days
2. Weekly backups: 8 weeks
3. Monthly backups: 6 months

Restore drill:

1. Weekly automatic restore into isolated environment.
2. Validate app starts with restored DB.
3. Measure RTO/RPO and publish report.

## 16) Cost model and scaling triggers

Track:

1. Cost per app per month.
2. Cost per active tenant.
3. Cost per million requests.
4. Data egress cost.

Scale up when:

1. CPU > 70% sustained.
2. Memory pressure causes OOM/restarts.
3. p95 latency breaches SLO.
4. Queue lag grows.
5. DB IOPS saturation.

Scale strategy:

1. Vertical first for data node (simple).
2. Horizontal for app nodes (cheap and linear).
3. Split hot apps to dedicated DB/Redis when noisy.

## 17) Suggested MVP implementation plan (2 weeks)

Week 1:

1. Provision 2 VPS + private network.
2. Install Docker, Caddy, MySQL, Redis.
3. Build control API basics:
   - projects/services/releases/domains models
   - deploy job enqueue endpoint
4. Build deploy worker:
   - image deploy
   - health check
   - rollback
5. Add structured logs and basic metrics dashboard.

Week 2:

1. Add migration step runner + release gating.
2. Add domain onboarding workflow + cert status.
3. Add blue/green deploy mode for selected apps.
4. Add backup jobs + restore drill script.
5. Add audit trail and role-based access.

Definition of done:

1. New app can be deployed from git/ref in < 10 minutes.
2. Failed deploy auto-rolls back without manual SSH.
3. Customer domain goes `pending -> active` automatically.
4. On-call can diagnose failures via dashboard/logs.

## 18) API design sketch (control-plane)

Core endpoints:

1. `POST /projects`
2. `POST /services`
3. `POST /releases`
4. `GET /releases/:id`
5. `POST /releases/:id/rollback`
6. `POST /domains`
7. `POST /domains/:id/verify`
8. `GET /domains/:id`
9. `POST /deploy-jobs`
10. `GET /deploy-jobs/:id`

Webhooks/events:

1. `release.started`
2. `release.migration_succeeded`
3. `release.failed`
4. `domain.dns_verified`
5. `domain.cert_active`

## 19) Example Caddy patterns

Simple reverse proxy for app:

```caddyfile
app.example.com {
    reverse_proxy 10.0.1.10:3000
}
```

WebSocket-friendly proxy (default reverse_proxy handles Upgrade):

```caddyfile
realtime.example.com {
    reverse_proxy 10.0.1.10:3001
}
```

For very dynamic multi-tenant routing, prefer Caddy JSON API updates from control-plane rather than hand-editing files.

## 20) Example deploy flow pseudocode

```text
function deploy(service, git_sha):
  release = create_release(service, git_sha)
  image = build_or_fetch_image(release)
  candidate = start_candidate_container(service, image)

  if service.has_migrations:
    run_migrations(service, release) or fail_and_rollback()

  wait_for_health(candidate) or fail_and_rollback()
  switch_traffic_to(candidate)
  mark_release_success(release)
```

## 21) Operational runbooks you must have

1. "App down" runbook:
   - check edge route
   - check container health
   - rollback release
2. "DB degraded" runbook:
   - check locks/slow queries
   - apply emergency read-only mode if needed
3. "Redis pressure" runbook:
   - inspect memory/evictions
   - tune TTL/keys
4. "Cert not issuing" runbook:
   - validate DNS records
   - check CA rate limits
5. "Node full" runbook:
   - prune old images/logs
   - rebalance workloads

## 22) When to stop self-hosting

Move parts to managed services when:

1. Incident load starts impacting product delivery.
2. You need compliance features quickly.
3. Team cannot maintain 24/7 reliability expectations.
4. Multi-region/high availability becomes mandatory.

Practical migration path:

1. Keep apps self-hosted initially.
2. Move DB to managed first.
3. Move Redis second.
4. Keep control-plane mostly unchanged.

## 23) Alternative: accelerate with existing OSS PaaS

If you want faster time-to-value:

1. Coolify:
   - quick UI and project model
   - Apache-2.0
   - multi-server features documented as experimental
2. Dokku:
   - very simple single-host flow
   - less native multi-node behavior
3. CapRover:
   - Swarm-based model with UI
4. Kamal:
   - config/code-first deploy via SSH + Docker

You can still build your UI on top for internal workflow consistency.

## 24) Final recommendation for your case

Given your stated constraints (many apps, low cost, high programming capacity):

1. Start with 2-3 VPS and this mini-PaaS architecture.
2. Automate deploy + migration + rollback first.
3. Add domain onboarding automation second.
4. Add advanced scheduling/autoscaling only after real traffic proves the need.

This gives you control and low cost without taking on the full burden of running a cloud platform.

## Sources

Primary docs used for stack behaviors and constraints:

1. Docker Engine API: https://docs.docker.com/reference/api/engine/
2. Caddy API: https://caddyserver.com/docs/api
3. Caddy reverse proxy (WebSocket): https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
4. Caddy TLS (automatic HTTPS, on-demand considerations): https://caddyserver.com/docs/caddyfile/directives/tls
5. Socket.IO multiple nodes and sticky sessions: https://socket.io/docs/v4/using-multiple-nodes/
6. Socket.IO Redis adapter: https://socket.io/docs/v4/redis-adapter/
7. Let's Encrypt rate limits: https://letsencrypt.com/docs/rate-limits/
8. Coolify repository/license: https://github.com/coollabsio/coolify
9. Coolify multiple servers note: https://coolify.io/docs/knowledge-base/server/multiple-servers
10. Dokku scheduler model (docker-local): https://dokku.com/docs/deployment/schedulers/docker-local/
