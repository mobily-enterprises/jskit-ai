# Contentful

Import `contentfulProvider` from `@jskit-ai/connectors-catalog/server/contentful`.
This connector reads published entries using a Content Delivery API key.

## Configure access

1. Sign into Contentful and select the space for this application.
2. Open **Settings → API keys**. Add or select a Content delivery / preview key.
3. Copy **Space ID** into the integration form. Copy **Content Delivery API
   access token** into private Env as `CONTENTFUL_ACCESS_TOKEN`.
4. Select an environment authorized for the key (`master` by default) and the
   space's region. Enter `env:CONTENTFUL_ACCESS_TOKEN` as the token reference.
5. Save, then explicitly connect. Verification reads one published entry at
   most. An empty published space is a valid successful result.
6. Rotate by updating the Env binding and verifying the replacement before
   retiring the old key in Contentful. Disconnect deletes local state only.

Content Management personal tokens and Preview tokens are different credentials.
See [Contentful authentication](https://www.contentful.com/developers/docs/references/authentication/).

## Portable configuration and CLI

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "content": {
      "provider": "contentful",
      "accountMode": "shared",
      "scopes": [],
      "settings": { "spaceId": "your-space-id", "environmentId": "master", "region": "us" },
      "authentication": { "method": "api-key", "secretRef": "env:CONTENTFUL_ACCESS_TOKEN" }
    }
  }
}
```

Replace the example Space ID with the actual value. Compose the
[API-key pattern](../patterns/api-key-connection/PATTERN.md) with this provider,
application authorization and private file state. CLI and UI use the same file.
The application owns its connection and controls who may read its content.

`entries.list` reads `/spaces/{spaceId}/environments/{environmentId}/entries`
on `cdn.contentful.com` or `cdn.eu.contentful.com`, using a Bearer header.
Inputs are `limit` (1–1000, default 1), `skip` (nonnegative, default 0), optional
`content_type`, `locale`, `include` (0–10), `order`, full-text `query` and `sys.id`.
The original JSON envelope is preserved, including unresolved-link errors and
`includes.Entry`/`includes.Asset`. Advance `skip` explicitly using `total`, `skip`
and `limit`, with an appropriate stable `order`; no automatic paging occurs.
Concurrent publication can still change offset results. Cursor/Sync APIs remain
native work. [Delivery API](https://www.contentful.com/developers/docs/references/content-delivery-api/overview/).

| Operation | Inputs | Purpose |
|---|---|---|
| `entries.list` | Pagination and fields above | Published entries, with optional linked content |
| `entries.get` | `id`, optional `locale` | One published entry |
| `assets.list` | `limit`, `skip`, optional `locale`, `order`, `query` | Published asset metadata |
| `assets.get` | `id`, optional `locale` | One asset's fields and file URL |
| `contentTypes.list` / `contentTypes.get` | Pagination / `id` | Content model fields |
| `locales.list` | Pagination | Locale codes, default/fallback information |

For a single article **with links**, use `entries.list` with `sys.id` and
`include`; the individual-entry endpoint does not expand links. Contentful's
include default is 1, maximum 10. Match linked IDs/types against `items` and
`includes`; unpublished/missing links can remain unresolved. Do not assume a
missing link means the entire request failed, or that every returned reference
has a corresponding asset. Preserve provider errors and handle absent content.
[Link resolution](https://www.contentful.com/developers/docs/references/content-delivery-api/links/).

```js
const page = await connections.invoke({ context, integrationId: "content",
  operation: "entries.list", input: { "sys.id": approvedArticleId, include: 2, locale: "en-US" } });
const image = await connections.invoke({ context, integrationId: "content",
  operation: "assets.get", input: { id: approvedAssetId, locale: "en-US" } });
```

`locale: "*"` returns locale-keyed field values; do not treat them as the same
shape as single-locale strings. Locales and fallback rules belong to the content
model. Asset results are metadata/file URLs, not downloaded bytes. Convert
protocol-relative file URLs to HTTPS when rendering and validate the destination
in your application's media policy; the adapter never forwards its token to an
asset URL. Rich-text rendering/sanitization and caching belong to the framework.

All operations are read-only Delivery calls. Preview drafts, publication, edits
and management credentials are intentionally excluded.

## Provisioning and ownership

The application owner supplies the space and key. No OAuth callback or Vibe64
registration is needed; custom application domains do not change this flow.
An AI can prepare the configuration and framework wiring. Contentful documents
Delivery key creation through its Content Management API after authorized
bootstrap access, as well as the console flow above. That management credential
is separate from the delivery key stored for runtime use. Account signup,
space access and authorizing bootstrap management access remain owner tasks.
Different key names do not establish independent quota allocations.

For Laravel, use native HTTP/configuration tools and the public application
setup command contract; this package provides JavaScript code only.

## Version-zero change and evidence

The initial unpublished CMA `spaces.list` fragment has been replaced. Existing
experimental configurations must supply `settings.spaceId`, a Delivery token,
and use `entries.list`. There is no compatibility alias or automatic token
conversion. Environment and region default to `master` and `us` respectively.

Focused controlled tests cover delivery headers and paths, EU/environment
selection, invalid settings before transport, published-entry validation,
page limits, private file-store restart, token rotation, isolation, disconnect
and provider failures. No live Contentful account or generated app was used.


**LIMITATIONS:** Vibe64 chat attachment is deferred: the app can display published
articles and images, but saving this connection does not let the coding assistant
browse the space. This connector does not author/publish content or render a CMS
interface. For example, publish the article and hero asset in Contentful first;
the app then resolves their IDs and renders them with its native components.
Cross-space authenticated links, Sync/cursor feeds and asset transformation are
native extensions, not silently fetched. Controlled tests cover links, locale
shapes, pagination, resource reads and errors; no live content was accessed.
