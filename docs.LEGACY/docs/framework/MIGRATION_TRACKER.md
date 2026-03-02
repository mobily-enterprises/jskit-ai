# Framework Migration Tracker (Stage 0)

Track each of the 87 JSKit packages that must keep descriptor/runtime metadata aligned during architecture migration.

| Domain | Package ID | Status | Notes |
| --- | --- | --- | --- |
| ai-agent | @jskit-ai/assistant-client-element | S9 | Descriptor + domain bundle mapping added |
| ai-agent | @jskit-ai/assistant-client-runtime | S9 | Descriptor + domain bundle mapping added |
| ai-agent | @jskit-ai/assistant-contracts | S9 | Descriptor + domain bundle mapping added |
| ai-agent | @jskit-ai/assistant-core | S9 | Descriptor + domain bundle mapping added |
| ai-agent | @jskit-ai/assistant-fastify-routes | S9 | Descriptor + domain bundle mapping added |
| ai-agent | @jskit-ai/assistant-provider-openai | S9 | Descriptor + domain bundle mapping added |
| ai-agent | @jskit-ai/assistant-transcript-explorer-client-element | S9 | Descriptor + domain bundle mapping added |
| ai-agent | @jskit-ai/assistant-transcripts-core | S9 | Descriptor + domain bundle mapping added |
| auth | @jskit-ai/access-core | S6 | Descriptor + domain bundle mapping added |
| auth | @jskit-ai/auth-web | S6 | Descriptor + domain bundle mapping added |
| auth | @jskit-ai/auth-provider-supabase-core | S6 | Descriptor + domain bundle mapping added |
| auth | @jskit-ai/fastify-auth-policy | S6 | Descriptor + domain bundle mapping added |
| auth | @jskit-ai/rbac-core | S6 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-commerce-client-element | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-console-admin-client-element | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-core | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-fastify-routes | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-knex-mysql | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-plan-client-element | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-provider-core | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-provider-paddle | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-provider-stripe | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-service-core | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/billing-worker-core | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/entitlements-core | S9 | Descriptor + domain bundle mapping added |
| billing | @jskit-ai/entitlements-knex-mysql | S9 | Descriptor + domain bundle mapping added |
| chat | @jskit-ai/chat-client-element | S7 | Descriptor + domain bundle mapping added |
| chat | @jskit-ai/chat-client-runtime | S7 | Descriptor + domain bundle mapping added |
| chat | @jskit-ai/chat-contracts | S7 | Descriptor + domain bundle mapping added |
| chat | @jskit-ai/chat-core | S7 | Descriptor + domain bundle mapping added |
| chat | @jskit-ai/chat-fastify-routes | S13 | Pending provider-runtime migration classification |
| chat | @jskit-ai/chat-storage-core | S7 | Descriptor + domain bundle mapping added |
| communications | @jskit-ai/communications-contracts | S6 | Descriptor + domain bundle mapping added |
| communications | @jskit-ai/communications-core | S6 | Descriptor + domain bundle mapping added |
| communications | @jskit-ai/communications-fastify-routes | S13 | Pending provider-runtime migration classification |
| communications | @jskit-ai/communications-provider-core | S6 | Descriptor + domain bundle mapping added |
| communications | @jskit-ai/email-core | S6 | Descriptor + domain bundle mapping added |
| communications | @jskit-ai/sms-core | S6 | Descriptor + domain bundle mapping added |
| contracts | @jskit-ai/http-contracts | S4 | Descriptor + shell bundle mapping added |
| contracts | @jskit-ai/realtime-contracts | S4 | Descriptor + shell bundle mapping added |
| observability | @jskit-ai/console-errors-client-element | S6 | Descriptor + domain bundle mapping added |
| observability | @jskit-ai/console-errors-client-runtime | S13 | Pending provider-runtime migration classification |
| observability | @jskit-ai/observability-core | S6 | Descriptor + domain bundle mapping added |
| observability | @jskit-ai/observability-fastify-routes | S13 | Pending provider-runtime migration classification |
| operations | @jskit-ai/redis-ops-core | S5 | Descriptor + infrastructure bundle mapping added |
| operations | @jskit-ai/retention-core | S5 | Descriptor + infrastructure bundle mapping added |
| realtime | @jskit-ai/realtime-client-runtime | S5 | Descriptor + infrastructure bundle mapping added |
| realtime | @jskit-ai/realtime-server-socketio | S5 | Descriptor + infrastructure bundle mapping added |
| runtime | @jskit-ai/action-runtime-core | S4 | Descriptor + shell bundle mapping added |
| runtime | @jskit-ai/console-core | S13 | Pending provider-runtime migration classification |
| runtime | @jskit-ai/container-core | S13 | Provider-runtime foundation scaffolded (container) |
| runtime | @jskit-ai/database-knex-core | S13 | Pending provider-runtime migration classification |
| runtime | @jskit-ai/health-fastify-routes | S4 | Descriptor + shell bundle mapping added |
| runtime | @jskit-ai/http-fastify-core | S13 | Pending provider-runtime migration classification |
| runtime | @jskit-ai/jskit-knex | S13 | Pending provider-runtime migration classification |
| runtime | @jskit-ai/jskit-knex-mysql | S13 | Pending provider-runtime migration classification |
| runtime | @jskit-ai/jskit-knex-postgres | S13 | Pending provider-runtime migration classification |
| runtime | @jskit-ai/kernel-core | S13 | Provider-runtime foundation scaffolded (kernel) |
| runtime | @jskit-ai/module-framework-core | S4 | Descriptor + shell bundle mapping added |
| runtime | @jskit-ai/platform-server-runtime | S4 | Descriptor + shell bundle mapping added |
| runtime | @jskit-ai/queue-core | S13 | Pending provider-runtime migration classification |
| runtime | @jskit-ai/runtime-env-core | S4 | Descriptor + shell bundle mapping added |
| runtime | @jskit-ai/server-runtime-core | S4 | Descriptor + shell bundle mapping added |
| runtime | @jskit-ai/support-core | S13 | Pending provider-runtime migration classification |
| security | @jskit-ai/security-audit-core | S5 | Descriptor + infrastructure bundle mapping added |
| social | @jskit-ai/social-client-runtime | S7 | Descriptor + domain bundle mapping added |
| social | @jskit-ai/social-contracts | S7 | Descriptor + domain bundle mapping added |
| social | @jskit-ai/social-core | S7 | Descriptor + domain bundle mapping added |
| social | @jskit-ai/social-fastify-routes | S13 | Pending provider-runtime migration classification |
| surface-routing | @jskit-ai/surface-routing | S4 | Descriptor + shell bundle mapping added |
| tooling | @jskit-ai/app-scripts | S4 | Descriptor + shell bundle mapping added |
| tooling | @jskit-ai/cli-entrypoint | S13 | Pending provider-runtime migration classification |
| tooling | @jskit-ai/config-eslint | S4 | Descriptor + shell bundle mapping added |
| tooling | @jskit-ai/create-app | S12 | Starter cutover to descriptor-only bundles; legacy manifest removed |
| tooling | @jskit-ai/jskit | S12 | No-legacy doctor guard and enforcement policy added |
| users | @jskit-ai/members-admin-client-element | S7 | Descriptor + domain bundle mapping added |
| users | @jskit-ai/profile-client-element | S7 | Descriptor + domain bundle mapping added |
| users | @jskit-ai/user-profile-core | S7 | Descriptor + domain bundle mapping added |
| web | @jskit-ai/http-client-runtime | S4 | Descriptor + shell bundle mapping added |
| web | @jskit-ai/web-runtime-core | S4 | Descriptor + shell bundle mapping added |
| workspace | @jskit-ai/console-errors-fastify-routes | S8 | Descriptor + domain bundle mapping added |
| workspace | @jskit-ai/console-fastify-routes | S8 | Descriptor + domain bundle mapping added |
| workspace | @jskit-ai/settings-fastify-routes | S8 | Descriptor + domain bundle mapping added |
| workspace | @jskit-ai/workspace-console-core | S8 | Descriptor + domain bundle mapping added |
| workspace | @jskit-ai/workspace-console-service-core | S8 | Descriptor + domain bundle mapping added |
| workspace | @jskit-ai/workspace-fastify-routes | S13 | Pending provider-runtime migration classification |
| workspace | @jskit-ai/workspace-service-core | S8 | Descriptor + domain bundle mapping added |
