# Google Ads

The fragment uses Google user OAuth and REST v25 to list accessible accounts,
read account hierarchies and run paged reports. Campaign changes, service-account
grants and application login are outside this fragment.

## Set up Google Cloud access

Google retired developer tokens on September 9, 2026. API access now belongs to
the Cloud project owning the OAuth client. Remove `apiAccess` and
`developerTokenRef` from pre-release configuration; there is no compatibility
reader. The editor no longer asks for a token or pilot selection.
[Google migration notice](https://developers.google.com/google-ads/api/docs/api-policy/developer-token).

1. Select or create the application's Google Cloud project. Enable **Google Ads
   API** through **APIs & Services → Library**.
2. Open its **Google Ads API Overview** page. Check the access level. If it is
   Test, expand **Upgrade access level** and apply for Explorer to use production
   accounts. Higher access has its own approval requirements.
   [Current setup](https://developers.google.com/google-ads/api/docs/get-started/make-first-call).
3. In **Google Auth Platform**, configure **Branding**, **Audience** and **Data
   Access**. Add test users while testing and the
   `https://www.googleapis.com/auth/adwords` scope. Complete applicable consent
   publishing and verification before public use.
4. In **Clients**, create a **Web application** client. Add this project's exact
   **Suggested callback URL** under **Authorized redirect URIs**. Copy Client ID
   into the connector form. Save configuration, then use the Env links to store
   the client secret and identical callback URL under their referenced names.
   [Web OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server).
5. When accessing customers through a manager, enter its ten-digit customer ID
   without hyphens. Direct account access can leave this blank. The consenting
   person must have the intended Ads account access. Target customer IDs remain
   operation inputs, separately authorized by the application.
6. The application's backend implements the callback and connection lifecycle.
   Use **Connect account** for a shared account; individual app users connect in
   the application's own account screen. Initial verification lists directly
   accessible accounts, not every inherited child account. Disconnect removes
   local state; revoke Google consent separately when intended.

## Portable configuration

```json
{
  "schemaVersion": 1,
  "integrations": {
    "ads": {
      "provider": "google-ads",
      "displayName": "Advertising reports",
      "accountMode": "per-user",
      "scopes": ["https://www.googleapis.com/auth/adwords"],
      "settings": { "loginCustomerId": "1234567890" },
      "authentication": { "method": "oauth2", "registrationRef": "ads-client" }
    }
  },
  "registrations": {
    "ads-client": {
      "source": "own",
      "clientId": "replace-with-web-client.apps.googleusercontent.com",
      "clientSecretRef": "env:GOOGLE_ADS_CLIENT_SECRET",
      "callbackUrlRef": "env:GOOGLE_ADS_CALLBACK_URL"
    }
  }
}
```

Replace the placeholders with project-owned resources. Secrets and grants stay
with the application. CLI, public Vibe64 and Online use the same configuration;
Laravel implements it with its own framework. Host/domain changes require the
provider registration and callback Env value to match the application's new
callback. Keep persistent grants and application identity when moving hosts.

An authorized AI can prepare configuration and enable APIs using Google Cloud's
normal tooling. OAuth client creation, consent verification and access approval
require the actual owner's permissions and provider processes. There is no
universal Vibe64 credential or automatic approval. API quotas follow the Cloud
project and account limits; a second OAuth client does not imply independent
capacity. The adwords permission can authorize writes even though this fragment
only implements reads.

## Runtime composition and limits

Import `googleAdsProvider` from
`@jskit-ai/connectors-catalog/server/google-ads`. Register it with the existing
`createConnectionService`, configuration reader, reference resolver, owner policy
and encrypted file store. The OAuth source pattern provides composition without
an editor or database. The app owns its login and each reporting action's policy.

| Operation | Input and result |
|---|---|
| `customers.listAccessible` | No input; returns Google's `resourceNames`. Missing repeated fields can mean an empty result. This is the connection check. |
| `customers.listClients` | `customerId`, optional `pageToken`; a fixed `customer_client` query returns hierarchy metadata and levels. It does not recurse automatically. |
| `reports.search` | `customerId`, `query`, optional `pageToken`; one GAQL Search page, with original result field names and metadata. |

The runtime sends only fixed Google token/API destinations. Search uses POST
JSON but is a read operation. Its page size is Google's fixed 10,000 rows; the
caller cannot send `pageSize`, arbitrary headers, destinations or a different
manager ID. Queries are single-line SELECT text, at most 16,000 characters and
32,000 UTF-8 bytes. Use GAQL `LIMIT` and approved date ranges to bound reports.
Keep page tokens with the original query, customer and owner; request each page
explicitly. 64-bit values stay strings, including money in micros. Preserve that
precision when displaying or aggregating them. No SQL/GAQL parser or query-cost
estimator is implied. [REST Search and pagination](https://developers.google.com/google-ads/api/rest/common/search).

The application must authorize account IDs, fields, filters and query inputs
before invoking the library. Configuration ownership and the manager header do
not make an arbitrary report endpoint safe for every app user. The host policy
receives an input snapshot; its mutation cannot change the request. The API scope
does not replace your application's authorization.

OAuth grants refresh through the shared locked file implementation. Changed
client identity/settings require reconnecting. Missing OAuth bindings produce `connector_binding_missing`; project approval failures use
`connector_api_access_invalid` without discarding the user's valid OAuth grant.
Quota, permission, scope, query and reconnect failures remain distinct. Raw
provider error bodies and query echoes are not exposed. Requests respect abort
signals/timeouts and are not replayed automatically. Disconnect removes local
access; Google account revocation is a separate owner action.

## Verification boundary

Focused tests use controlled OAuth and Ads HTTP responses with the real shared
validator and encrypted file store. They cover Cloud-project configuration, OAuth/header
separation, query/page bounds, int64 preservation, empty/malformed results,
restart, concurrent refresh/rotation, ownership, policy, denied consent, errors
and interruption. No live accounts, Cloud-project approvals, reports,
campaign actions or generated applications are used. Provider approval and live
consent remain separate acceptance work.

## Existing-account Search campaign service

`@jskit-ai/connectors-catalog/server/google-ads-search` exports
`createGoogleAdsSearchService({ connections, configuration, context, integrationId })`.
Its reusable operations discover accounts/website conversion goals and targeting,
validate a saved plan with Google, atomically create a paused Search campaign,
inspect a current campaign, separately launch/pause it and report last-30-days
metrics. The application owns the authenticated administrator and connection
service; CLI apps use this without Vibe64.

Store plans at `extensions.googleAdsSearch[integrationId]`, outside OAuth settings.
Use `validateGoogleAdsSearchPlan` from the shared `google-ads-search` export. Read
`patterns/google-ads-search/PATTERN.md` for command composition and boundaries.
The public editor has preparation/review controls; another framework uses the same
JSON/Env contract with native Google APIs, not a JSKIT sidecar.

In Google Ads, select an existing active client account, then Goals → Conversions
→ Summary to select or create a website lead goal. Tag setup gives the global tag
and successful-lead event; integrate with existing consent/tag management, avoid
duplicate tags and verify using Tag Assistant. This service can create a website
lead goal and return snippets; it does not install them automatically. Confirm
billing/advertiser readiness separately before launching. Creation stays paused;
a lost write response must be investigated in Google Ads before retrying.

LIMITATIONS: no advertiser account provisioning, Performance Max, Demand Gen or
live coding-assistant tool attachment. For example, asking chat to create a new
Ads account and autonomously optimize a PMax campaign remains unsupported. The
current editor command uses development Env and may affect a real Ads account.
Fixtures prove composition and request/approval behavior, not Google live approval.
