# KLIPY

Import `klipyProvider` from `@jskit-ai/connectors-catalog/server/klipy`.
This own-key adapter browses and searches clips, GIFs, stickers and existing AI
emojis. It does not generate new emojis or implement managed billing.

## Manual provider setup

1. Sign into [Partner Panel](https://partner.klipy.com) and choose **Add Platform**.
2. Enter the platform name, contact email, company website and product
   description; accept the API terms and submit.
3. Create a named API key. Supply its **App URL** when available.
4. Store the value as `KLIPY_APP_KEY` in the backend environment. In Vibe64,
   add KLIPY, enter `env:KLIPY_APP_KEY` in **API key reference**, and choose
   **Save configuration**. Choose **Set credential in Env**, save the real key
   as `KLIPY_APP_KEY`, then return and choose **Connect account**. This reads
   trending metadata and consumes an API request; it does not grant production
   approval. No OAuth callback is required.
5. When the application is ready, open the key's **⋯ → Request Production**.
   Supply its category, estimated monthly active users and a screen recording,
   then choose **Apply**. Provider approval is a separate step.

[Partner Panel setup](https://klipy.com/blog/klipy-partner-panel).

Test keys allow 100 requests per hour. The developer page describes production
approval and an advertising option in **Update App Details**. Production
capacity and advertising behavior belong to the provider agreement; this
adapter makes no unlimited-capacity promise.
[Developer setup and limits](https://klipy.com/developers).

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "media": {
      "provider": "klipy",
      "displayName": "Clip search",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "api-key", "secretRef": "env:KLIPY_APP_KEY" }
    }
  }
}
```

Compose the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with
`providers: [klipyProvider]`, application authorization and private file storage.
The same configuration and runtime calls work from a manually wired CLI. The
provider module adds no database or Vibe64 service dependency.

```js
await connections.connectApiKey({ context, integrationId: "media" });
const clips = await connections.invoke({
  context, integrationId: "media", operation: "clips.search",
  input: { q: "happy dog", per_page: 8, locale: "us" }
});
```

| Operation | GET path after `/api/v1/<app_key>` | Required input |
|---|---|---|
| `clips.trending` (verification) | `/clips/trending` | None |
| `clips.search` | `/clips/search` | `q` |
| `gifs.trending`, `gifs.search` | `/gifs/trending`, `/gifs/search` | `q` for search |
| `stickers.trending`, `stickers.search` | `/stickers/trending`, `/stickers/search` | `q` for search |
| `emojis.trending`, `emojis.search` | `/emojis/trending`, `/emojis/search` | `q` for search |

The documented Clip API uses a key in the path. Pages start at 1; trending page
sizes range from 1 to 50 and search sizes from 8 to 50, with 24 as the default.
Both accept `customer_id`, a two-letter locale and a content-filter level.
The success envelope contains `result: true` and items in `data.data`.
[Clip API](https://docs.klipy.com/clips-api).

Local defaults are page 1, 24 items and `content_filter: "high"`. The runtime
accepts `off`, `low`, `medium` or `high` when explicitly supplied; the filter is
not a guarantee about every item's suitability. Local bounds cap pages at
100000, queries at 500 characters and customer identifiers at 256 characters.
Verification supplies no customer identity. If personalization is needed,
application code chooses an appropriate stable identifier; the adapter never
uses an email or account ID implicitly.

The module validates the collection envelope and preserves remaining response
metadata and media fields. Empty results are valid. Request another page
explicitly; returned links are not followed with credentials. A false `result`
does not verify a connection. HTTP authentication failures, permission errors
and rate limits become shared connector errors; arbitrary error bodies are
discarded. There is no automatic retry or background synchronization.

The backend encodes the key into the path only after checking the fixed HTTPS
destination. Logs and tracing must redact authenticated request paths. Source
and saved connection state contain references, and environment changes take
effect on the next call. Local disconnect does not revoke the provider key.
An app key is not a login identity or a per-user OAuth grant.

## API provisioning and application ownership

No public bootstrap API for initial platforms, keys or production approval was
verified in the linked documentation. An AI can prepare the configuration,
runtime wiring and approval information; account access and the documented
Partner Panel steps remain manual. Do not infer a provisioning API from the
dashboard's internal requests.

Create a key for the application and keep it in private Env. Distinct names alone
do not establish independent production limits; confirm the required capacity
with KLIPY. Preserve the customer's key ownership when exporting or moving the
application. This module consumes an explicitly supplied key.

Outbound reads need no OAuth callback, so VM subdomains and custom deployment
domains do not alter authentication. Record the intended application URL in
provider setup and satisfy its content/attribution agreement in the application.

## Focused evidence

Fixtures check trending verification, search encoding, pagination bounds,
locale/filter errors, unsuccessful envelopes, key rotation, private file-store
restart, owner isolation and provider failures. Core tests cover path encoding,
invalid destinations, ambiguous prefixes and error redaction. The editor test
checks the secret reference, setup link and reload persistence. No live key,
production approval, media use or generated sample application is exercised.

The official Partner Panel guide was rechecked on 2026-09-12. Expanded screen
steps cover Env handoff, connection verification, production approval and local
disconnect. Updated rendered review passed using simulated connection responses.

## Embedding and limits

The application supplies its own picker and native HTTP/runtime wiring in any
framework, using the same JSON and private Env. Use **Search KLIPY** as the
search placeholder. Choose an appropriate returned image/video format; preserve
its complete URL and delivery metadata. Images need meaningful alt text; clips
need user-controlled playback. Do not download media through this adapter.

Follow [KLIPY integration requirements](https://docs.klipy.com/clips-api): custom
server-side requests need prior provider approval, including this backend
integration. Proxying/caching requires separate approval. Preserve ranking,
reporting and any ad entries and delivery requirements; this reader preserves
the envelope but does not implement those UI events. Check these requirements
before shipping. The Partner Panel controls ads and content restrictions.

**LIMITATIONS:** No picker, ad renderer, share/report tracking, caching, new AI
emoji generation or automatic editor-assistant attachment. Example: a customer
can search existing dog stickers through app code, but cannot create a new dog
emoji through this adapter. Public docs advertise generation and status endpoints;
the request/result contract could not be established from the accessible docs,
so no guessed generation operation was added. No live/provider approval or
generated-app execution is claimed. Collection search intentionally uses the
same conservative local 8–50 item bound across these families.
