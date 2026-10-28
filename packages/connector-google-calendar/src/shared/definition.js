const googleScope = (name) => `https://www.googleapis.com/auth/${name}`;
const googleCalendarDefinition = Object.freeze({
  id: "google-calendar",
  name: "Google Calendar",
  description: "jskit.connectors.googleCalendar.description",
  accountModes: ["shared", "per-user", "assistant"],
  authenticationMethods: ["oauth2"],
  setup: {
    callbackPath: "/integrations/google/callback",
    url: "https://developers.google.com/identity/protocols/oauth2/web-server",
    steps: [
      "In Google Cloud, select the project for this application. Open APIs & Services > Library, search for Google Calendar API, open it and choose Enable.",
      "Open Google Auth Platform > Branding. If setup has not started, choose Get Started; enter the app name, support email and contact email, choose the audience, review the policy and finish with Create.",
      "Choose External if people outside your Google Workspace organization will connect. During testing, open Audience > Test users > Add users, enter the allowed Google accounts and Save. Internal is only for your organization. External Testing refresh tokens for these API permissions expire after seven days; reconnect during testing. Public release also requires completing the applicable Google review.",
      "For an external app, open Data Access > Add or Remove Scopes. Add the permissions selected in this integration and Save. Sensitive or restricted scopes can require Google verification before public use; creating a client does not complete that review.",
      "Keep List calendars for the initial connection check and Read events if the application will read events. Event-only or availability-only permissions do not authorize the calendar-list check. Use an account that can access the intended calendars; selecting a scope does not grant calendar sharing access.",
      "To create, edit or cancel events, select Manage events, add calendar.events in Google Data Access, and reconnect for fresh consent. Keep List calendars for verification. Calendar sharing must independently allow the connected account to write.",
      "Choose the destination calendar and attendee notification policy explicitly. All-day end dates are exclusive; timed recurring events need an IANA time zone. Editing or cancelling a recurring master affects the series; use an expanded occurrence ID for one instance. Changing attendee arrays replaces the list; read the latest event first.",
      "Open Clients > Create Client. Choose Web application and name it. Under Authorized redirect URIs, choose Add URI and paste the application callback shown here, then Create. The editor dashboard URL is not the callback.",
      "Copy the Client ID into this form and copy or download the full client secret immediately; Google only shows it at creation. Save configuration, then use Set credential in Env to put the secret value in the variable named by Client secret reference. If lost, open Clients, select this client and Add Secret; save the new value before disabling the old secret.",
      "Use Set callback in Env to save the same application callback URL. If a Configured callback URL is shown, preserve it unless intentionally changing both Env and Google. Scheme, path, case and trailing slash must match exactly.",
      "For a shared account, return here and check or connect the account once the application runtime is ready. For per-user connections, each person authorizes inside your application. Saving this registration neither connects every user nor installs the callback route."
    ]
  },
  scopes: [
    { value: googleScope("calendar.calendarlist.readonly"), label: "jskit.connectors.googleCalendar.scopes.calendarCalendarlistReadonly.label", recommended: true },
    { value: googleScope("calendar.events.readonly"), label: "jskit.connectors.googleCalendar.scopes.calendarEventsReadonly.label", recommended: true },
    { value: googleScope("calendar.readonly"), label: "jskit.connectors.googleCalendar.scopes.calendarReadonly.label" },
    { value: googleScope("calendar"), label: "jskit.connectors.googleCalendar.scopes.calendar.label" },
    { value: googleScope("calendar.calendarlist"), label: "jskit.connectors.googleCalendar.scopes.calendarCalendarlist.label" },
    { value: googleScope("calendar.events"), label: "jskit.connectors.googleCalendar.scopes.calendarEvents.label" },
    { value: googleScope("calendar.freebusy"), label: "jskit.connectors.googleCalendar.scopes.calendarFreebusy.label" },
    { value: googleScope("calendar.settings.readonly"), label: "jskit.connectors.googleCalendar.scopes.calendarSettingsReadonly.label" },
    { value: googleScope("calendar.events.owned"), label: "jskit.connectors.googleCalendar.scopes.calendarEventsOwned.label" },
    { value: googleScope("calendar.events.owned.readonly"), label: "jskit.connectors.googleCalendar.scopes.calendarEventsOwnedReadonly.label" },
    { value: googleScope("calendar.events.freebusy"), label: "jskit.connectors.googleCalendar.scopes.calendarEventsFreebusy.label" },
    { value: googleScope("calendar.app.created"), label: "jskit.connectors.googleCalendar.scopes.calendarAppCreated.label" },
    { value: googleScope("calendar.calendars"), label: "jskit.connectors.googleCalendar.scopes.calendarCalendars.label" },
    { value: googleScope("calendar.calendars.readonly"), label: "jskit.connectors.googleCalendar.scopes.calendarCalendarsReadonly.label" },
    { value: googleScope("calendar.acls"), label: "jskit.connectors.googleCalendar.scopes.calendarAcls.label" },
    { value: googleScope("calendar.acls.readonly"), label: "jskit.connectors.googleCalendar.scopes.calendarAclsReadonly.label" },
    { value: googleScope("calendar.events.public.readonly"), label: "jskit.connectors.googleCalendar.scopes.calendarEventsPublicReadonly.label" },
    { value: googleScope("calendar.addons.execute"), label: "jskit.connectors.googleCalendar.scopes.calendarAddonsExecute.label" },
    { value: googleScope("calendar.addons.current.event.read"), label: "jskit.connectors.googleCalendar.scopes.calendarAddonsCurrentEventRead.label" },
    { value: googleScope("calendar.addons.current.event.write"), label: "jskit.connectors.googleCalendar.scopes.calendarAddonsCurrentEventWrite.label" }
  ],
  settingsFields: [],
  documentationUrl: "https://developers.google.com/workspace/calendar/api/guides/overview"
});

export { googleCalendarDefinition, googleScope };
