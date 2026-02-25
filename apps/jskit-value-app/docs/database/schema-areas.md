# Database Schema Areas

Last validated: 2026-02-25 (UTC)

This document maps the database by functional area so `docs/database` covers the full schema surface, not just billing.

Sources:

- Baseline migration step set:
  - `apps/jskit-value-app/migrations/20260224000000_baseline_schema.cjs`
  - `apps/jskit-value-app/migration-baseline-steps/`
- Billing live-schema inventory:
  - `apps/jskit-value-app/docs/database/billing-live-schema.md`

## Identity and User Profile

- `user_profiles`
- `user_settings`

## Workspace and Tenancy

- `workspaces`
- `workspace_memberships`
- `workspace_settings`
- `workspace_invites`
- `workspace_projects`

## DEG2RAD / Calculation Domain

- `calculation_logs`

## Console and Admin

- `console_memberships`
- `console_invites`
- `console_root_identity`
- `console_settings`
- `console_browser_errors`
- `console_server_errors`

## AI Conversations and Messages

- `ai_conversations`
- `ai_messages`

## Chat Domain

- `chat_user_settings`
- `chat_user_blocks`
- `chat_threads`
- `chat_thread_participants`
- `chat_messages`
- `chat_attachments`
- `chat_message_idempotency_tombstones`
- `chat_message_reactions`

## Social Federation Domain

- `social_actors`
- `social_actor_keys`
- `social_posts`
- `social_post_attachments`
- `social_follows`
- `social_inbox_events`
- `social_outbox_deliveries`
- `social_notifications`
- `social_moderation_rules`

## Security and Audit

- `security_audit_events`

## Billing and Entitlements

Detailed billing schema coverage is maintained separately in:

- `apps/jskit-value-app/docs/database/billing-live-schema.md`

Billing/entitlements tables covered there:

- `billable_entities`
- `billing_checkout_sessions`
- `billing_customers`
- `billing_events`
- `billing_payment_methods`
- `billing_plan_assignment_provider_details`
- `billing_plan_assignments`
- `billing_plans`
- `billing_purchases`
- `billing_request_idempotency`

## Migration Metadata (Knex)

Managed by Knex migration tooling:

- `knex_migrations`
- `knex_migrations_lock`
