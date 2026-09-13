# Google Search Console setup and runtime

Documentation checked: 13 September 2026. Automated tests use simulated provider
responses and real private JSON state; live provider use is outside this delivery.

## Registration and manual setup

Follow all numbered steps in [Google registration setup](google-oauth.md).
For this connector, choose **Google Search Console API** in APIs & Services → Library and enable
`searchconsole.googleapis.com` in the selected Cloud project. Create a Web application client
with the exact backend callback URI. Set the client ID, secret reference and
callback URL reference in the same registration fields used by the CLI.

In Google Auth Platform → Data Access, select
`https://www.googleapis.com/auth/webmasters.readonly` for this initial read flow.
The UI exposes additional documented scopes for applications that need them;
sitemap writes need `webmasters` and fresh consent. Site Verification scopes
are for separate native API operations, not implemented here. Use External plus explicit
test users while testing outside an eligible internal Workspace audience.

## Fields and useful fragment

Provider ID: `google-search-console`. Import its provider from
`@jskit-ai/connectors-catalog/server/google-search-console`. Display name, scopes, account mode,
Client ID/secret and callback references follow the shared field mapping.
Membership and project access are enforced by the host/application policy,
not by storing untrusted people IDs in application source.

Verification input: `{}`. `sites.list` returns visible property IDs and permission
levels; an empty list is valid. `sites.get` accepts the exact `siteUrl` identifier.
Neither operation creates or verifies property ownership.

For a new property open [Search Console](https://search.google.com/search-console),
choose the property selector and **Add property**. A **Domain** property needs
Google's displayed DNS TXT record added at your DNS provider, followed by Verify.
A **URL prefix** property offers methods such as an HTML file or meta tag; keep
its exact scheme/host/prefix. Follow the method Google displays and retain the
verification resource. Alternatively an existing owner can use **Settings → Users
and permissions → Add user**. Client registration and selected scopes do not
replace those steps. DNS/host changes remain operator-owned actions.

| Operation | Inputs and behavior |
| --- | --- |
| `searchAnalytics.query` | siteUrl, inclusive startDate/endDate (`YYYY-MM-DD`), optional dimensions, type, filters, rowLimit and startRow. Finalized data only. |
| `urlInspection.inspect` | siteUrl, inspectionUrl, optional languageCode; returns Google's indexed snapshot and verdicts, not a live fetch. |
| `sitemaps.list` / `sitemaps.get` | siteUrl; get also requires the full feedpath URL. Preserve pending/errors/last-download metadata. |
| `sitemaps.submit` / `sitemaps.delete` | siteUrl and full feedpath. Requires webmasters and applicable property permission. Empty success returns null. |

Performance dates use Google's Pacific-time reporting boundaries. Available
dimensions are date, country, device, page, query and searchAppearance; duplicates
are rejected. Type is web, image, video, news, discover or googleNews. Optional
filters contain dimension/operator/expression and are ANDed. Operators: equals,
notEquals, contains, notContains, includingRegex and excludingRegex; the provider
validates RE2 syntax. Date filters use startDate/endDate instead.

rowLimit defaults to 1000 (maximum 25000); increase startRow by returned row count
until no rows remain. This does not guarantee all underlying traffic rows:
Google returns top data under its internal limits. Missing rows may mean no
reportable data, not a broken connection. Return clicks, impressions, CTR and
position without treating them as proof that all URLs are indexed.

```js
const report = await connections.invoke({ context, integrationId: "search",
  operation: "searchAnalytics.query", input: {
    siteUrl: "sc-domain:example.com", startDate: "2026-09-01", endDate: "2026-09-10",
    dimensions: ["query"], filters: [{ dimension: "device", operator: "equals", expression: "MOBILE" }]
  } });
```

For sitemaps, select **Manage Search Console properties**, add webmasters in Google
Data Access and reconnect. The app/owner must first publish an accessible sitemap
file. Submit registers that URL; it neither writes the file nor guarantees Google
will crawl/index it. Delete removes its Search Console entry, not the hosted file.
Inspect the entry after an uncertain write before deciding to repeat it.

Other frameworks use the same project config/Env with their native Google client
or HTTP. The app owns property authorization, report UI, comparisons and indexing
interpretation; no Vibe64 service receives search data.

**Limitations:** no DNS/HTML ownership deployment, Site Verification API, automated
indexing requests, sitemap generation, crawler or SEO dashboard. No fresh/hourly
performance mode or exhaustive traffic export. For example, an app can report
its popular queries and submit an existing sitemap, but cannot make an unverified
site appear in Google or guarantee rankings. Editor assistant attachment is
deferred. Fixtures do not prove live property access or indexing results.

Sources: [performance queries](https://developers.google.com/webmaster-tools/v1/searchanalytics/query),
[sitemap submission](https://developers.google.com/webmaster-tools/v1/sitemaps/submit),
[URL inspection](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect).

The first read must succeed before Connected is returned. Invalid resource
identifiers fail before opening consent. Denied scopes, wrong account context,
replayed callbacks and provider rate limits are covered by the automated tests.
See the [official operation reference](https://developers.google.com/webmaster-tools/v1/sites/list) for the response and resource
permission requirements; the implementation also checks Google's public API
discovery document for request paths and supported scope strings.

## Automation and application setup

Classification: **assisted**, as detailed in the common Google guide. An
operator-authorized AI can check/create the Cloud project and enable
`searchconsole.googleapis.com` with Service Usage or gcloud. It can prepare this connector's
JSON and callback/scope values. Web-client creation, branding, audience,
provider review and account consent remain the documented console/operator
steps; this adapter does not invent an API for them.

The application owns the Cloud project selection, registration, callback and
private secret bindings. It uses the same setup from a CLI or either editor.
Follow the common guide for rotation, revocation, domain changes and recovery.
Provider quotas belong to the selected Cloud project and resources; editor
subscription level does not allocate a shared registration.

## AI/CLI wiring

Use the file-store composition from the [connection pattern](../patterns/api-key-connection/PATTERN.md),
replace the API-key authentication with `oauth2` plus a registrationRef, and
register this provider. Use beginAuthorization / completeAuthorization instead
of connectApiKey, with the verification input above. The existing application
owns authenticated callback routes and its permission policy. Configuration,
OAuth, refresh, provider requests and storage remain library imports.

## Additional permission choices

The optional `siteverification` and `siteverification.verify_only` choices belong to the separate Site Verification API. They do not authorize Search Console property reads. Applications implementing those operations must enable Site Verification API and wire them separately; this fragment does not change site ownership. See [Site Verification authorization](https://developers.google.com/site-verification/v1/getting_started).
