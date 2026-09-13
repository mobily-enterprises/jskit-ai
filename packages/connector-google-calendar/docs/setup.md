# Register Google Calendar access

Checked against Google's documentation on 2026-09-08. Portal labels and provider
requirements can change; the links below are the source for those details.

## Own registration

1. Open [Google Cloud Console](https://console.cloud.google.com/). Select the
   target project, or use the project selector's **New Project** action. Choose
   your organization/location when required.
2. Open **APIs & Services → Library**, find **Google Calendar API**, then enable
   it for that project. [API enablement](https://developers.google.com/workspace/guides/enable-apis).
3. Open **Google Auth platform → Branding**. On a new project, choose **Get
   Started**. Enter the app name and support email; choose the audience, provide
   the contact email, review the terms and create the configuration.
4. Use **Audience** to add your test accounts for an external app in testing.
   Use **Data Access → Add or Remove Scopes** to select the two recommended
   read permissions listed in this package's README. Complete branding/domain
   information required for your intended audience.
   [Consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent).
5. Open **Google Auth platform → Clients → Create Client**. Choose **Web
   application**, name it, and add the exact backend callback under
   **Authorized redirect URIs**. For the CLI example use
   `http://127.0.0.1:8080/integrations/google/callback`. Create the client.
   [Client creation](https://developers.google.com/workspace/guides/create-credentials).
6. Put its client ID into `registrations.google.clientId`. Store the client
   secret on the server as `GOOGLE_CLIENT_SECRET`, and set
   `GOOGLE_CALLBACK_URL` to the exact registered callback. Keep only the
   `env:` references in `integrations.json`. The server-side authorization
   code flow uses the secret during exchange; browser code must not receive
   it. [Web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).
7. Run the application and connect a test account. Verify calendar listing,
   event listing and reconnect behavior. Before public use, complete Google's
   applicable publishing/verification requirements; a test connection does
   not establish production approval.

## Application and environment ownership

The application owns its registration, client secret and callback. Hosted and
installed editors configure the same application-owned fields; neither supplies
a shared Google client or gateway. Use `source: "own"` and keep secret values in
the application's environment. See the
[callback guide](../../connectors-core/docs/oauth-callbacks.md) for callback
routes, domain changes and preserving runtime state when moving the app.

The chosen Google Cloud project owns Calendar project quotas. Two OAuth clients
inside one project do not isolate those quotas. Google also applies other limits;
check the actual project's [Calendar usage limits](https://developers.google.com/workspace/calendar/api/guides/quota).
Changing the client requires fresh consent; do not move grants between clients.

## What an AI can automate

| Work | Automation assessment |
|---|---|
| Create the application's Cloud project | Resource Manager has `projects.create`; requires an authenticated operator with the required parent permissions. [API](https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/create). |
| Enable Calendar API | Service Usage has `services.enable`; use `calendar-json.googleapis.com` and operator authority for the project. [API](https://docs.cloud.google.com/service-usage/docs/reference/rest/v1/services/enable). |
| Create a general Calendar OAuth web client, configure branding and consent | This packet does not establish a supported public API for all those steps. Use the console instructions; do not substitute IAP-specific client creation or service-account credentials. |
| Write configuration and app wiring | Fully scriptable using this package, ordinary files and the application's secret bindings. |
| Grant mailbox/calendar access | The account owner completes provider consent; an agent cannot manufacture that grant. |
| Verification, organization consent and quota approval | Human/provider decisions remain necessary where Google requires them. An agent can prepare configuration and evidence. |

## Field ownership

| Input or display | Owner/destination |
|---|---|
| Integration display name | `integrations.<slot>.displayName` |
| Shared account / each user / assistant | `integrations.<slot>.accountMode`; server policy enforces ownership |
| Selected scopes | `integrations.<slot>.scopes`; actual grants live in encrypted connection state |
| Client ID | `registrations.<id>.clientId` |
| Client secret | Server secret storage; source contains `clientSecretRef` |
| Callback URL | Server environment; source contains `callbackUrlRef`; UI may display its resolved value |
| People allowed to use a connection or client | Application permission records; not a provider OAuth scope and not a grant created by editing source |
| Connected account, verification time, reconnect status | Runtime metadata after successful provider verification |

See Google's [complete scope list](https://developers.google.com/workspace/calendar/api/auth)
for permission meanings. The shared form carries every documented Calendar
scope, including scopes for advanced operations that this initial fragment does
not implement.

## Event operations and framework wiring

For writes select **Manage events** (`calendar.events`) alongside **List
calendars**, add the scope to Google Data Access, and reconnect. A saved scope
change does not upgrade an existing grant. The connected account must also have
write access to the selected calendar; Google enforces organizer/guest rules.

Use the existing connection service in a JSKIT backend or CLI:

```js
await connections.invoke({ context, integrationId: "calendar",
  operation: "events.create", input: {
    calendarId: "primary", sendUpdates: "all",
    event: { summary: "Grooming appointment",
      start: { dateTime: "2026-10-05T09:00:00+08:00", timeZone: "Australia/Perth" },
      end: { dateTime: "2026-10-05T10:00:00+08:00", timeZone: "Australia/Perth" },
      attendees: [{ email: "customer@example.com" }] }
  } });
```

Other frameworks use the same project configuration/Env and their native Google
Calendar client or HTTP transport. Vibe64 stores configuration, not events.
The application authorizes the caller and chooses a connection, calendar and
notification policy. It owns appointment screens, scheduling and conflict rules.

- `calendars.list` exposes calendar IDs and access roles. `primary` means the
  connected person's primary calendar, not a global application calendar.
- `events.list` returns expanded occurrences with `nextPageToken`; use its
  instance ID for a one-occurrence change. `events.get` accepts `calendarId`
  and `eventId` and returns the provider event, including ETag and recurrence.
- `events.create`: `calendarId`, explicit `sendUpdates`, and `event`. The event
  requires start/end. Supported fields are summary, description, location,
  start/end, recurrence, attendees, transparency and visibility.
- `events.update`: same target plus `eventId`, a partial `event`, explicit
  `sendUpdates`, and optional `ifMatch` from the latest ETag. Fetch current data
  first. PATCH replaces whole attendee/recurrence arrays, not individual entries.
  Supply both start/end when changing time; setting nonempty recurrence also
  requires both. Google's 412 means refetch and review the concurrent edit.
- `events.cancel`: calendar/event IDs, explicit `sendUpdates`, optional `ifMatch`.
  Successful deletion returns null. Cancelling the master affects the series;
  an instance ID affects that occurrence. Application confirmation is required
  before choosing a cancellation target.
- `sendUpdates` is **all**, **externalOnly** or **none**. The adapter requires an
  explicit choice. Google warns that none can prevent external-calendar sync;
  it is not a promise that Google sends no email. Review attendee effects before
  writing. The adapter does not silently retry an uncertain write: reconcile
  against the calendar before repeating an appointment creation.
- All-day events use `{date: "2026-10-05"}` and an **exclusive** end date (the next
  day for a one-day event). Timed events require explicit offsets; recurring
  timed events additionally require IANA timeZone on both ends so Google can
  expand local times across daylight-saving changes. Recurrence is RFC5545
  RRULE/RDATE/EXRULE/EXDATE text; the provider validates rule semantics.
- Display description HTML safely. Do not assume event invitation, consent or
  notification delivery merely because an API response succeeded.

**Limitations:** no calendar/ACL administration, free/busy scheduling engine,
Meet creation, attachments, special event types, watch/history synchronization,
or recurring “this and following” series splitting. For example, an app can
create a weekly appointment and cancel one occurrence, but a booking conflict
solver or automatic rescheduler remains app code. Editor assistant attachment
is deferred. Fixtures do not prove live notifications or Google approval.

References: [insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
[patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch),
[delete](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete).
