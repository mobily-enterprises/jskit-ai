# Slack

## Delivered connector

Import `slackProvider` from `@jskit-ai/connectors-catalog/server/slack`.
It completes an own-registration OAuth flow as either the connecting person or
an installed bot, then reads channel lists, message history and user profiles, and posts text messages. The
shared library owns consent, token selection, refresh, operation validation and
encrypted file persistence. Application code supplies authenticated ownership,
reference resolution and callback routes. No database is required.

The configuration form retains the captured 57 distinct permissions: 52 apply to
users and 49 to bots. Its initial selection is `channels:read` and
`channels:history`; only `channels:read` is needed for the implemented connection
check. Keep history when using channels.history; deselect it for list-only applications. Saving another permission does not
implement its operation. Switching actor removes incompatible permissions and
preserves compatible selections; switching back does not restore removed ones.

`settings.actor` and `accountMode` answer different questions. Actor selects the
Slack identity, while account mode controls ownership in the application. An
individually owned bot connection still acts as the installed workspace bot;
it does not become a personal Slack account. Host membership checks remain
necessary before exposing a shared connection. This adapter implements neither
application login nor workspace-member administration.

## Manual provider setup

1. Open [Your Apps](https://api.slack.com/apps), select **Create New App**, then
   **From scratch**. Enter an **App Name**, select the **Development Workspace**,
   and create it. Use an account authorized to manage that workspace's apps.
2. Open **OAuth & Permissions**. Under **Redirect URLs**, choose **Add New Redirect
   URL**, enter the backend's complete HTTPS callback, and save the URLs. A plain
   HTTP localhost callback is not accepted by Slack. A CLI can use its own HTTPS
   backend or an HTTPS development tunnel; the editor is not required.
3. Under **Scopes**, add `channels:read` in **User Token Scopes** for a connected
   user or **Bot Token Scopes** for an installed bot. Add the other read scopes
   from the operation table only when needed. Configure a bot identity under
   **App Home** if the dashboard requests it for a bot installation.
4. In **Basic Information → App Credentials**, copy **Client ID** into the
   registration. Keep **Client Secret** outside source, under the referenced
   environment variable. Supply the same callback URL through its reference.

See Slack's [OAuth installation guide](https://docs.slack.dev/authentication/installing-with-oauth/)
and [app credential details](https://docs.slack.dev/authentication/using-token-rotation/).

5. For new rotating grants, enable token rotation under **OAuth & Permissions**
   before installation. Published apps use **Published App Settings**. Slack
   makes this setting irreversible. The fragment supports both rotating and
   non-rotating new grants; converting an existing long-lived grant with
   `oauth.v2.exchange` is not implemented.
   [Rotation setup](https://docs.slack.dev/authentication/using-token-rotation/).
6. To install outside the development workspace, open **Manage Distribution →
   Share Your App with Other Workspaces**, complete the displayed checklist,
   then choose **Activate Public Distribution**. Slack directs commercially
   distributed apps through Marketplace review. Workspace administrators can
   require approval or restrict installation to listed apps.
   [Distribution and approval](https://docs.slack.dev/app-management/distribution/).
7. Save the application configuration below, start its separate consent flow,
   choose a workspace, and approve the requested permissions. Saving a form
   alone does not install anything or report a connected account.

## Portable configuration

The same `integrations.json` is usable by CLI code and Vibe64's form. Replace
the Client ID placeholder and supply the two referenced environment values.
No client secret, access token or refresh token belongs in this file.

```json
{
  "schemaVersion": 1,
  "integrations": {
    "slack": {
      "provider": "slack",
      "displayName": "Team Slack",
      "accountMode": "per-user",
      "settings": { "actor": "user" },
      "scopes": ["channels:read"],
      "authentication": { "method": "oauth2", "registrationRef": "slack" }
    }
  },
  "registrations": {
    "slack": {
      "source": "own",
      "clientId": "replace-with-your-client-id",
      "clientSecretRef": "env:SLACK_CLIENT_SECRET",
      "callbackUrlRef": "env:SLACK_CALLBACK_URL"
    }
  }
}
```

Set `actor` to `bot` for installation as a bot. Use `shared` only when the host's
policy maps authorized workspace members to the intended shared subject.
`assistant` ownership is also available; it does not bypass application policy.
The [OAuth connection pattern](../patterns/oauth-connection/PATTERN.md) shows
parsing, service composition, encrypted file storage and callback handling.
Use `slackProvider` in its provider array. Keep runtime state outside exported
source and retain its encryption key across restarts.

## Operations and errors

| Operation | Required permission | Result |
|---|---|---|
| `auth.test` | No additional scope | Connected Slack team and user identity |
| `channels.list` | `channels:read` | Public-channel metadata; also the connection check |
| `groups.list` | `groups:read` | Private-channel metadata visible to this identity |
| `directMessages.list` | `im:read` | Direct-message conversation metadata |
| `groupMessages.list` | `mpim:read` | Group direct-message conversation metadata |

Every list accepts optional `limit` (integer 1–200, default 100), `cursor`
(opaque nonempty string) and `exclude_archived` (boolean, default false).
It returns one provider page. Pass `response_metadata.next_cursor` to continue,
including after an empty filtered page. No automatic paging occurs. Callers
cannot supply `types`, `team_id`, another API origin or a raw token. This is a
workspace-installation fragment; organization-wide installation needs additional
team-selection handling. [Conversation lists](https://docs.slack.dev/reference/methods/conversations.list/),
[identity check](https://docs.slack.dev/reference/methods/auth.test/).

Consent uses `user_scope` for the person and `scope` for the bot. Code exchange
selects only the requested identity; it cannot silently substitute the other
token in a response containing both. Refresh validates the same identity.
Slack's `ok:false` bodies are failures even with HTTP 200. The adapter maps
revocation, missing permissions, rate limits and malformed replies into bounded
errors without exposing provider bodies. [OAuth token response contract](https://docs.slack.dev/reference/methods/oauth.v2.access/).

The shared service refreshes expiring grants before data requests, serializes
refresh under the connection lock, and stores new credentials before reuse.
It starts no background scheduler. Non-expiring grants do not invent an expiry.
Actor or registration changes invalidate existing attempts and connections.
Cancelled attempts cannot be completed later. Disconnect removes local access;
it does not uninstall the Slack app or revoke every grant in that workspace.

Socket mode, slash commands, organization-wide
installs, GovSlack and Sign in with Slack are outside this initial fragment.

## Online, public editor and automation

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

Provider distribution approval and workspace administrator decisions apply to
the actual application. Separate app registrations cannot bypass them.

Slack generally meters Web API traffic by method, workspace and app. Callers sharing one registration and Slack workspace share its method allowance. Message delivery and other features have additional limits.
Application scheduling should respect those actual keys and
`Retry-After`; this fragment reports throttling without replay or a scheduler.
Commercial non-Marketplace history/reply access has additional restrictions, so
future message-reading work must use the then-current method limits.
[Rate-limit ownership](https://docs.slack.dev/apis/web-api/rate-limits/).

**API-assisted registration is possible after operator authorization.** On
**Your Apps**, locate **Your App Configuration Tokens → Generate Token**. This
credential is bound to an operator and development workspace, not one app. Keep
it in the provisioning service; never give it to customer apps. It expires after
12 hours and has its own `tooling.tokens.rotate` flow, separate from the runtime
OAuth refresh implemented here. [Manifest API credentials](https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests/).

An AI-assisted provisioning tool can prepare each app manifest, validate it
through `apps.manifest.validate`, create it with `apps.manifest.create`, and
update it with `apps.manifest.update`. The manifest holds the display name,
redirect URLs, user/bot scopes and desired rotation setting. Create each product
registration separately and record the returned `app_id`, `credentials.client_id`
and secret through protected operator storage. Check `ok` and validation errors
before marking provisioning complete. The create response contains secrets and
must not be logged or copied into a project JSON file.
[Creation API](https://docs.slack.dev/reference/methods/apps.manifest.create/).

The operator still supplies ownership, distribution information, approval and
consent. This package documents that automation path; it does not ship or run a
registration provisioner. For a manual manifest path, select **Create New App →
From a manifest**, select the workspace, paste JSON/YAML, review and create.
[Manifest UI](https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests/).

## Verification boundary

Controlled local tests exercise both identities, encrypted file restart,
rotating and non-rotating grants, scope restrictions, cancellation, actor changes,
bounded paging, HTTP-200 failures, malformed responses and interruption. Shared
form tests and Vibe64 browser tests cover conditional scopes and file round trips.
No live Slack registration, provider consent, customer data or generated app is
part of this proof. Current controlled source and installed-package suites each pass 17/17.
Current-source compact and expanded editor cases pass separately, including
actor/scope persistence, signing-secret reference, inline guidance, per-user
connection instructions and shared connect/cancel/disconnect controls. Registration
provisioning remains an operator action; editor coding-assistant attachment is
deferred.


## Message operations

- `channels.history`, `groups.history`, `directMessages.history` and
  `groupMessages.history` take `channel`, optional `cursor`, `oldest`, `latest`
  and `inclusive`. Each requires its matching `*:history` scope. A request reads
  one page, at most 15 entries; callers explicitly request subsequent pages.
  This bound accommodates the restricted commercially distributed app allowance.
  Slack still enforces actual channel membership and method rate limits.
- `users.info({ user })` requires `users:read`. It returns a profile; email needs
  an additional provider permission and is not promised by this operation.
- `messages.send({ channel, text, thread_ts? })` requires `chat:write` and posts
  as the connected actor. Text is bounded to 4,000 characters; link/media unfurls
  default off. A thread timestamp is optional. No automatic mutation retry occurs:
  after an uncertain response, inspect the conversation before retrying.

In **OAuth & Permissions**, add the corresponding scope under the selected
user or bot token section, update project configuration and reconnect. Invite
bots to the intended channel. Application code must authorize which local users
can invoke a shared grant before calling these operations. This does not add
Sign in with Slack or automatically expose all workspace messages.

Method references: [history](https://docs.slack.dev/reference/methods/conversations.history/),
[posting](https://docs.slack.dev/reference/methods/chat.postMessage/),
[user profiles](https://docs.slack.dev/reference/methods/users.info/).
These operations use the same application-owned connection as channel discovery.


## Incoming events and interactions

Set optional `settings.signingSecretRef` to `env:SLACK_SIGNING_SECRET`; supply the
value from **Basic Information → App Credentials → Signing Secret** in the app
Env. This is a separate credential from the OAuth client secret. Implement an
HTTPS application event route, then enable **Event Subscriptions**, set its
**Request URL**, subscribe to needed bot/user events and reinstall when scopes
change. For buttons/views, enable **Interactivity & Shortcuts** and supply an
application interaction route. These are not OAuth redirect URLs.

Import `verifySlackRequest` from the same provider export. Pass `rawBody` as
unmodified bytes before JSON/form parsing, `signature` from `X-Slack-Signature`,
`timestamp` from `X-Slack-Request-Timestamp`, `contentType`, resolved `secret`,
and the installation's expected `appId` and `teamId`. Header lookup must be
case-insensitive. The verifier enforces Slack's five-minute timestamp window,
HMAC signature and installation identity, then returns the authenticated JSON
or form-encoded interaction payload. It supports event callbacks, URL challenge,
block actions, view submission/close and shortcuts/message actions.

The route returns the authenticated URL challenge when requested. Otherwise,
acknowledge within three seconds and use application-owned processing. Deduplicate
events by `event_id`; freshness alone does not prevent replay within the window.
Authorize `user.id`, action identifiers and business-object access before changing
anything. Persist action idempotency where duplicates would matter. A signed
request establishes Slack origin, not permission to act on arbitrary app data.
Do not fetch payload `response_url` or execute arbitrary payload actions blindly.
Enterprise-wide installs without a concrete team identity are outside this helper.
CLI applications use this same code without the editor; other frameworks can use
native Slack verification support with the same Env and route contract.

[Slack signature contract](https://docs.slack.dev/authentication/verifying-requests-from-slack/).
