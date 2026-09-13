const GOOGLE_SCOPE_BASE = "https://www.googleapis.com/auth/";
const googleCalendarDefinition = Object.freeze({
  id: "google-calendar",
  name: "Google Calendar",
  description: "Read calendars and create, edit or cancel events.",
  categories: ["Google", "Productivity"],
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
    { value: `${GOOGLE_SCOPE_BASE}calendar.calendarlist.readonly`, label: "List calendars", recommended: true },
    { value: `${GOOGLE_SCOPE_BASE}calendar.events.readonly`, label: "Read events", recommended: true },
    { value: `${GOOGLE_SCOPE_BASE}calendar.readonly`, label: "Read all calendar data" },
    { value: `${GOOGLE_SCOPE_BASE}calendar`, label: "Manage calendars and events" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.calendarlist`, label: "Manage calendar subscriptions" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.events`, label: "Manage events" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.freebusy`, label: "Read your availability" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.settings.readonly`, label: "Read calendar settings" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.events.owned`, label: "Manage events in calendars you own" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.events.owned.readonly`, label: "Read events in calendars you own" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.events.freebusy`, label: "Read availability in accessible calendars" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.app.created`, label: "Create and manage app-created calendars" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.calendars`, label: "Manage calendar properties" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.calendars.readonly`, label: "Read calendar properties" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.acls`, label: "Manage calendar sharing permissions" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.acls.readonly`, label: "Read calendar sharing permissions" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.events.public.readonly`, label: "Read public calendar events" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.addons.execute`, label: "Run a Calendar add-on" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.addons.current.event.read`, label: "Read the event open in a Calendar add-on" },
    { value: `${GOOGLE_SCOPE_BASE}calendar.addons.current.event.write`, label: "Edit the event open in a Calendar add-on" }
  ],
  settingsFields: [],
  documentationUrl: "https://developers.google.com/workspace/calendar/api/guides/overview"
});

export { googleCalendarDefinition };
