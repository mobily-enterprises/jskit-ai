# Twitch

## Delivered fragment

Import `twitchProvider` from `@jskit-ai/connectors-catalog/server/twitch`.
It connects a Twitch user through an own confidential OAuth registration,
validates that grant, reads profiles and channel data, discovers streams,
manages broadcasts, chat, polls, predictions, rewards and schedules, retrieves
analytics and clips, and manages application-owned WebSocket subscriptions.
Shared, individual and assistant ownership use the same application
policy and encrypted file store. This does not implement application login,
app-only tokens, EventSub webhooks or automatic registration.

The configuration form retains 23 permission choices. Its defaults are
`user:read:email` and `user:read:follows`. Broadcast updates additionally require
`channel:manage:broadcast`; public stream/channel discovery needs no extra scope
on the validated user token. Runtime operations are described below; their
checkboxes alone do not prove application-side presentation or event handling.
Request only permissions used by the application; Twitch explicitly requires
this. [Scope rules and definitions](https://dev.twitch.tv/docs/authentication/scopes/).

## Stream discovery and broadcast changes

`streams.list` returns one page of stream data. Inputs are `first` (1–100,
default 20), `after` (opaque cursor), optional `user_id`, `user_login`, `game_id`
or `language`, and `type` (`all` or `live`, default `all`). Each filter currently
accepts one value. Empty results are valid; an offline broadcaster will not
appear as a live stream. Stream lists can change between pages, so the app must
handle duplicate/missing records rather than treating pagination as a snapshot.

`channels.search` takes required `query`, optional `live_only` (default false),
`first` and `after`. `channels.read` takes one `broadcaster_id` and returns channel
information; a missing broadcaster produces an empty list. Neither method grants
the caller authority to edit the channel it discovers.

`broadcast.update` accepts one or more of `title` (nonempty, up to 140 characters),
`game_id` (including `0`/empty to clear), `broadcaster_language`, `tags` (up to ten
alphanumeric tags of 25 characters) or `is_branded_content`. The adapter derives
the target broadcaster from token validation, never from caller input. Missing
or revoked `channel:manage:broadcast` permission prevents the write. A successful
PATCH returns `null` (HTTP 204). The app can read that broadcaster's channel to
show the current values; writes are not retried automatically.

```js
const page = await connections.invoke({ context, integrationId: "twitch",
  operation: "channels.search", input: { query: "grooming", live_only: true } });
await connections.invoke({ context, integrationId: "twitch",
  operation: "broadcast.update", input: { title: "Live grooming demonstration" } });
```

These are native Helix GET `/streams`, `/search/channels`, `/channels` and PATCH
`/channels?broadcaster_id=...` calls. Another framework uses the same OAuth/Env
configuration with its own HTTP client, token validation, permission checks and
JSON serialization. JSKIT validates immediately before each request; validation
requests remain GET even when the following Helix operation is a PATCH.
See the [official API reference](https://dev.twitch.tv/docs/api/reference).

Controlled acceptance: source tests **20/20**, installed-package consumer tests
**20/20**, and expanded, medium and compact editor tests **1/1 each**. These cover
useful operations, authorization failures, portable configuration, inline setup
and the applicable connection lifecycle. The application owns the EventSub socket,
reconnection and event processing described below. Live Twitch interoperability
and generated-app execution were not exercised; no live channel was edited.

## Chat, polls and predictions

All these operations use a validated **user token**. The app supplies the same
project-owned OAuth registration and Env references used above. App-only bot
grants are not implemented. The runtime derives `sender_id` for chat and
`broadcaster_id` for polls/predictions from the validated user, and rejects caller
attempts to override those identities.

| Operation | Input and behavior | Permission |
| --- | --- | --- |
| `chat.send` | `broadcaster_id` identifies the target channel; `message` is 1–500 characters; optional `reply_parent_message_id` replies to a message. | `user:write:chat` |
| `polls.list` | `first` (1–20), `after`, optional one `id`; returns the user's polls with provider pagination. | `channel:read:polls` or `channel:manage:polls` |
| `polls.create` | `title` (1–60), 2–5 `choices: [{title}]` (1–25 each), `duration` (15–1800 seconds). Starts the poll immediately. | `channel:manage:polls` |
| `polls.end` | `id` and `status` (`TERMINATED` or `ARCHIVED`). | `channel:manage:polls` |
| `predictions.list` | `first` (1–20), `after`, optional one `id`; returns the user's predictions. | `channel:read:predictions` or `channel:manage:predictions` |
| `predictions.create` | `title` (1–45), 2–10 `outcomes: [{title}]` (1–25 each), `prediction_window` (30–1800 seconds). Starts immediately. | `channel:manage:predictions` |
| `predictions.end` | `id`, `status` (`LOCKED`, `CANCELED`, `RESOLVED`); `winning_outcome_id` is required only for `RESOLVED`. | `channel:manage:predictions` |

Inspect `chat.send`'s `data[0].is_sent` and `drop_reason`: HTTP success can report
that moderation dropped or held the message. Do not show it as delivered merely
because the request succeeded. The app authorizes channel destinations, reply
targets and content before invoking the connector. Twitch enforces its own chat
permissions and moderation rules.

The application owns poll/prediction presentation and explicit refresh, including
tracking the returned IDs and outcome IDs. Polls and predictions have account
eligibility and concurrent-activity limits; the application should surface
rejection rather than retry creation. Resolving a prediction determines the
Channel Points outcome, so require the application's deliberate broadcaster
action. The adapter currently creates free-vote polls; paid Channel Points poll
options are not yet supplied. Neither workflow is an application billing system.

Native frameworks make the corresponding Helix GET/POST/PATCH `/polls` or
`/predictions` requests and POST `/chat/messages` using JSON bodies. Reads carry
the authenticated broadcaster as a query parameter; writes carry it in JSON.
Use the same token validation and permission checks as the Node implementation.
[Poll guide](https://dev.twitch.tv/docs/api/polls),
[prediction guide](https://dev.twitch.tv/docs/api/predictions),
[Helix reference](https://dev.twitch.tv/docs/api/reference).

## Channel and moderation reads

### Event subscriptions

`events.subscribe` takes `type` and the application-owned WebSocket `session_id`.
Supported events are stream online/offline, channel update/subscribe/cheer,
poll begin/progress/end, prediction begin/progress/lock/end, and reward redemption
add/update. The adapter chooses the version and derives the broadcaster from
the validated user; permission checks precede subscription creation.
`events.list` accepts optional `type` and `after`. `events.delete` takes `id`.
Applications must retain and authorize their own session/subscription IDs.

The backend opens `wss://eventsub.wss.twitch.tv/ws` using its framework's
WebSocket client, receives `session_welcome`, and passes that session ID to
`events.subscribe` within Twitch's welcome deadline (normally ten seconds).
Native frameworks POST the subscription to `/helix/eventsub/subscriptions`
using the same user grant and `{ method: "websocket", session_id }` transport.
List/delete use GET/DELETE on that path. This path has no HTTP callback or
webhook signature; TLS authenticates the socket's server. Webhook transport
requires separate app-token authentication and is not implemented.

The application owns keepalive deadlines, reconnect messages, re-subscription
after connection loss, subscription revocations, and deduplication by message
ID. Never treat the request response as proof that an event handler ran.
Import `parseTwitchEventSubMessage` from the same server module. Pass a text frame
and trusted `{ broadcasterId, sessionId, subscriptionIds }`. It rejects oversized
frames (over 1 MiB), malformed envelopes, unexpected notification ownership and
reconnect URLs outside Twitch's secure EventSub host. It preserves the event and
message ID. It does not cryptographically authenticate arbitrary input: call it
only on frames received from the application's trusted Twitch socket.

```js
import { parseTwitchEventSubMessage } from "@jskit-ai/connectors-catalog/server/twitch";
// Inside the app's socket handler; these identities come from its connection state.
const message = parseTwitchEventSubMessage(frameText, {
  broadcasterId, sessionId, subscriptionIds
});
if (message.metadata.message_type === "notification") {
  // Process once under the app's durable event-ID/idempotency policy.
  await processEventOnce(message.metadata.message_id, message.payload.event);
}
```

`processEventOnce` above is application code, not a JSKIT API. On welcome, save
the new session ID and subscribe within the advertised timeout. Refresh the
silence deadline on received messages. On reconnect, open the validated URL
unchanged and switch after the new welcome; preserve the transferred
subscriptions. After an ordinary connection loss, create a fresh session and
re-subscribe. On revocation, remove the affected subscription and surface its
reason. Close sockets and cancel timers when the app stops maintaining a
connection. Native WebSocket libraries handle protocol ping/pong; do not send
application messages to this socket.

Controlled parser fixtures cover useful notification payloads, revocation,
welcome, reconnect and owner/session/subscription rejection. A live socket or a
generated application's complete socket lifecycle has not been exercised.
See [EventSub management](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/)
and [WebSocket handling](https://dev.twitch.tv/docs/eventsub/handling-websocket-events).

### Streaming schedule

`schedule.get` requires `broadcaster_id`; optional `id`, UTC `start_time`, `first`
(1–25) and `after` select segments. The result retains pagination and vacation
metadata. Twitch can return 404 when no schedule exists.

`schedule.create` requires UTC `start_time`, IANA `timezone`, integer `duration`
(30–1380 minutes) and explicit `is_recurring`. Optional `title` and `category_id`
describe the stream. `schedule.update` requires segment `id` and at least one
change to those fields (except recurrence), or `is_canceled`.
`schedule.delete` requires segment `id`. Writes require
`channel:manage:schedule` and derive broadcaster identity from the user token.

Native frameworks read GET `/helix/schedule` and write POST/PATCH/DELETE
`/helix/schedule/segment`, putting broadcaster/segment IDs in query parameters
and changes in JSON. The app owns calendar presentation and deliberate changes:
editing recurring details affects the series, deleting removes the series, and
cancellation targets the next occurrence. Twitch controls account eligibility.
iCalendar export is not provided. `schedule.vacation` takes required
`is_vacation_enabled`. Enabling it also requires UTC `vacation_start_time`,
`vacation_end_time` (strictly later), and IANA `timezone`. Disabling needs only
`is_vacation_enabled: false`. Native frameworks PATCH `/helix/schedule/settings`
with these values and the authenticated broadcaster in query parameters;
success returns no content. This follows the API reference's query contract,
despite the tutorial describing a body. See the
[schedule guide](https://dev.twitch.tv/docs/api/schedule).

### Channel Points rewards

`rewards.list` accepts optional `id` and `only_manageable_rewards` (default false).
`rewards.create` requires `title` (1–45) and positive integer `cost`; optional
`prompt` (up to 200), `is_enabled`, `is_user_input_required`, `background_color`
(`#RRGGBB`) and `should_redemptions_skip_request_queue` configure the reward.
`rewards.update` requires `id` plus at least one change, supports those fields
and `is_paused`. `rewards.delete` requires `id` and returns `null` on success.
Both create and update accept `is_max_per_stream_enabled`/`max_per_stream`,
`is_max_per_user_per_stream_enabled`/`max_per_user_per_stream`, and
`is_global_cooldown_enabled`/`global_cooldown_seconds`. When enabling a limit,
provide its positive integer amount in the same call. Cooldown is bounded to
604800 seconds; Twitch only displays cooldowns of at least 60 seconds in its UI.
Setting an enable flag to false disables that limit without requiring an amount.

`redemptions.list` requires `reward_id`, with optional redemption `id`, `status`
(default `UNFULFILLED`), `sort` (`OLDEST`/`NEWEST`), `first` (1–50), and `after`.
`redemptions.update` requires `reward_id`, redemption `id` and `status`
(`FULFILLED` or `CANCELED`). Cancelling refunds Twitch Channel Points. The app
must authorize this decision and complete its own promised work before marking
fulfilment. No action is automatically retried.

Reads accept `channel:read:redemptions` or `channel:manage:redemptions`; writes
require the latter. Broadcaster identity always comes from token validation.
Native frameworks use `/helix/channel_points/custom_rewards` and its
`/redemptions` subpath: identities belong in query parameters, mutable fields in
JSON. Twitch restricts management/redemption access to the creating application
and eligible broadcasters. Switching OAuth registrations does not transfer that
ownership. See [Channel Points API](https://dev.twitch.tv/docs/api/reference/#create-custom-rewards).
The connector does not create a separate app credit balance or rewards dashboard.

`clips.create` accepts a required `broadcaster_id` and requires `clips:edit`.
It returns a clip ID and Twitch edit URL. The app authorizes the target channel;
Twitch enforces live-stream availability and clipping permissions. Creation uses
POST `/helix/clips` with the broadcaster in the query, without a JSON body.
`clips.get` accepts one required `id` and uses GET `/helix/clips`; an empty list
means the clip is not currently available. The application polls explicitly and
must not repeat creation just because lookup is empty.

Use a bounded 60-second lookup window, following the current
[API reference](https://dev.twitch.tv/docs/api/reference/#create-clip), which
differs from the tutorial's older 15-second guidance. The adapter starts no
timer. Twitch's returned edit URL handles editing; the app owns presentation.
This fragment uses default clip duration/title and does not create VOD clips,
download videos, or provide a video editor.

`analytics.extensions` and `analytics.games` return CSV report links using
`analytics:read:extensions` and `analytics:read:games`. They accept optional
`extension_id` or `game_id`, `first`, `after`, and `type: "overview_v2"`.
Supply both `started_at` and `ended_at` as real midnight UTC dates
(`YYYY-MM-DDT00:00:00Z`), or omit both. End must not precede start.
Twitch controls report availability and the effective date range. An empty
report list is valid.

Another framework calls GET `/helix/analytics/extensions` or `/helix/analytics/games`
with these query fields and its validated user grant. Reports belong to the
consenting owner's games/extensions. The adapter returns HTTPS report links;
it does not fetch them or forward Twitch credentials to the report host.
Applications must authorize report access, avoid logging signed URLs, and own
CSV download/parsing and presentation. See the
[analytics API reference](https://dev.twitch.tv/docs/api/reference/#get-extension-analytics).

`bits.leaderboard` reads the authenticated broadcaster's Bits ranking using
`bits:read`. Inputs are `count` (1–100, default 10), `period` (`day`, `week`,
`month`, `year`, or default `all`), optional RFC3339 `started_at`, and optional
`user_id` to select that user's position and surrounding ranks. Twitch determines
the reporting window; retain its returned `date_range`, ranks, scores and total.
The user filter does not change which broadcaster owns the leaderboard.
Other frameworks use GET `/helix/bits/leaderboard` with these query fields and
the same authenticated user token. The application renders the ranking; this
does not purchase Bits or create an application credit balance.
See [Get Bits Leaderboard](https://dev.twitch.tv/docs/api/reference/#get-bits-leaderboard).

These operations return provider records without building a subscriber or
moderation dashboard. The application must authorize access before invocation.
Paginated operations accept `first` (1–100, default 20) and opaque `after`;
the application passes the returned cursor explicitly to fetch another page.

| Operation | Input and identity | Permission |
| --- | --- | --- |
| `subscriptions.list` | Pagination and optional `user_id` filter; broadcaster is the validated account. | `channel:read:subscriptions` |
| `subscriptions.check` | Required target `broadcaster_id`; subscriber is the validated account. | `user:read:subscriptions` |
| `vips.list` | Pagination and optional `user_id`; broadcaster is the validated account. | `channel:read:vips` |
| `editors.list` | No input; broadcaster is the validated account. | `channel:read:editors` |
| `bannedUsers.list` | Pagination and optional `user_id`; broadcaster is the validated account. | `moderation:read` |
| `moderators.list` | Pagination and optional `user_id`; broadcaster is the validated account. | `moderation:read` |
| `followers.list` | Pagination, optional `user_id` and `broadcaster_id` (defaults to the validated account). Twitch enforces access to another broadcaster's followers. | `moderator:read:followers` |
| `chatters.list` | Pagination and required target `broadcaster_id`; moderator identity is the validated account. | `moderator:read:chatters` |
| `hypeTrain.status` | No input; broadcaster is the validated account. `current: null` means no active Hype Train. | `channel:read:hype_train` |

The native Helix paths are respectively `/subscriptions`, `/subscriptions/user`,
`/channels/vips`, `/channels/editors`, `/moderation/banned`,
`/moderation/moderators`, `/channels/followers`, `/chat/chatters` and
`/hypetrain/status`. Other frameworks use GET with the same validated identities
and scope checks. User filters never replace the authenticated identity.
Subscription checks preserve provider errors: a not-subscribed 404 is not a
successful subscription record. The application decides how to present it.

Hype Train status replaces the retired Get Hype Train Events endpoint; it is
not an event-history feed. See the [API reference](https://dev.twitch.tv/docs/api/reference)
and [Twitch product lifecycle](https://dev.twitch.tv/docs/product-lifecycle/).
Controlled tests cover all nine reads, account binding, rejected identity
overrides, pagination records and malformed responses. Live eligibility and
moderator access have not been exercised.

## Create the provider registration

1. Sign in with the Twitch account that will own the application. Verify its
   email and enable two-factor authentication under **Settings → Security and
   Privacy**, then refresh the developer console if necessary.
2. Open the [developer console](https://dev.twitch.tv/console), choose
   **Applications**, then **Register Your Application**.
3. Enter a unique application **Name**. In **OAuth Redirect URLs**, enter the
   exact HTTPS callback served by your backend and choose **Add**. Choose the
   application's **Category**, complete the displayed human verification and
   choose **Create**. This backend fragment uses a **Confidential** client;
   public/native client behavior is outside its scope.
4. Find the application under **Developer Applications** and choose **Manage**.
   Copy **Client ID** into the registration configuration. Choose **New Secret**
   and store it outside source as the environment value referenced by
   `clientSecretRef`. Generating another secret invalidates the previous one;
   coordinate rotation with the application's operator.
5. Set the callback environment value to the same complete redirect URL.
   Configure the server's callback route before starting consent. Each consent
   attempt must return to its initiating authenticated owner.

These navigation steps follow Twitch's
[registration instructions](https://dev.twitch.tv/docs/authentication/register-app/).
The confidential/public distinction is described in its
[refresh documentation](https://dev.twitch.tv/docs/authentication/refresh-tokens/).
A CLI uses these same packages and a callback served by its own backend/listener
at a provider-accepted, registered URL. No Vibe64 account is required. Do not
embed a confidential client secret into a distributed desktop binary.

## Portable configuration and library composition

Save this as `integrations.json`, replacing the public Client ID placeholder.
The editor reads and writes this same file. Each application user consents to
their own account when `accountMode` is `per-user`.

```json
{
  "schemaVersion": 1,
  "integrations": {
    "twitch": {
      "provider": "twitch",
      "displayName": "My Twitch",
      "accountMode": "per-user",
      "scopes": ["user:read:email", "user:read:follows"],
      "authentication": { "method": "oauth2", "registrationRef": "twitch" }
    }
  },
  "registrations": {
    "twitch": {
      "source": "own",
      "clientId": "replace-with-your-client-id",
      "clientSecretRef": "env:TWITCH_CLIENT_SECRET",
      "callbackUrlRef": "env:TWITCH_CALLBACK_URL"
    }
  }
}
```

Use the [OAuth file-connection pattern](../patterns/oauth-connection/PATTERN.md)
with `twitchProvider` in its provider array. It supplies the imports, parsing,
reference resolution, encrypted file storage and `createConnectionService`
composition for ordinary Node code, a JSKIT Feature or a manually wired CLI.
Keep the runtime files outside exported source and retain the encryption key
across restarts. A database is not required.

The existing host policy derives `applicationId` and `subjectId` from its trusted
session or operator context. Shared accounts require membership checks before
mapping to a stable shared subject. Never take either owner ID from public
request parameters. `beginAuthorization` creates the consent URL;
`completeAuthorization` exchanges its callback and verifies the user token.
Saving JSON alone does neither. Cancellation consumes the pending attempt;
`disconnect` removes local access without revoking unrelated provider grants.

## Operations and token lifecycle

| Operation | Input | Behavior |
|---|---|---|
| `token.validate` | None | Verifies a user token, client ID, expiry and scope response at Twitch's validation endpoint |
| `profile.read` | None | Reads the consenting user's profile; this fragment requires `user:read:email` |
| `channels.followed` | Optional `first` (integer 1–100, default 20), `after` (opaque cursor), `broadcaster_id` (numeric string) | Reads one page for the validated token's user with `user:read:follows` |

All data operations validate the token immediately before querying Helix and
send the matching Client-ID header. The runtime derives the followed-channel
`user_id` from validation; callers cannot substitute another user, API URL or
raw token. A profile must match that same user. An empty page is valid; the
caller can pass `pagination.cursor` as `after` to request another page. No
automatic paging or request replay occurs. These contracts follow
[Get Users](https://dev.twitch.tv/docs/api/reference/#get-users) and
[Get Followed Channels](https://dev.twitch.tv/docs/api/reference/#get-followed-channels).

Twitch requires validation at startup and at least hourly while maintaining
OAuth sessions, including idle sessions. Invoke `token.validate` from the host's
startup and scheduled-job paths for each maintained connection. Validating only
when a person clicks is insufficient. The package exposes the operation but
starts no background scheduler and does not enumerate the host's users.
[Validation requirements](https://dev.twitch.tv/docs/authentication/validate-tokens/).

The shared runtime refreshes expiring tokens before an invocation, under its
connection lock, and persists rotated credentials before a subsequent data
request. The adapter handles Twitch's array and string scope replies. Verified
scope reductions cannot be restored by refresh. A revoked token, mismatched
client or missing operation scope fails before the data request and requires
reconnection; a Helix 401 likewise requires reconnection without replay. This
fragment does not implement Twitch's recommended reactive refresh on 401.
[Refresh behavior](https://dev.twitch.tv/docs/authentication/refresh-tokens/).

## Online, public editor and automation

Twitch requires a distinct client ID for each application. Each generated app
owns its registration, whether created with a hosted editor, installed editor or
CLI. Client separation does not prove isolation from every account or service
limit. [Application registration restriction](https://dev.twitch.tv/docs/authentication/register-app/).

Register the application's own callback route, using its assigned public origin
as the starting point, and keep that exact URL in application Env. When it
changes, update both the app binding and the provider registration. The
[callback contract](../../connectors-core/docs/oauth-callbacks.md) describes
identity, consent and grant handling during a move. No Vibe64 callback gateway
participates in this flow.

The documented registration path is the console. No supported application
creation API was established in this review. An AI can prepare the JSON,
environment references, callback wiring and validation job. The owner handles
account verification, human verification, registration and consent; automation
must not invent a registration endpoint or bypass those steps. For Online,
operator-managed credential storage can simplify wiring after the app-specific
registration exists, but this fragment does not provision that service.

Twenty controlled runtime tests cover consent formats and replay, encrypted file
restart, refresh rotation, owner/client isolation, validation, bounded paging,
malformed responses, provider failures and interruption. Public-editor tests
cover the configuration form. No live registration, user data, consent or
sample application is part of this proof.
