# @jskit-ai/workspace-console-service-core

Core console domain services and actions for access, members, invites, and assistant settings.

Core-only ownership: this package does not own billing-domain services or console-error services.

## Exports

- `@jskit-ai/workspace-console-service-core`
- `@jskit-ai/workspace-console-service-core/client/consoleApi`
- `@jskit-ai/workspace-console-service-core/actions/consoleCore`
- `@jskit-ai/workspace-console-service-core/services/console`
- `@jskit-ai/workspace-console-service-core/services/consoleAccess`
- `@jskit-ai/workspace-console-service-core/services/consoleMembers`
- `@jskit-ai/workspace-console-service-core/services/consoleInvites`
- `@jskit-ai/workspace-console-service-core/mappers/consoleMappers`
- `@jskit-ai/workspace-console-service-core/policies/invitePolicy`

## Ownership boundaries

- Billing admin service implementations live in `@jskit-ai/billing-service-core`.
- Console error service implementation lives in `@jskit-ai/observability-core`.
- This package consumes billing behavior via explicit DI in `createService` (`consoleBillingServiceFactory`).

## Main APIs

### `createService(deps)` (`services/console`)

Builds the console facade used by app runtime composition. It owns:

- bootstrap/context resolution
- role catalog listing
- assistant settings read/update
- member list/update role
- invite list/create/revoke/redeem

Billing-related facade methods remain on this service for contract stability, but they are delegated to the injected `consoleBillingServiceFactory`.

### `createConsoleCoreActionContributor(deps)` (`actions/consoleCore`)

Registers only core console actions:

- `console.bootstrap.*`
- `console.roles.*`
- `console.settings.*`
- `console.members.*`
- `console.invites.*`
- `console.invitations.*`

No `console.billing.*` or `console.ai.*` actions are defined here.

### `createApi(httpClient)` (`client/consoleApi`)

Client API wrapper for core console HTTP endpoints (bootstrap, roles, settings, members, invites, pending invites, invite redemption).
