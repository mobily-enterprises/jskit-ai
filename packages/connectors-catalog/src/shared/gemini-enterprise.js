import { createSchema } from "json-rest-schema";

const geminiEnterpriseScope = "https://www.googleapis.com/auth/cloud-platform";
const geminiEnterpriseDefinition = Object.freeze({
  id: "gemini-enterprise", name: "Gemini Enterprise", categories: ["Google", "Productivity"],
  description: "Search documents in a configured Gemini Enterprise engine.",
  accountModes: ["shared", "assistant"], authenticationMethods: ["oauth2"],
  oauthClientAuthenticationMethods: ["client_secret_post", "client_secret_basic"],
  settingsSchema: createSchema({
    projectId: { type: "string", required: true, noTrim: true, minLength: 6, maxLength: 30,
      validator: (value) => /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(value) || "Enter the Google Cloud project ID, without a URL or project number." },
    location: { type: "string", enum: ["global", "us", "eu"], defaultTo: "global" },
    engineId: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 63,
      validator: (value) => /^[a-z0-9][a-z0-9_-]*$/u.test(value) || "Enter the engine ID, starting with a lowercase letter or digit and using only lowercase letters, digits, hyphens or underscores." }
  }),
  settingsFields: [
    { name: "projectId", label: "GCP project ID", placeholder: "my-gcp-project", hint: "The Google Cloud project where the Gemini Enterprise app lives." },
    { name: "location", label: "Location", items: [{ value: "global", title: "Global" }, { value: "us", title: "United States" }, { value: "eu", title: "European Union" }],
      hint: "Match the engine's location. The runtime uses the corresponding Google API endpoint." },
    { name: "engineId", label: "Engine ID", placeholder: "my-search-engine", hint: "The existing search app identifier in default_collection, not its display name or full resource path." }
  ],
  scopes: [{ value: geminiEnterpriseScope, label: "Cloud Platform (full access)", recommended: true }],
  permissionsHint: "Google IAM and source permissions apply to the connected Google account. Shared access uses that same account for every authorized caller; it does not provide each app user's own search identity.",
  setup: { url: "https://docs.cloud.google.com/gemini/enterprise/docs/authentication", steps: [
    "In Google Cloud, select the project, enable the Discovery Engine API and create or select a Gemini Enterprise search app. Copy its project ID, location and engine ID.",
    "Grant the connecting Google account discoveryengine.engines.get and discoveryengine.servingConfigs.search on the target resources. Configure source access and any required Gemini Enterprise license separately.",
    "Open Google Auth Platform. Configure Branding and Audience; in Data Access add https://www.googleapis.com/auth/cloud-platform. Under Clients > Create Client choose Web application. Copy the Suggested callback URL shown here into Authorized redirect URIs, then create the client. Use the application hosting address, not the editor address.",
    "Enter the client ID here and keep the Client secret reference and Callback URL reference as Env references. Save configuration, then follow the Env links to store the secret and the same suggested callback under their referenced names. The application backend must implement this callback. Add the connecting account as a test user while the Google OAuth app is in testing.",
    "Search can request document snippets and a Google-generated summary with citations. The app explicitly enables summaries and its Google project pays for them. Missing snippets or a skipped summary must be shown as unavailable, not an invented answer. Every authorized caller uses this shared account; the app must restrict who can see those sources.",
    "Connect and choose the Google account granted access to the engine. Verification reads engine metadata; searching still requires search and source permissions. If access fails, check project ID, engine ID, location, API enablement and IAM. Disconnect removes the local grant; remove Google account consent separately to revoke provider access. If the application domain changes, update both Google redirect registration and callback Env."
  ] }
});
export { geminiEnterpriseDefinition, geminiEnterpriseScope };
