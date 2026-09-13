# TikTok

Import `tiktokProvider` from `@jskit-ai/connectors-catalog/server/tiktok`.
The library reads the consenting creator's profile, statistics and public video
metadata. CLI and server consumers use the same configuration and connection
service; Vibe64 edits that file through shared fields and validation.

## Provider setup

1. At [TikTok for Developers](https://developers.tiktok.com/), sign in, open
   your profile menu, choose **Manage apps**, then **Connect an app**.
   Select the owning organization/account and confirm.
2. Complete the app's identity, icon, description and website under its details.
   Select Web. In the products section add Login Kit and Display API.
3. In Login Kit's Web settings enter the backend callback described below.
   Copy the **Client key**, not the separate App ID, and store the client secret
   in the backend environment.
4. Before production submission, verify your configured website/policy URLs
   through URL properties. Complete the review explanation and demo, save,
   then submit the application-owned registration. [Registration and review](https://developers.tiktok.com/docs/en/getting-started-create-an-app).
5. In **Scopes**, add `user.info.basic`, `user.info.profile`, `user.info.stats`
   and `video.list` as needed. Basic access verifies the account; users may
   decline the others. The runtime blocks an operation lacking its granted
   permission. [Scope selection](https://developers.tiktok.com/docs/en/scopes-overview).
6. Start in Sandbox with designated test accounts. Production availability
   requires approval for the actual products and use case.
   [Display API prerequisites](https://developers.tiktok.com/docs/en/display-api-get-started).
7. Set `TIKTOK_CLIENT_SECRET` and `TIKTOK_CALLBACK_URL` on the callback-owning
   backend. Save their references in JSON. Saving configuration does not start
   consent or prove provider approval.

For a Web registration, the callback must be an exact static HTTPS URI, shorter
than 512 characters, without a query or fragment. HTTP loopback callbacks are
not accepted by this adapter. The authorize URL uses `client_key` and comma
separated permissions. An operator CLI can invoke the same library through an
HTTPS callback-owning backend; this fragment does not implement TikTok's
separate native Desktop journey. Keep the confidential secret off distributed
clients. The shared runtime sends PKCE parameters, but TikTok's Web guide does
not establish enforcement of them. [Web flow](https://developers.tiktok.com/doc/login-kit-web/),
[Desktop flow](https://developers.tiktok.com/docs/en/login-kit-desktop).

```json
{
  "schemaVersion": 1,
  "registrations": {
    "creator-app": {
      "source": "own",
      "clientId": "YOUR_TIKTOK_CLIENT_KEY",
      "clientSecretRef": "env:TIKTOK_CLIENT_SECRET",
      "callbackUrlRef": "env:TIKTOK_CALLBACK_URL"
    }
  },
  "integrations": {
    "creator": {
      "provider": "tiktok",
      "displayName": "Creator account",
      "accountMode": "per-user",
      "scopes": ["user.info.basic", "user.info.stats", "user.info.profile", "video.list"],
      "authentication": { "method": "oauth2", "registrationRef": "creator-app" }
    }
  }
}
```

## Runtime composition

Use the packaged [OAuth connection pattern](../patterns/oauth-connection/PATTERN.md) to construct `connections` from
this provider, parsed JSON, host authorization, reference resolution and the
encrypted file store. Pass `tiktokProvider` to both configuration validation and
the connection service. No copied application template or database is required.

```js
const pending = await connections.beginAuthorization({
  context: authenticatedOwner, integrationId: "creator"
});
// Open pending.authorizationUrl in the user's browser.
// In the registered backend callback, recover the same trusted owner:
await connections.completeAuthorization({
  context: authenticatedOwner, integrationId: "creator", callbackUrl
});
const page = await connections.invoke({
  context: authenticatedOwner, integrationId: "creator",
  operation: "videos.list", input: { max_count: 10 }
});
// If page.data.has_more, explicitly request its data.cursor on a later call.
```

The host derives ownership from an authenticated session or trusted CLI operator.
It must not accept application or subject identities from arbitrary browser
input. Shared and assistant modes require the host to authorize every caller
before mapping to the shared subject. A builder's connected account does not
become all app users' individual accounts.

| Operation | Permission | Input and result |
|---|---|---|
| `profile.read` (verification) | `user.info.basic` | No input; `open_id`, `display_name`, `avatar_url` |
| `profile.extended` | `user.info.profile` | No input; username, bio, profile link and verification flag |
| `profile.stats` | `user.info.stats` | No input; follower, following, like and video counts |
| `videos.list` | `video.list` | `max_count` 1–20, default 10; optional nonnegative safe-integer `cursor`; one public video page with IDs, titles and cover URLs |

Profile operations use GET `/v2/user/info/`; video pages use POST
`/v2/video/list/`, both on `https://open.tiktokapis.com`. Each operation selects
only its own fields and returns the validated original envelope. Keep video
IDs as strings. Pagination cursors are millisecond timestamps; preserve them
with their connection/query rather than automatically crawling every page.
[Profile fields](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info),
[video pagination](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list).

The service verifies basic profile access before saving tokens. It encrypts
credentials outside source, binds attempts to their owner and consumes each
attempt once. Initial grants are bounded by configured scopes; refresh can
shrink existing permissions but cannot expand them. Rotated refresh tokens
replace previous ones. TikTok's `refresh_expires_in` is validated but not stored
as a proactive expiry cutoff in this initial implementation; provider rejection
requires reconnection. Local disconnect deletes local access only. Provider
revocation is a separate action, currently unwired.
[Token exchange, refresh and revocation](https://developers.tiktok.com/docs/en/oauth-user-access-token-management).

Provider error codes distinguish revoked/expired access from missing scopes,
including TikTok's scope error that uses HTTP 401. Permission failures preserve
the connection; invalid access marks it for reconnect. Rate-limit failures are
reported without automatic retries. Cancellation, timeout and malformed data
are explicit errors, and provider message/log text is omitted.
[API errors](https://developers.tiktok.com/docs/en/tiktok-api-v2-error-handling),
[OAuth errors](https://developers.tiktok.com/docs/en/oauth-error-handling).

## Creator gallery in an application

A useful first screen is a creator header and a paged list of public video
cards. The application's authenticated backend calls `profile.read` and
`videos.list`; it sends those results to that same authorized viewer, never the
connection record or tokens. For example, after the OAuth pattern has provided
`connections` and the host has derived `authenticatedOwner`:

```js
const request = { context: authenticatedOwner, integrationId: "creator" };
const creator = await connections.invoke({ ...request, operation: "profile.read" });
const videos = await connections.invoke({ ...request, operation: "videos.list",
  input: { max_count: 10, ...(cursor === undefined ? {} : { cursor }) } });
const gallery = {
  name: creator.data.user.display_name,
  avatarUrl: creator.data.user.avatar_url,
  videos: videos.data.videos,
  nextCursor: videos.data.has_more ? videos.data.cursor : null
};
// Return gallery through the framework's authenticated JSON response.
```

The frontend renders `name` and each video `title` as escaped text, uses HTTPS
image URLs for the avatar and covers, and offers **Load more** only when
`nextCursor !== null`. Append the next page with duplicate IDs removed. Keep the
cursor in the current account's gallery state; clear displayed data on account
switch or disconnect. Show an empty state for an account with no public videos.
When `video.list` was declined, keep the profile visible and offer reconnection
with that permission instead of presenting a broken gallery. A thumbnail can
expire or disappear: show an image fallback and refresh metadata on the next
explicit load. Do not permanently copy the media or interpret titles as HTML.

This composition shows metadata cards. It does not provide playback, posting,
downloads or a persistent mirror of the account. A removed/private video may
vanish between pages; do not assume the feed is an immutable snapshot.
[Public-video listing](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-list).

A Node app or CLI consumes the same installed JSKIT exports and file without
Vibe64. A different framework owns its OAuth/token storage and native HTTP calls:
read the same registration references and ownership/scopes, call GET
`/v2/user/info/` and JSON POST `/v2/video/list/`, then build the same gallery
response. It must retain the provider-specific `client_key`, comma scopes and
refresh-token rules described above. JSKIT supplies no PHP implementation.

## Online, public and custom domains

Each application owns its provider registration, callback route, credentials
and grants. Hosted and installed editors configure the same app-owned setup;
neither supplies a shared Vibe64 registration or token gateway. Use the app's
assigned public URL as the initial callback origin, append the route the backend
actually implements, and register the exact URL with the provider. Keep the
client secret and callback binding in the application's Env.

A custom-domain or hosting move that changes the callback requires updating both
the provider registration and the app's Env. Preserve the application's identity
and private connection store, validate callback state and initiator, and allow
only application-approved return destinations. The editor's address is not the
provider callback. See the [callback contract](../../connectors-core/docs/oauth-callbacks.md)
and [setup command](../../connectors-core/docs/setup-command.md).

Separate registrations do not prove separate quota pools or provider approval.
The app developer must obtain approval for the actual integration and user flow.

## Automation assessment and limits

| Task | What can be automated |
|---|---|
| Create/configure the application registration | Reviewed documentation establishes console setup, not a general provisioning API. AI can guide an authorized operator and prepare configuration; registration/review approval is external work. |
| Configure callbacks and permissions | Prepare exact values and validate the file. Console setup and ownership verification remain operator steps until an authorized automation route is established. |
| Consent, refresh and reads | The library implements these exchanges once a valid registration and user consent exist. It cannot grant consent for the user. |
| Application login, posting, Research API | Outside this fragment. A successful data connection alone does not implement the app's login/session system. |

The initial fragment is tested with controlled token/API responses and the editor
configuration UI. No live TikTok registration, production approval, provider
consent or generated application has been exercised.
