# X (Twitter)

Import `xTwitterProvider` from `@jskit-ai/connectors-catalog/server/x-twitter`.
This adapter reads public profiles, post timelines and recent search using an app-only
bearer token. The shared connection service and file store work from a CLI or
application server. Vibe64 edits the same JSON; saving does not contact X.

## Create the provider application

1. Sign into [Developer Console](https://console.x.com). Complete developer
   onboarding, including the account profile, use case and provider agreements.
2. Choose **New App**. Enter the application name, description and use case.
   Use a name that identifies the actual operator and application purpose.
3. In the created application's credentials, copy its **Bearer Token** for
   app-only access. Keep it in the backend environment or secret store. The
   credentials shown during creation must be retained securely.
4. In Developer Console, check API access, credits and spending controls for
   the owning account. Verification is a real profile lookup and can consume
   credits. A token's existence does not establish usable API access.
5. Save only the reference in the JSON below. Do not paste the token into source
   or include the `Bearer ` prefix in its environment value.
6. Explicitly verify with `connectApiKey` and a known public username without
   `@`. A missing profile is a failed check, not evidence that the token is bad;
   choose an accessible profile and retry deliberately.

The console's application credentials include several authentication types;
this fragment uses its app-only token. [Access setup](https://docs.x.com/x-api/getting-started/getting-access)
and [usage billing](https://docs.x.com/x-api/getting-started/pricing).

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "social": {
      "provider": "x-twitter",
      "displayName": "Public research",
      "accountMode": "shared",
      "scopes": [],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:X_APP_BEARER_TOKEN"
      }
    }
  }
}
```

`assistant` ownership is also supported through the host's authorization policy.
The file has no OAuth registration or permission checkboxes for this credential
type. X calls this OAuth 2.0 application-only authentication; the shared library's
`api-key` method means that it consumes an externally supplied credential rather
than starting an authorization journey.

## Runtime composition and operations

Use the API-key connection pattern to construct `connections` with this provider,
the parsed file, encrypted file storage, reference resolution and host access
policy. The catalogue contains the actual transport and validation implementation;
no copied app template is required. Both configuration parsing and the service
must receive `xTwitterProvider` in their `providers` arrays.

```js
await connections.connectApiKey({
  context: authenticatedOwner,
  integrationId: "social",
  verificationInput: { username: "example" }
});
const profile = await connections.invoke({
  context: authenticatedOwner,
  integrationId: "social",
  operation: "users.lookup",
  input: { username: "example" }
});
const firstPage = await connections.invoke({
  context: authenticatedOwner,
  integrationId: "social",
  operation: "users.posts",
  input: { userId: profile.data.id, maxResults: 10 }
});
// Request another page explicitly, only when the caller wants it.
const nextCursor = firstPage.meta.next_token;
```

The username above is illustrative; supply a real, authorized target. The
application determines `authenticatedOwner` from its trusted CLI operator or
authenticated session and authorizes the particular operation and target.
It must not copy ownership IDs from arbitrary browser input.

| Operation | Input | Request/result |
|---|---|---|
| `users.lookup` (verification) | Required `username`, 1–15 letters, digits or underscores, without `@` | GET `/2/users/by/username/{username}` with description, image and public metrics fields; original profile envelope |
| `posts.searchRecent` | Required `query` (1–512 characters), optional `maxResults` 10–100 and `nextToken` | GET `/2/tweets/search/recent`; posts, author/media expansions and metadata |
| `users.posts` | Required decimal-string `userId` (1–19 digits); optional `maxResults` 5–100 (default 10), `paginationToken` | GET `/2/users/{id}/tweets`; original post array and pagination metadata |

Requests use the fixed `https://api.x.com` origin. Keep IDs as strings to avoid
rounding. Empty timelines may omit `data`; their `meta.result_count` is zero.
Each invocation makes one request without redirects or automatic paging.
Returned cursors must stay with the same account, user and query; do not decode
or construct them. Search accepts provider query operators; no arbitrary URL or write route is exposed.
[Profile endpoint](https://docs.x.com/x-api/users/get-user-by-username),
[timeline endpoint](https://docs.x.com/x-api/users/get-posts).

The runtime rejects malformed envelopes and responses containing partial errors.
A missing resource becomes `connector_resource_not_found`; incomplete results
become `connector_response_incomplete`. HTTP 402 becomes
`connector_billing_required`; 401, 403 and 429 use the shared reconnection,
permission and rate-limit errors. Provider error text is omitted. Cancellation
and timeouts do not replay requests or discard a verified connection.

## Application ownership and callbacks

An app-only token has no current user. A public profile lookup is not a login
check. Posting, private messages and access on behalf of individual app users
require a separate user authorization implementation. This fragment must not be
advertised as individual users connecting their X accounts.
[Authentication boundary](https://docs.x.com/fundamentals/authentication/oauth-2-0/application-only).

An OAuth callback is **not applicable to this bearer-token flow**. Neither a
customer's VPS hostname nor a custom application domain changes authentication.
The application owner supplies its authorized token through private Env and
retains that credential ownership when moving hosts.

Separate application registrations may identify traffic, but this guide
does not establish independent billing or quota pools merely from different
app IDs. Confirm the provider's permitted account arrangement and applicable
limits before promising independent capacity or redistribution to customer apps.
CLI and self-hosted apps can supply their own tokens using this same file format.

Local disconnect deletes the stored connection, without invalidating the
provider's application-wide token. An operator can replace its secret binding
and verify again. Provider token invalidation affects every consumer of that
app token; it is a separate operator action.
[Token lifecycle](https://docs.x.com/fundamentals/authentication/oauth-2-0/application-only).

## Automation assessment

| Task | What an AI can do |
|---|---|
| Create the application-owned provider registration | The reviewed setup documents use Developer Console. No general application-provisioning API was established. An authorized operator can follow the steps above; onboarding and provider approval remain external work. |
| Obtain an app-only token from existing app credentials | X documents `POST /oauth2/token` using the app's consumer key and secret. That exchange can be automated separately; this fragment accepts the resulting token reference. |
| Configure a CLI, UI or runtime | Write and validate the same JSON, compose the existing library and file store, wire trusted authorization, and invoke explicit reads. |
| Grant individual users access or publish posts | Not implemented by this fragment. An app-only token cannot supply user consent or app login. |

Token issuance is documented in [application-only authentication](https://docs.x.com/fundamentals/authentication/oauth-2-0/application-only).
Do not infer unattended account creation or provider approval from an available
token endpoint.

## Verification boundary

Focused fixtures cover file persistence, ownership, rotation, strict inputs and
responses, paging, errors, cancellation and the guide's actual JSON. Editor
checks cover token references, ownership, setup guidance and reload persistence.
These checks use controlled responses; no live X token, registration, generated
application has been exercised.


## Recent-search display recipe

```js
const results = await connections.invoke({
  context: authenticatedOwner, integrationId: "social",
  operation: "posts.searchRecent",
  input: { query: '("pet grooming" OR #dogs) lang:en -is:retweet', maxResults: 10 }
});
// Join post.author_id to results.includes?.users by id.
// Join post.attachments?.media_keys to results.includes?.media by media_key.
// Keep results.meta.next_token with this exact query for a user-requested next page.
```

This searches the recent seven-day window. Query operators provide author,
language and content filters; operator availability and entitlement are decided
by X. Full-archive search, streaming and explicit time-range parameters are not
implemented. The adapter requests author names/images, post timestamps/entities/
public metrics and media type/URL/preview/alt text. Missing expansions are not
invented. Results with provider errors fail as incomplete rather than silently
rendering a purported complete result.
[Search guide](https://docs.x.com/x-api/posts/search/integrate/overview),
[recent search](https://docs.x.com/x-api/posts/search/quickstart/recent-search).

A native framework uses the same Env token in its server-side HTTP client,
`Authorization: Bearer <value>`, and these fixed API paths/query parameters.
It does not require JSKIT or Vibe64 at runtime. The application owns query
permissions, pagination controls, spend limits, escaping post text, joining
expansions, attribution and links back to the original post. Do not turn returned
media URLs into arbitrary backend downloads or render post text as trusted HTML.
Consult the provider's current display requirements before release; a connector
is not a completed social feed UI.
