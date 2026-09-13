# Google Calendar

Import `googleCalendarDefinition` from `@jskit-ai/connector-google-calendar/shared`
for configuration and UI. Import `googleCalendarProvider` from
`@jskit-ai/connector-google-calendar/server` in server code.

The initial operations are `calendars.list` and `events.list`. Both return the
provider's page, including `nextPageToken`; callers decide whether and when to
fetch another page. Event lists accept `calendarId` (default `primary`),
`pageToken`, `maxResults`, `timeMin` and `timeMax`. They expand recurring events
and order by start time. Writes are available through `events.create`, `events.update` (PATCH) and `events.cancel`; `events.get` retrieves one event and its ETag. See the setup guide for inputs, scopes and attendee effects.

The recommended scopes are `calendar.calendarlist.readonly` and
`calendar.events.readonly`, both under `https://www.googleapis.com/auth/`.
Connection verification lists calendars, so retain a permission accepted by
`calendars.list`. Additional Calendar scopes are represented in metadata for
application-authored operations; selecting them does not implement those
operations. Calendar add-on scopes also require a Calendar add-on host.

Account ownership modes are shared, per app user, and assistant. The
application's authorization policy determines who can use each connection.
This package does not replace the application's login or user identity system.

Start with [provider setup](docs/setup.md) and the
[app-owned CLI pattern](patterns/calendar-cli/PATTERN.md).

## Verification state

Simulated Google responses verify request construction, grants, token exchange,
refresh and failures through the shared runtime tests. No Google account has
been connected during implementation. Live consent, Workspace administrator
restrictions and production verification remain open. Each application owns its
registration, callback and runtime grants; no shared editor gateway is required.
Configuration and UI metadata are not claims of live provider approval.
