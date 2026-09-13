# Shopify

The initial runtime connects an existing store, lists products, and creates,
updates or deletes one product per call. It uses GraphQL Admin API **2026-07**.
It does not generate a storefront or activate a store. The portable assistant
policy includes the captured lifecycle, variant, discount and price-rule choices;
those choices do not claim that the corresponding provider operation exists yet.

## Configuration and ownership

```json
{
  "schemaVersion": 1,
  "registrations": {
    "shopify-own": {
      "source": "own",
      "grantType": "client_credentials",
      "clientId": "your-shopify-client-id",
      "clientSecretRef": "env:SHOPIFY_CLIENT_SECRET"
    }
  },
  "integrations": {
    "shopify": {
      "provider": "shopify",
      "displayName": "Company store",
      "accountMode": "shared",
      "authentication": { "method": "oauth2", "registrationRef": "shopify-own" },
      "settings": { "shopDomain": "your-store.myshopify.com" },
      "scopes": ["read_products", "write_products"],
      "assistantPolicy": {
        "enabled": true,
        "defaultPermission": "ask",
        "actions": { "products.list": "always", "products.delete": "never" }
      }
    }
  }
}
```

Keep the secret value in the application's environment, with the same reference
used by CLI and editor. For an existing Admin API access token, replace
`authentication` with `{ "method": "api-key", "secretRef": "env:SHOPIFY_ADMIN_TOKEN" }`
and remove the unused registration. Storefront tokens, App Automation Tokens,
client secrets and Customer Account tokens are different credentials.

The store is a shared account. Authorize each application user before mapping to
its stable shared subject. Neither token mode authenticates shoppers or enforces
each staff member's individual Shopify role. A per-staff installation needs
Shopify online access tokens and its separate consent flow, still unfinished here.
An assistant must use a service composed with `executionMode: "assistant"`;
`accountMode` describes whose connection is used, not who invoked the operation.

## Manual setup: app and store in the same organization

