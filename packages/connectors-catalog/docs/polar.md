# Polar

Import `polarProvider` from `@jskit-ai/connectors-catalog/server/polar`.
This is the Polar.sh commerce service. The fragment reads products through an
Organization Access Token; merchant activation and payment creation are separate.

## Configure access

1. Open the intended organization in the Polar dashboard, then **Settings**.
   Scroll to **Developers → New Token**.
2. Give the token an application-specific name and expiration. Select
   `products:read`, create the token and copy it into backend Env as `POLAR_OAT`.
   [Token setup](https://polar.sh/docs/integrate/oat).
3. Save provider `polar`, mode `shared` or `assistant`, `scopes: []`, and
   authentication `{ "method": "api-key", "secretRef": "env:POLAR_OAT" }`.
   The requested permission was assigned when creating the token, not through
   an OAuth consent flow in this configuration.
4. Choose `settings.environment: "sandbox"` (default) or `"production"`.
   Sandbox has separate organizations, data and tokens. Its origin is
   `https://sandbox-api.polar.sh`; production uses `https://api.polar.sh`.
   [Environments and authentication](https://polar.sh/docs/api-reference/introduction).
5. Call `connectApiKey` to verify product access. A customer access token does
   not replace this organization credential. Changing environments requires
   verification again. Local disconnect does not revoke the remote token.

## Runtime and AI composition

`products.list` reads `GET /v1/products/`, including the trailing slash to avoid
an authenticated redirect. Inputs are `page` (default 1), `limit` (1–100, default
10), optional product-name `query`, `is_archived` and `is_recurring` booleans.
The result retains `items` and `pagination` (`total_count`, `max_page`). Increment
the page until `max_page`. Additional array, metadata and sorting filters are
outside this operation's supported inputs.
[Product listing](https://polar.sh/docs/api-reference/2026-04/products/list-products).

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) and file store
to compose a product catalogue or picker. Creating checkout sessions, processing
webhooks and connecting other merchants through OAuth are further application
work. Replace Env credentials on rotation and revoke obsolete tokens in Polar.
Tests cover pagination, sandbox/production routing, invalid settings, credential
replacement, persistence and failures with simulated provider responses.

## Automation and application ownership

The documented OAT bootstrap is the organization dashboard; this pass does not
establish a public token-creation API. Polar does document organization creation
through `POST /v1/organizations/` with `organizations:write`, a name and slug.
That needs existing authorized access and does not complete merchant review or
activate payments. [Organization API](https://polar.sh/docs/api-reference/organizations/create).

An AI can prepare configuration and compose runtime calls after bootstrap.
Each application supplies a token belonging to its intended organization and
billing owner. Tokens within one organization share its applicable limits;
sandbox/production separates test and real commerce. The editor supplies no
shared registration, token pool or merchant account.

## Existing-scope closeout — 13 September 2026

The existing app-owned Organization Access Token adapter lists a Polar.sh product catalogue in sandbox or production, with bounded page/name/archive/recurrence filters and environment-bound verification.

This is NOT the captured personal builder MCP/billing-context experience: coding-assistant attachment and MCP authentication/tools remain deferred. No managed payments, merchant onboarding, checkout, subscription/customer/order management, refunds, webhooks, credits/entitlements, catalogue writes/synchronization or customer login is shipped by this adapter. No merchant OAuth, customer-access-token mode, token provisioning, extra array/metadata/sort filters or automatic pagination. Changing environment requires verification; local disconnect does not revoke the token. The app supplies its own organization token, permissions, UI and access policy. To extend: implement the separately deferred editor tool bridge for the captured use case; require a separate scope decision before adding an app billing product. Do not infer Stripe/Paddle parity from this catalogue reader. No live provider account, provider registration, paid request or generated-application execution was tested. No new editor coding-assistant tool attachment is claimed. Other frameworks use the same project configuration and their own native tools; JSKIT is optional.

2 Polar-specific plus 2 shared environment/pagination source checks passed, and the same 4 installed-package checks passed on September 13. Existing shared token/environment form evidence is retained; no fresh browser run.
