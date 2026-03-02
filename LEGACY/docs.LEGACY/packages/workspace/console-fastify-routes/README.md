# @jskit-ai/console-fastify-routes

Fastify adapter for workspace console APIs (bootstrap, members, invites, AI transcripts, billing admin).

## What this package is for

Use this package to expose console/admin workflows over HTTP for authenticated operators.

It is the transport boundary for high-level console features such as:

- bootstrap data and role catalogs
- assistant and billing settings
- member and invite management
- transcript browsing/export
- billing plan/product management

## Key terms (plain language)

- `bootstrap`: initial data payload needed when console app loads.
- `role`: permission profile (owner/admin/member).
- `invite`: token-based invitation for a user to join workspace.

## Public API

## `createController(deps)`

Creates console controller handlers.

Returned handlers:

- `bootstrap`
  - Returns initial console payload.
  - Real example: console frontend first page load.
- `listRoles`
  - Returns role catalog.
  - Real example: role dropdown in member-management screen.
- `getAssistantSettings`
  - Reads assistant feature settings.
  - Real example: admin checks transcript retention mode.
- `updateAssistantSettings`
  - Updates assistant settings.
  - Real example: enable/disable an assistant option in console.
- `getBillingSettings`
  - Reads billing config/settings.
  - Real example: admin opens billing settings page.
- `updateBillingSettings`
  - Updates billing settings.
  - Real example: change trial duration policy.
- `listMembers`
  - Lists members.
  - Real example: membership table.
- `updateMemberRole`
  - Changes member role.
  - Real example: promote member to admin.
- `listInvites`
  - Lists active invites.
  - Real example: audit pending invitations.
- `createInvite`
  - Creates a new invite.
  - Real example: invite teammate by email.
- `revokeInvite`
  - Revokes an invite.
  - Real example: cancel invite sent to wrong email.
- `listPendingInvites`
  - Lists invites pending acceptance for current user/token scope.
  - Real example: user dashboard shows invites awaiting decision.
- `respondToPendingInviteByToken`
  - Accepts or declines invite by token.
  - Real example: user clicks "Accept invite" email link.
- `listAiTranscripts`
  - Lists AI transcript sessions.
  - Real example: support reviews recent assistant conversations.
- `getAiTranscriptMessages`
  - Reads one transcript's messages.
  - Real example: inspect full conversation for QA.
- `exportAiTranscripts`
  - Exports transcript data.
  - Real example: compliance export for audit period.
- `listBillingEvents`
  - Lists billing events.
  - Real example: track subscription lifecycle events.
- `listBillingPlans`
  - Lists plan catalog.
  - Real example: admin panel plan table.
- `listBillingProducts`
  - Lists product catalog.
  - Real example: one-time add-on product table.
- `createBillingPlan`
  - Creates a billing plan.
  - Real example: launch new "Pro Plus" tier.
- `createBillingProduct`
  - Creates a billing product.
  - Real example: add support package add-on.
- `listBillingProviderPrices`
  - Lists upstream provider prices.
  - Real example: verify Stripe/Paddle price IDs before mapping.
- `updateBillingPlan`
  - Updates plan metadata.
  - Real example: change display name or sort order.
- `updateBillingProduct`
  - Updates product metadata.
  - Real example: retire or rename legacy product.

## `buildRoutes(controller, options)`

Builds route definitions for the console API surface.

Real example: app startup registers these routes so console frontend has a ready API backend.

## `schema`

Exports route schemas for validation and docs.

Real example: invalid member-role payload fails fast with structured validation error.

## How apps use this package (and why)

Typical flow:

1. App builds console domain services.
2. Creates controller with those services.
3. Registers routes with shared schemas.
4. Console frontend calls these endpoints for every admin workflow.

Why apps use it:

- shared admin API contract
- keeps controller logic thin and consistent

## Provider runtime (new path)

- `ConsoleRouteServiceProvider` is exported for provider/kernel runtime boot.
- Required container binding:
  - `actionExecutor`
- Optional binding:
  - `aiTranscriptsService`
