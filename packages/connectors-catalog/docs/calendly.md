# Calendly

Import `calendlyProvider` from `@jskit-ai/connectors-catalog/server/calendly`.
This adapter uses an owner's personal token or project-owned web OAuth registration
to read schedules and invitees, create links, book and cancel appointments.
It does not implement application login. Shared and assistant connections are supported.

## Configure access

1. Sign in to the intended Calendly account. Open **Integrations → API & Webhooks**.
2. Under **Personal Access Tokens**, choose **Get a token now** or
   **Generate new token** if tokens already exist.
3. Name the token for this application. Grant `users:read` and
   `event_types:read`; newly scoped tokens require explicit permissions.
4. Create and copy the token while it is displayed. Store it in backend Env
   as `CALENDLY_API_KEY`.
5. Save a slot with provider `calendly`, mode `shared` or `assistant`,
   `scopes: ["users:read", "event_types:read"]`, and authentication `{ "method": "api-key", "secretRef":
   "env:CALENDLY_API_KEY" }`. No registration entry is needed for a personal token.
6. Verify using `connectApiKey`. Manage tokens on the same provider page.
   [Token setup](https://developer.calendly.com/how-to-authenticate-with-personal-access-tokens),
   [provider scope requirements](https://developer.calendly.com/docs/authentication/scopes).

## Runtime and CLI composition

`profile.read` calls `GET https://api.calendly.com/users/me`; its `resource.uri`
is the required `user` input for `eventTypes.list`. The latter calls
`GET /event_types`, accepting `count` (1–100, default 20), `page_token` and
optional `active`. Omit `active` to include both active and inactive types.
Pass `pagination.next_page_token` to request another page; do not follow a
returned URL with credentials. Results retain the provider envelope.
[Profile API](https://developer.calendly.com/api-docs/calendly-api/users/get-current-user),
[event-type API](https://developer.calendly.com/api-docs/calendly-api/event-types/list-event-types).

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with this
provider. Configuration and encrypted connection state remain separate files.
Provider-side token grants determine access; the configuration scope list
does not grant provider permissions. For pre-release configurations created
before OAuth support, replace Calendly’s empty scope list with users:read and
event_types:read; no compatibility reader is provided.

## Automation and application registrations

An AI can prepare configuration and requests after token creation. The verified
personal-token creation flow is interactive. A public integration instead needs
a developer account and OAuth application: sign into the developer portal,
create an OAuth app, and set its name, client type and authorized callback.
The generated application owns that registration and its callback. Hosted and
installed editors do not supply shared Vibe64 registrations. These OAuth
credentials are consumed by the web OAuth mode described below.
[OAuth app setup](https://developer.calendly.com/docs/authentication/creating-an-oauth-app).

Use the application's own account token and respect its provider rate limits;
do not share one person's token across unrelated applications.
Automated fixtures cover headers, required inputs, pagination, storage restart,
rotation, isolation and failure handling. No live scheduling data was accessed.

## Web OAuth setup and delivery status

The captured connection experience uses OAuth scopes. Personal tokens above
are a separate setup choice. OAuth uses the existing connection service and
the project-owned registration; it needs no Vibe64 authentication gateway.

Provider setup, checked against the official guide on 12 September 2026:

1. Open the [developer portal](https://developer.calendly.com/docs/authentication/creating-an-oauth-app)
   and sign in or create a developer account. This is separate from the normal
   Calendly user account.
2. Create an OAuth application. Supply its name, select **web**, and choose
   **Sandbox** for development or **Production** for production. Calendly
   recommends separate applications for those environments.
3. Copy the generated application's exact callback URL from Vibe64 into
   **Redirect URI**. Production requires HTTPS. Sandbox permits HTTP localhost;
   a hosted development URL should still use its actual HTTPS address.
4. Select **users:read** for the profile check and **event_types:read** for
   event-type listing. Add scheduled_events:read for meetings/invitees, availability:read for slots,
   scheduling_links:write for single-use links, and scheduled_events:write for
   booking/cancellation/no-shows. Grant the same scopes on personal tokens.
   Selecting a scope grants no app-user authorization; the app must enforce that.
5. Continue and copy the Client ID, Client Secret and Webhook signing key.
   The secret and signing key are shown only at creation. Save the Client ID
   in project registration configuration and the Client Secret in private Env.
   The current fragment has no webhook receiver; its signing key must not be
   confused with the OAuth Client Secret.
6. Configure the registration with `tokenEndpointAuthMethod: client_secret_basic`
   for a web client. Its secret belongs to the generated app's backend, never
   the browser or Vibe64's platform account. The shared provider metadata selects Basic authentication for web OAuth.
7. Register a changed custom-domain callback in the provider application before
   reconnecting. The provider application's menu offers **Edit**, including
   Redirect URI, followed by **Save**.

Runtime endpoints: authorization at `https://auth.calendly.com/oauth/authorize`
and token exchange at `https://auth.calendly.com/oauth/token`. Use the existing
state and S256 PKCE lifecycle. Web token requests authenticate the client with
HTTP Basic; native clients have a different contract and are not covered by
these web-application instructions. Persist each replacement refresh token
under the existing grant lock rather than replaying a consumed refresh token.
The profile and event-type operations retain their current fixed API origin.

Required focused proof before marking this provider complete: OAuth configuration
and captured scope choices, Basic authentication on code exchange and refresh,
PKCE/state checks, rotated-token persistence, denial/cancel/reconnect/disconnect,
and the existing personal-token flow. Live consent and scheduling remain outside
the controlled-test scope.

Sources: [OAuth app creation](https://developer.calendly.com/docs/authentication/creating-an-oauth-app),
[token endpoint](https://developer.calendly.com/api-docs/calendly-o-auth/o-auth/post-oauth-refresh-token).

The focused `test/calendly.test.js` fixture passes Basic code exchange, S256
PKCE, concurrent refresh serialization, replacement refresh persistence across
a new service instance, personal-token connection and local disconnect. This does not establish live Calendly consent or token issuance.

## Scheduling operations and application ownership

Both authentication methods use these same operations through `service.invoke`.
A CLI Node app installs the provider and composes the normal file connection service;
Vibe64 is not required. Other frameworks use their native HTTP/OAuth library and the
same project configuration, Env references and callback contract.

| Operations | Input / useful result | Scope |
| --- | --- | --- |
| `eventTypes.get`, `eventTypes.list` | Type UUID / profile user URI; scheduling URLs and type details | event_types:read |
| `availability.list` | Event-type URI, UTC start/end within 31 days; available times | availability:read |
| `events.list`, `events.get` | User/organization/group URI or event UUID; meeting status, times, pagination | scheduled_events:read |
| `invitees.list`, `invitees.get` | Event UUID and optional invitee UUID; answers, status, cancellation/reschedule URLs | scheduled_events:read |
| `schedulingLinks.create` | Event-type URI as `owner`; single-use booking URL, fixed max_event_count=1 | scheduling_links:write |
| `invitees.create` | Event-type URI, UTC start time, invitee email/name/IANA timezone; optional answers and guests | scheduled_events:write |
| `events.cancel` | Event UUID, optional reason; cancellation confirmation | scheduled_events:write |
| `noShows.create`, `noShows.get`, `noShows.delete` | Full invitee URI / no-show UUID; mark/read/undo no-show | scheduled_events:read or write |

Example: DogAndGroom reads its owner profile, lists active event types, then creates
one link for its grooming event type and sends that URL to the customer. The customer
selects and confirms the time on Calendly. A created link is not a scheduled event.
For an app-owned booking form, fetch future availability then submit `invitees.create`;
this requires Calendly Standard or higher. Slots may disappear between these calls;
handle the provider rejection and offer fresh availability. Booking triggers the event
type's normal confirmations and workflows. Do not automatically retry uncertain writes.

Pass pagination tokens back to the same operation. Do not fetch returned links with
an Authorization header. Organization/group access still depends on the owner's role.
Cancelling an event cancels the entire event, including a group event; it is not an individual group-invitee cancellation. Use the invitee’s hosted cancellation URL when appropriate.
The application owns who can read whose invitee data, booking confirmation, timezone
display, cancellations, persistence and polling. Reschedule using the invitee's returned
`reschedule_url`; this adapter does not invent a reschedule API.

**LIMITATIONS:** Public Vibe64 coding-assistant attachment is deferred. For example,
connecting Calendly does not let the editor's assistant inspect tomorrow's appointments;
the generated app's backend can use the scheduling operations above. Webhook receivers,
organization administration and advanced location/routing/customized event-type creation
are not supplied here. For example, a custom meeting-location booking form must use
native provider API handling, or send the customer through the hosted booking link.
No live consent, token issuance, booking or notification has been exercised.

Sources checked 12 September 2026:
[booking API](https://developer.calendly.com/api-docs/calendly-api/scheduled-events/create-event-invitee),
[scheduled events](https://developer.calendly.com/api-docs/calendly-api/scheduled-events/list-scheduled-events),
[no-show deletion](https://developer.calendly.com/api-docs/calendly-api/scheduled-events/delete-invitee-no-show),
[scopes](https://developer.calendly.com/docs/authentication/scopes).