1. Sign into the [Dev Dashboard](https://dev.shopify.com/) with permission to
   create apps and install them on the target store. Select the organization that
   owns the store. Both app and store must appear in this organization.
2. Open **Apps → Create app**. Choose the Dev Dashboard creation option, enter
   your application name and create it. An existing app can be selected instead.
3. Open **Versions → Create a version**. Set the application URL to your actual
   app entry point. Configure the app's access scopes: `read_products` for the
   reader, `write_products` when product changes are required. Release the version.
   A write scope includes reads; the runtime accepts either for product listing.
4. Install the released app on the intended store and approve its scopes. Update
   the installation when changing scopes; editing local JSON alone grants nothing.
5. Open the app's **Settings → Credentials**. Copy **Client ID** into the portable
   registration. Put **Client secret** in Env and set its reference in the form.
6. Find the store's permanent `*.myshopify.com` address and enter it without
   `https://`, paths, ports or a custom storefront domain.
7. Select **App in your Shopify organization** in the editor. Save configuration.
   The backend or trusted CLI calls `connectClientCredentials` to acquire a token
   and verify a product read before reporting Connected.
8. Keep the shared subject and application/environment identity stable. The
   runtime persists encrypted connection state and obtains another grant before
   the documented 24-hour token expires. No callback URL is used in this mode.

If Shopify reports `shop_not_permitted`, correct ownership/distribution. Installing
an app on another merchant's store does not make client credentials applicable.
See [organization authentication](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant)
and [credential locations](https://shopify.dev/docs/apps/build/authentication-authorization/manage-credentials).

## Manual setup: existing Admin API token

For a legacy custom app created in Shopify admin before January 2026, open the
store's **Settings → Apps and sales channels → Develop apps**, select the app,
review its Admin API scopes and installation, and use its existing Admin API token.
If the secret cannot be revealed again, follow Shopify's credential recovery or
replacement procedure; do not assume the editor can retrieve it. New apps use the
Dev Dashboard flow instead. See [legacy custom apps](https://shopify.dev/docs/apps/build/authentication-authorization/legacy/admin-custom-apps).

Choose **Existing Admin API access token**, enter the secret's Env reference and
the permanent store domain, and save. The app/CLI calls `connectApiKey`; it performs
a product read before persisting Connected. Token rotation is read from the same
reference on subsequent requests. The scopes in configuration limit permitted
operations locally; Shopify remains the authority for the token's actual rights.

## Application registrations, callbacks and domains

Shopify's word *online* describes a staff-user access token. It is unrelated to
the Vibe64 Online product.

The application owner creates its Shopify app in the Dev Dashboard, configures
its distribution, access scopes and application URL, and completes any required
review. Follow the app/version/release steps above and store its client secret
in the application's private Env. Public distribution, custom distribution and
organization-only apps are not interchangeable.

The supported client-credentials flow does not require a callback. Merchant
consent is a separate unfinished flow: it needs the application's actual allowed
redirect URI, signed Shopify callback validation and the appropriate installation
lifecycle. Online staff sessions are also unfinished in this adapter. Follow
Shopify's [authentication guide](https://shopify.dev/docs/apps/build/authentication-authorization)
and official libraries; do not substitute a generic OAuth callback without
Shopify's required verification.

For that consent flow, changing the callback domain requires updating the app's
registration and Env. Retain the application's identity and persistent state
when moving hosts. A token remains bound to its shop and registration; changing
provider registrations requires a new installation/grant.

GraphQL Admin quotas are scoped to an **app/store pair**. Separate registrations
do not remove store resource limits, Shopify plans or review requirements.
[API limits](https://shopify.dev/docs/api/usage/limits).

## Store creation and claiming

For an ordinary partner handover: Dev Dashboard **Stores → Create store → Client
transfer store**, enter the name and country/region, then create it. To hand over,
open the **Client transfer** tab, use the store's **⋯ → Transfer store**, enter the
client email and submit. The client accepts ownership and selects a plan in
Shopify. Only perform those external actions with the owner's authorization.

This is a distinct host lifecycle, not a GraphQL product mutation. Shopify places
installation restrictions on client transfer stores; dev stores cannot be
transferred. A transfer also moves the store out of the original organization,
so organization-only client credentials cannot be assumed to remain usable.
Vibe64's automatic create/claim workflow and any commercial Shopify arrangement
are not delivered by this fragment. Do not promise Lovable's trial terms.
See [client transfer stores](https://shopify.dev/docs/apps/build/stores/client-transfer-stores).

## Runtime and assistant authorization

Import `shopifyProvider` from `@jskit-ai/connectors-catalog/server/shopify` and
compose it with `createConnectionService`, the shared file store and a trusted
reference resolver. Supported provider operations:

| Operation | Input | Result |
|---|---|---|
| `products.list` | `first` 1–100 (20 default), optional opaque `after`, Shopify search `query` | GraphQL envelope with product nodes and page cursor |
| `products.create` | `product.title`; optional descriptionHtml, vendor, productType, status, tags | Confirmed product and empty userErrors; defaults to DRAFT |
| `products.update` | `product.id` (Product GID) plus one or more supported product fields | Confirmed updated product |
| `products.delete` | `input.id` (Product GID) | Confirmed deletedProductId; synchronous request |

No raw GraphQL or caller-supplied destination is accepted. Product IDs are GraphQL
GIDs, not numbers. Product status does not publish it to sales channels. Price and
SKU changes belong to variants and are not accepted by these product mutations.
Mutations are not automatically retried. A timeout may leave a completed Shopify
change: inspect the store before retrying, particularly after creation.

For assistant execution, compose the same service with `executionMode: "assistant"`.
The existing `authorize(context, request)` callback still verifies application
access and returns the trusted `applicationId` and `subjectId`. When
`request.assistantPermission.decision === "ask"`, it must also verify the human's
approval for that exact action/input and return `approved: true`. No such result
means `connector_approval_required`; `never` or disabled access stops before any
credential lookup or provider request. `always` still requires application access.
The host owns its approval UI, decision persistence, expiry and single-use checks.
Never copy `approved`, execution mode or owner identity from a browser request.

`authorizeAssistantAction({ context, integrationId, action: "claim", input })`
allows a host to apply the same policy before its own lifecycle operation. It
performs authorization only, never store creation, claiming or API calls. Use
`invoke` for the implemented product operations. The lifecycle host must still
validate its input and satisfy workspace policy. There is no new approval database.

The shared form offers access enablement, **Manage all permissions** and all
captured action choices. Changing the default resets individual overrides; choices
are `ask`, `always`, `never`. The policy lives outside credential settings, so a
policy edit does not invalidate a store grant. Workspace-level availability and
the actual editor assistant tool wiring remain separate unfinished host work.

## Automation feasibility and verification

AI can author/validate the portable file, wire the shared runtime and file store,
prepare Shopify app configuration, and perform supported product operations
through the application's authorized server. CLI/deployment automation can update
an existing app after an operator establishes its organization and credentials.
An App Automation Token authenticates Shopify CLI automation; it is not the
Admin API token used by this runtime.

Account/organization creation, merchant consent, review, billing, store transfer
and any partner agreement require the appropriate human/provider process. A public
API for silently provisioning both platform apps or reproducing Lovable's special
create/claim arrangement has not been established. Do not invent one.

Local fixture tests cover organization grants and renewal, existing tokens,
encryption/restart, product operations and bounds, scopes, ownership and store
isolation, assistant decisions, error responses and cancellation. They make no
live Shopify calls. A credentialed store is still required to prove installation,
actual product access, provider quotas and account-specific permissions. The full
merchant-consent, managed, variant/discount and store lifecycle flows remain open.

Operation references: [products](https://shopify.dev/docs/api/admin-graphql/latest/queries/products),
[productCreate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate),
[productUpdate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/productUpdate),
[productDelete](https://shopify.dev/docs/api/admin-graphql/latest/mutations/productDelete).
