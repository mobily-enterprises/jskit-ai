import { createSchema } from "json-rest-schema";

function definition(id, name, description, url, steps) {
  return Object.freeze({
    id, name, description, accountModes: ["shared", "assistant"],
    authenticationMethods: ["api-key"], scopes: [], setup: { url, steps }
  });
}

const airtableDefinition = definition("airtable", "Airtable", "Discover bases, read and edit records, and manage tables and fields.",
  "https://support.airtable.com/docs/creating-personal-access-tokens", [
    "Open Airtable Developer hub, then Personal access tokens and Create token.",
    "Name the token. Choose + Add a scope and add schema.bases:read for discovery, data.records:read for records, data.records:write for record changes, and schema.bases:write only for table/field changes or base creation. Record writes need Editor base access; schema writes need Creator access. Creating a base needs Workspace Creator access and a token resource grant covering that workspace. Otherwise choose + Add a base to select the bases this application needs. Your Airtable account must already have access to them.",
    "Create the token and copy its value. Enter env:AIRTABLE_TOKEN in API key reference here and save. Choose Set credential in Env, paste the token as the AIRTABLE_TOKEN value, and save it there.",
    "Return here and choose Connect account (or Verify again for an existing connection). Check connection only reads the application’s saved status. No OAuth registration or callback URL is needed for this personal token. Legacy Airtable API keys no longer work.",
    "Verification lists accessible bases. If expected bases are missing, check the token's resources, schema.bases:read permission and your own base access. Organization API restrictions may require your Airtable administrator to allow access.",
    "To rotate access, create a replacement PAT with the required scopes and resources, update AIRTABLE_TOKEN in Env, and choose Verify again. Revoke the old token in Airtable after checking other applications that use it. Disconnect here removes this application’s saved connection; it does not revoke the PAT or erase Env."
  ]);
const notionInternalDefinition = definition("notion", "Notion", "Read, query and update pages and data sources shared with a Notion connection.",
  "https://developers.notion.com/guides/get-started/internal-connections", [
    "Application data mode reads pages/blocks, queries data sources, creates pages, updates properties and appends blocks. Retrieve the database and its data_sources IDs/schema first. LIMITATIONS: no embedded editor, schema editing, file upload or automatic coding-chat attachment. For example, append meeting notes; your app owns its rendering and write approvals.",
    "As a Notion workspace owner, open the Developer portal at https://www.notion.so/profile/integrations. In Build → Internal connections, choose Create a new connection, name it for this application and select its workspace.",
    "Open Configuration, enable Read content; enable Insert content for creation/appending and Update content for page-property changes and copy the Installation access token. This is an internal connection token; it does not provide each application user's own Notion account or an OAuth login.",
    "Open Content access → Edit access and select the required pages/databases. Alternatively, on a Notion page use ••• → Connections → + Add connection and select this connection. Parent-page access includes its children; a new connection has no page access.",
    "Keep env:NOTION_API_KEY in API key reference here and Save configuration. Select Set credential in Env, save the copied token as NOTION_API_KEY, then return. Store the value only in Env, never in this JSON file or chat. No client ID, client secret or callback URL is needed for this internal-token mode.",
    "Choose Connect account. Verification searches accessible titles without changing content. An empty result does not prove that the intended pages are shared: check Content access and Read content if expected results are missing. Your application decides who may use this shared connection.",
    "If the token is exposed, refresh it in Notion's Configuration tab, update the referenced Env value and reconnect. Disconnect here removes this application's local connection; manage provider access separately in Notion. Other applications using the old token need their Env updated too."

  ]);
const notionDefinition = Object.freeze({
  ...notionInternalDefinition,
  accountModes: ["shared", "per-user", "assistant"],
  authenticationMethods: ["api-key", "oauth2"],
  oauthClientAuthenticationMethods: (_grant, settings) => settings?.connectionType === "mcp" ? ["client_secret_post"] : ["client_secret_basic"],
  accountModesForSettings: (settings) => settings.connectionType === "mcp" ? ["assistant"] : ["shared", "per-user", "assistant"],
  authenticationMethodsForSettings: (settings) => settings.connectionType === "mcp" ? ["oauth2"] : ["api-key", "oauth2"],
  scopesForSettings: (settings) => settings.connectionType === "mcp" ? [{ value: "default", label: "Notion MCP access", required: true }] : [],
  settingsSchema: createSchema({ connectionType: { type: "string", enum: ["rest", "mcp"], defaultTo: "rest" } }),
  settingsFields: [{ name: "connectionType", label: "Connection type", credentialScope: (value) => value || "rest",
    hint: "Hosted MCP needs its own client registration and consent; REST credentials cannot be reused.",
    items: [{ value: "rest", title: "Application data (REST)" }, { value: "mcp", title: "Hosted assistant tools (MCP)" }] }],
  setup: { ...notionInternalDefinition.setup,
    urlForSettings: (settings, method) => settings.connectionType === "mcp"
      ? "https://developers.notion.com/guides/mcp/build-mcp-client"
      : method === "oauth2" ? "https://developers.notion.com/guides/get-started/public-connections" : notionInternalDefinition.setup.url,
    clientRegistrationEndpoint: (settings) => settings.connectionType === "mcp" ? "https://mcp.notion.com/register" : undefined,
    stepsForSettings: (settings, method) => settings.connectionType === "mcp" ? [
      "LIMITATIONS: Automatic Vibe64 coding-chat attachment is deferred. A wired host may call discovered tools after authorizing each call; merely saving this connection does not equip coding chat. REST content operations belong to Application data mode.",
      "Choose Hosted assistant tools (MCP). This uses Notion's hosted MCP service, with a separate OAuth client from a public REST connection. Keep Assistant access and the required Notion MCP access permission.",
      "Use the OAuth client registration request below with the exact callback your assistant host serves. Send its JSON once to https://mcp.notion.com/register, or use registerNotionMcpClient from the JSKIT CLI code. A timeout may still create a client; inspect the result before retrying.",
      "Copy the returned client_id into Client ID. Save client_secret in the referenced Env variable and the registered callback in its callback Env variable. Save configuration. Do not paste the full registration response or secret into configuration or chat.",
      "Choose Connect account, sign into the intended Notion workspace and approve the requested access. The host completes the callback using PKCE. Verification lists tools without running one; your assistant must authorize each tool and its exact arguments.",
      "Reconnect starts new consent. Disconnect removes local grants; manage Notion's provider-side connection separately in Settings → Connections. The host owns tokens and refresh. These credentials cannot authorize the REST operations of Application data mode."
    ] : notionDefinition.setup.stepsByAuthentication?.[method] || notionInternalDefinition.setup.steps,
    stepsByAuthentication: { oauth2: [
    "Application data mode reads page properties and block children, queries data sources, creates pages and updates properties or appends blocks. Retrieve a database to find its data_sources IDs, then retrieve that source schema before supplying properties. Follow has_more/next_cursor explicitly, including nested block children. LIMITATIONS: no embedded Notion editor, database-schema editing, file upload or automatic coding-chat attachment. For example, append meeting notes without receiving a full Notion workspace UI.",
    "Open https://www.notion.so/profile/integrations. In Build → Public connections, choose Create new connection. Enter your application's connection name and development workspace.",
    "Choose the installation scope carefully: Any workspace or Selected workspaces only. Notion does not let you change this choice after creation. Enable Read content; add Insert content for creation/appending and Update content for page-property changes; capabilities and the user's page selection determine access, so there are no OAuth scope checkboxes here.",
    "Copy the Suggested callback URL for your application into Notion's Redirect URIs. Your application must serve this exact callback. Complete the provider's required fields and create the connection. Marketplace listing is a separate process.",
    "In Configuration, copy OAuth client ID here. Keep env:NOTION_CLIENT_SECRET and env:NOTION_CALLBACK_URL as references. Save configuration, then use Set credential in Env for the OAuth client secret and Set callback in Env for the registered URL. Keep the secret out of source and chat.",
    "Choose Each app user's own account when users need separate grants, or One shared account for an application-owned shared connection. Connect account opens consent. Select the intended workspace and pages, then Allow access. This authorizes Notion data; it does not log someone into your application.",
    "Verification searches accessible titles without writing. Missing results can mean pages were not selected or Read content is unavailable. Reconnect for new consent; Disconnect removes the local grant, and provider access must be managed in Notion separately. Your application owns token storage and refresh after leaving Vibe64."
  ] } }
});
const brevoDefinition = definition("brevo", "Brevo", "Send email and SMS, manage contacts and campaigns, and track delivery and automation events.",
  "https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys", [
    "In Brevo, open the account menu, Settings, SMTP & API, then API Keys & MCP.",
    "Your Brevo user needs API keys permission. Choose Generate a new API key, name it for this application, select its expiration and choose Generate.",
    "Copy the value before leaving; it is shown only once. Leave Create MCP server API key off: enabling it replaces the ordinary API key. This connector needs the ordinary API key, not an SMTP or MCP key.",
    "Enter env:BREVO_API_KEY in API key reference here and save. Choose Set credential in Env, paste the key as the BREVO_API_KEY value and save it there. Return here and choose Connect account or Verify again. Check connection only reloads status.",
    "Before email sending: Settings > Senders, Domains, IPs > Domains > Add a domain. Authenticate automatically if offered, or copy the exact Brevo code, DKIM and DMARC records into your DNS provider and recheck. Then Senders > Add a sender, enter From name/email, Save, and complete the emailed verification code if requested.",
    "For SMS, check your account’s country-specific sender requirements. Where registration is available, Settings > Campaigns > SMS Sender ID > Configure > Request Sender ID; choose recipient country, provide company and message details, submit and wait for approval. SMS credits and sender approval are separate from a valid API key.",
    "Marketing requires an appropriate recipient list and opt-out handling. Create a campaign draft and send a test before explicitly sending to its lists. A returned message ID is acceptance, not delivery; inspect delivery events for bounces or rejection. Automation events only trigger workflows configured and active in Brevo.",
    "No OAuth registration or callback URL is needed. Verification reads contacts without sending messages. Replace an expired or lost key in Env and reconnect. Disconnect removes local state only; delete the old key in Brevo to revoke it."
  ]);
const elevenlabsDefinition = definition("elevenlabs", "ElevenLabs", "Generate speech, discover voices/models and create instant voice clones.",
  "https://elevenlabs.io/docs/help-center/technical/how-do-i-authorize-myself-using-an-api-key", [
    "Select the intended ElevenLabs workspace and open Developers > API Keys > Create API Key. Name it for this app and keep Restrict Key enabled.",
    "Under Endpoints, enable User read for verification, Voices read for discovery, Models read for model selection and Text to Speech for generation. Enable Voices write only if the app will create voice clones. Set a credit limit, create the key and copy it immediately; only its last four characters are shown later.",
    "Enter env:ELEVENLABS_API_KEY in API key reference and save. Choose Set credential in Env, paste the key as ELEVENLABS_API_KEY and save there. Return and choose Connect account / Verify again; Check connection only reads saved status. Verification reads the account and does not generate audio or prove generation/cloning permissions.",
    "Choose an accessible voice and a model supporting text-to-speech. Generation spends this workspace’s credits. Voice availability and formats depend on the plan; a valid key does not grant every library voice. The app owns its text/audio screens and usage limits.",
    "Instant Voice Cloning requires an eligible plan (Starter or above), an available voice slot and permission to clone the speaker. In Voices > Add a new voice > Instant Voice Clone, provide clear audio, name the voice and confirm rights; or have the app explicitly upload authorized samples. If requires_verification is true, finish ElevenLabs verification before treating the new voice as ready.",
    "This connector returns bounded audio files, not live streaming. Professional Voice Cloning and realtime speech use native provider tools. Configuring it does not attach ElevenLabs to Vibe64’s coding assistant. Rotate keys in Env and verify again; Disconnect removes app state, while Developers > API Keys > key menu revokes provider access. No OAuth application or callback URL is required."
  ]);
const githubApiDefinition = Object.freeze({
  ...definition("github-api", "GitHub API", "Read repository content and activity; create and update issues and pull requests.",
    "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app", [
      "For OAuth, open GitHub Settings > Developer settings > OAuth Apps > New OAuth App. Enter the application name and its hosting URL. Copy Suggested callback URL here into Authorization callback URL, then register the application.",
      "Copy Client ID here. Generate a client secret and keep it private. Save configuration, then follow the Env links to store the secret and exact callback under their referenced names. Your application backend must implement the callback.",
      "Choose only the permissions this application needs. Connect the shared account here; for each user's own account, the generated application's account screen starts the connection.",
      "For a personal token, select API key instead. In GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens, generate a token with an expiry, resource owner and selected repositories. Metadata read access covers repository listing; allow Contents read for files/commits/releases, Actions read for workflow runs, Issues read or write and Pull requests read or write for the operations you enable; complete organization approval if required.",
      "For token setup enter env:GITHUB_API_KEY as the API key reference, Save configuration, then Set credential in Env. Store the real token as GITHUB_API_KEY and return and choose Connect account or Verify again. Check connection reads saved status. Personal tokens need no OAuth callback.",
      "For OAuth private repositories request repo; public-only writes can use public_repo. These scopes are broader than fine-grained token permissions. Issue/PR writes are explicit app actions and are never performed during verification. This API connector does not synchronize project code or replace Vibe64 Git login.",
      "Verification reads the connected account profile; repository access still depends on token permissions and organization policy. Update rotated credentials in Env. Disconnect removes local state; revoke the token or OAuth authorization in GitHub separately."
    ]),
  accountModes: ["shared", "per-user", "assistant"],
  authenticationMethods: ["oauth2", "api-key"],
  oauthClientAuthenticationMethods: ["client_secret_post"],
  scopes: [
    { value: "read:user", label: "Read user profile", recommended: true },
    { value: "repo", label: "Repositories", recommended: true },
    { value: "public_repo", label: "Public repositories" },
    { value: "workflow", label: "Workflows" },
    { value: "gist", label: "Gists" },
    { value: "notifications", label: "Notifications" },
    { value: "user:email", label: "Email" },
    { value: "read:org", label: "Read organizations" },
    { value: "project", label: "Projects" },
    { value: "offline_access", label: "Expiring tokens with refresh access" }
  ]
});
const apifyDefinition = definition("apify", "Apify", "Run Actors with explicit limits and retrieve their results.",
  "https://docs.apify.com/integrations/api", [
    "Select the intended account or organization in Apify Console.",
    "Open Settings, API & Integrations, then create an API token for this application.",
    "In Description, identify this application. To expire the token, enable Set expiration date and choose its Date. A standard token (Limit token permissions off) has broad access to this account, not just read access. Use it only if this application's owner accepts that access. Scoped tokens are also accepted, but their permissions must allow listing Actors; this guide does not establish a minimum scoped permission set. Do not broaden an existing token merely to make a check pass.",
    "Choose Create, then copy the token. A personal-account token does not access organizations you belong to. For organization resources, switch to that organization before creating its personal or organization token; organization tokens require owner or Manage access tokens permission.",
    "Copy the token. Enter env:APIFY_TOKEN in API key reference here and save. Choose Set credential in Env, paste the token as the APIFY_TOKEN value and save it there. Return here and choose Connect account (or Verify again for a connected account). Check connection only reads the current connection status.",
    "No OAuth registration or callback URL is needed. Verification lists Actors without starting a run. For scoped tokens that run Actors and read their output, allow Run on the intended Actor and access to its default run storages in the token permissions. Review the Actor execution permission mode; Full access gives the running Actor account-wide access. If you rotate or expire this token, update its Env value before reconnecting. Disconnect removes the application connection; revoke the token in Apify Console to withdraw provider access."
  ]);

const calendlyDefinition = Object.freeze({
  "id": "calendly",
  "name": "Calendly",
  "description": "Read meetings and invitees, check availability, create booking links and manage appointments.",
  "accountModes": [
    "shared",
    "assistant"
  ],
  "authenticationMethods": [
    "oauth2",
    "api-key"
  ],
  "oauthClientAuthenticationMethods": [
    "client_secret_basic"
  ],
  "scopes": [
    {
      "value": "users:read",
      "label": "users — read",
      "recommended": true
    },
    {
      "value": "organizations:read",
      "label": "organizations — read"
    },
    {
      "value": "event_types:read",
      "label": "event types — read",
      "recommended": true
    },
    {
      "value": "scheduled_events:read",
      "label": "scheduled events — read"
    },
    {
      "value": "availability:read",
      "label": "availability — read"
    },
    {
      "value": "scheduling_links:write",
      "label": "scheduling links — write"
    },
    {
      "value": "shares:write",
      "label": "shares — write"
    },
    {
      "value": "scheduled_events:write",
      "label": "scheduled events — write"
    },
    {
      "value": "event_types:write",
      "label": "event types — write"
    },
    {
      "value": "availability:write",
      "label": "availability — write"
    },
    {
      "value": "locations:read",
      "label": "locations — read"
    },
    {
      "value": "routing_forms:read",
      "label": "routing forms — read"
    },
    {
      "value": "groups:read",
      "label": "groups — read"
    },
    {
      "value": "organizations:write",
      "label": "organizations — write"
    },
    {
      "value": "webhooks:read",
      "label": "webhooks — read"
    },
    {
      "value": "webhooks:write",
      "label": "webhooks — write"
    },
    {
      "value": "activity_log:read",
      "label": "activity log — read"
    },
    {
      "value": "data_compliance:write",
      "label": "data compliance — write"
    },
    {
      "value": "outgoing_communications:read",
      "label": "outgoing communications — read"
    },
    {
      "value": "contacts:read",
      "label": "contacts — read"
    },
    {
      "value": "contacts:write",
      "label": "contacts — write"
    }
  ],
  "setup": {
    "url": "https://developer.calendly.com/docs/authentication/creating-an-oauth-app",
    "steps": [
      "For OAuth, open the Calendly developer portal (a separate account from your Calendly user account) and create an OAuth application. Set its name, web type, and Sandbox or Production environment.",
      "Copy this project’s suggested callback into Redirect URI. Production requires HTTPS; Sandbox allows HTTP localhost. Select users:read for profile verification and event_types:read for event types. Add scheduled_events:read for meetings and invitees, availability:read for slots, scheduling_links:write for single-use links and scheduled_events:write for booking, cancellation or no-shows.",
      "Continue and copy Client ID here. Save Client Secret and callback URL through their Env references. Calendly shows the secret and webhook signing key only at creation; the signing key is not the client secret and is unused by this connector.",
      "Save and choose Connect account. Each project uses its own registration; web token requests use Basic client authentication. Changing the app domain requires editing Redirect URI in Calendly and saving the matching callback in Env.",
      "For a personal token instead, open Calendly Integrations, API & Webhooks, Personal Access Tokens, then Get a token now or Generate new token. Name the token and select users:read and event_types:read.",
      "Copy the personal token into Env as CALENDLY_API_KEY. Choose API key authentication here, enter env:CALENDLY_API_KEY, save, and choose Connect account; Verify again checks a saved connection. Personal tokens need no OAuth registration or callback.",
      "A single-use scheduling link sends the customer to Calendly to choose and confirm a time; creating a link is not a booking. Direct API booking needs Calendly Standard or higher and triggers the event type’s normal notifications and workflows. Use the returned reschedule URL for rescheduling; no reschedule API is provided.",
      "Verification reads the connected profile without booking an appointment. Reconnect after a revoked grant. Local disconnect removes app connection state; revoke the token or app access in Calendly to remove provider access."
    ]
  }
});

const hubspotKeyDefinition = definition("hubspot", "HubSpot", "Manage contacts, deals and their relationships in the connected HubSpot account.",
  "https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview", [
    "As a HubSpot super admin, select the account that owns the CRM data. Open Development > Legacy apps > Create legacy app > Private.",
    "Name the app. In Scopes > Add new scope, select crm.objects.contacts.read for verification. Add crm.objects.contacts.write to manage contacts, crm.objects.deals.read for deals/pipeline IDs, and crm.objects.deals.write to create/update deals and link contacts. Choose Update. Create the app and confirm. In Auth, use Show token > Copy. Use an app access token, not a CLI personal access key or developer API key.",
    "Keep Read CRM contacts selected, enter env:HUBSPOT_API_KEY in API key reference and Save configuration. Choose Set credential in Env, paste the token as HUBSPOT_API_KEY and save it there. Keep the value in backend Env.",
    "Return and choose Connect account. Verification reads contacts without modifying them. No OAuth callback is required for this shared token. A developer-platform static access token for the same account can also be used.",
    "Use internal property, pipeline and stage IDs from HubSpot, not display labels. The app can create a contact, create a deal, link them and advance its stage; it owns triggers, duplicate prevention and business authorization. There is no workflow designer or sync daemon. Rotate the token in HubSpot and update Env, then reconnect. Disconnect only removes this application's local grant; revoke the provider token separately. This shared connection uses one HubSpot account for the application's authorized users."
  ]);
const hubspotDefinition = Object.freeze({
  ...hubspotKeyDefinition,
  accountModes: ["shared", "per-user", "assistant"],
  authenticationMethods: ["api-key", "oauth2"],
  oauthClientAuthenticationMethods: ["client_secret_post"],
  scopes: [{ value: "oauth", label: "Authorize the HubSpot app", recommended: true },
    { value: "crm.objects.contacts.read", label: "Read CRM contacts", recommended: true },
    { value: "crm.objects.contacts.write", label: "Create and update CRM contacts" },
    { value: "crm.objects.deals.read", label: "Read deals and pipelines" },
    { value: "crm.objects.deals.write", label: "Create and update CRM deals" }],
  setup: {
    ...hubspotKeyDefinition.setup,
    urlByAuthentication: { oauth2: "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/create-an-app" },
    stepsByAuthentication: { oauth2: [
      "Create a HubSpot developer project using the Provider setup guide and hs project create. Select App and OAuth authentication. Private distribution allows up to ten allowlisted HubSpot accounts; choose marketplace distribution if you need broader distribution and follow its requirements.",
      "In the generated src/app/app-hsmeta.json, set config.auth.type to oauth. Put this screen's exact Suggested callback URL in config.auth.redirectUrls and request oauth and crm.objects.contacts.read in requiredScopes. Add contact/deal write scopes and deal read scope only for the operations your app uses. Use HTTPS for production. Upload with hs project upload.",
      "Run hs project open. Under Project Components, select the app, then Auth > Client credentials. Copy Client ID here. Save configuration, then Set credential in Env to store Client secret under the displayed reference. Use Set callback in Env to save the exact registered callback.",
      "Keep the same permissions selected here and save. For shared access, choose Connect account and authorize the intended HubSpot account. For each-user access, each person connects from the generated application's account screen after signing in. Application login and connecting HubSpot are separate actions.",
      "HubSpot installation normally grants account-level CRM access, not just records owned by the person clicking Connect. Your app must enforce its own authorization. Verification reads contacts; it does not modify CRM records. Saving these fields does not create or upload a HubSpot developer project.",
      "Reconnect repeats consent. Disconnect removes the local grant; uninstall the connected app in HubSpot separately to remove its provider access. A new client registration or callback needs matching configuration and may require consent again."
    ] }
  }
});
const linearKeyDefinition = definition("linear", "Linear", "Read profiles and issues, or use Linear MCP tools with the connected account.",
  "https://linear.app/docs/api-and-webhooks", [
    "In the intended Linear workspace, open Settings > Account > Security & Access > Personal API keys. Create a named key, select Read and restrict it to the teams this application needs. Add the required write permissions only if your application will create or update issues/projects. Copy the key before leaving.",
    "If key creation is unavailable, ask a workspace administrator to check Settings > Administration > API > Member API keys. Administrators can create keys even when member key creation is disabled.",
    "Enter env:LINEAR_API_KEY as API key reference, keep Read selected and Save configuration. Choose Set credential in Env, store the actual key as LINEAR_API_KEY, and return to Connect account. The secret belongs in Env, not this form or source control.",
    "Verification reads the connected profile; it does not create issues. This key connects one account for shared or assistant use. To let each application user connect their own account, select OAuth instead.",
    "Your application can discover Linear MCP tools and use the returned schemas to create projects and create/update issues. Approve each tool name and its arguments before calling it; check isError before reporting success. Connecting here does not attach tools to Vibe64 Codex/OpenCode: for example, a saved connection alone does not let the coding chat edit an issue.",
    "MCP uses the same key with its permissions. Read-only keys cannot perform writes; your application must authorize individual tool calls. Disconnect removes the local connection. Revoke or replace the key in Linear separately."
  ]);
const linearDefinition = Object.freeze({
  ...linearKeyDefinition,
  accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["api-key", "oauth2"],
  tokenEndpointAuthMethods: ["client_secret_post"],
  scopes: [
    { value: "read", label: "Read your account", recommended: true },
    { value: "write", label: "Write on your behalf" },
    { value: "issues:create", label: "Create issues and attachments" },
    { value: "comments:create", label: "Create comments" },
    { value: "timeSchedule:write", label: "Manage time schedules" }
  ],
  setup: { ...linearKeyDefinition.setup,
    urlByAuthentication: { oauth2: "https://linear.app/developers/oauth-2-0-authentication" },
    stepsByAuthentication: { oauth2: [
      "Sign into the Linear workspace that will own your application registration as an administrator. Open Settings > Administration > API and create an OAuth application, or open https://linear.app/settings/api/applications/new. Give it your application's name and register the exact Suggested callback URL shown here.",
      "Copy the registration's Client ID into this form. Save configuration, then use the Env links to store its Client Secret and the same callback URL under their referenced names. The generated application's backend must implement this callback; saving a URL does not create the route.",
      "Keep Read selected. Add write, issue creation, comment creation or time-schedule permissions only for features your application will actually expose. This connection acts as the consenting user. It does not create a Linear service-account agent.",
      "Save and choose Connect account for shared or assistant access. For Each user, connect from the generated application's account screen after signing in. Select the intended Linear workspace and approve access; connecting Linear is separate from logging into your application.",
      "The same OAuth grant can access GraphQL and https://mcp.linear.app/mcp. No separate MCP client registration is needed for this path. Verification only reads your profile. The application must authorize MCP tool calls, and the granted permissions limit which actions Linear permits.",
      "Discover MCP tools at runtime and use their returned schemas to create projects or create/update issues. Your app owns tool approval and must check isError before reporting success. LIMITATION: saving this connection does not attach tools to Vibe64 Codex/OpenCode; the coding chat cannot edit an issue merely because you connected Linear.",
      "Reconnect repeats consent. Disconnect removes this project's local grant; revoke provider access separately in Linear Settings > Account > Security & Access > Authorized applications. Use a separate connection for another workspace. Changing registration or callback may require connecting again."
    ] }
  }
});
const pipedriveTokenDefinition = definition("pipedrive", "Pipedrive", "Read the authenticated user and identify their Pipedrive company.",
  "https://pipedrive.readme.io/docs/how-to-find-the-api-token", [
    "The adapter lists/reads deals, people, organizations, activities, leads and pipelines, and creates/updates basic records except pipelines. The app must authorize each record and write. LIMITATIONS: no full CRM UI, pipeline administration, bulk import, custom-field editor, attachments, webhooks or automatic coding-chat attachment. For example, create a contact and follow-up deal; the app supplies its sales dashboard.",
    "Sign into Pipedrive and switch to the company this application should access. The same user has a different API token in each company; a direct settings link may open the company you used most recently.",
    "Open your account name at the top right → Company settings → Personal preferences → API. Copy the API token. If the API section is unavailable, ask the company administrator to check your API access.",
    "Keep env:PIPEDRIVE_API_KEY in API key reference here and Save configuration. Choose Set credential in Env, store the copied token as PIPEDRIVE_API_KEY and save it there. Keep the actual token out of configuration JSON and chat. API-token mode needs no client ID, client secret or callback URL.",
    "For CRM operations with an API token, copy the company subdomain from your browser: for https://acme.pipedrive.com enter acme in Company domain (API token). Save and reconnect after changing it. OAuth obtains its company address from consent and ignores this setting.",
    "Return and choose Connect account. Verification reads the authenticated user's profile and company without changing CRM records. Check that the token belongs to the intended company. This shared connection acts as its token owner; your application controls which users may use it.",
    "There is only one active API token for that user in that company. If you regenerate it in Pipedrive, update the referenced Env value and reconnect; every other tool using the old token needs updating too.",
    "Disconnect here removes this application's local connection. It does not invalidate the original Pipedrive API token. Manage that credential in Pipedrive's API settings separately."
  ]);
const pipedriveDefinition = Object.freeze({
  ...pipedriveTokenDefinition,
  accountModes: ["shared", "per-user", "assistant"],
  authenticationMethods: ["api-key", "oauth2"],
  oauthClientAuthenticationMethods: ["client_secret_basic"],
  settingsSchema: createSchema({ companyDomain: { type: "string", minLength: 1, maxLength: 63, pattern: "^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$" } }),
  settingsFields: [{ name: "companyDomain", label: "Company domain (API token)", hint: "For acme.pipedrive.com enter acme. Required for API-token CRM operations; OAuth uses the company address returned with consent." }],
  scopes: [],
  setup: { ...pipedriveTokenDefinition.setup,
    urlByAuthentication: { oauth2: "https://pipedrive.readme.io/docs/marketplace-registering-a-private-app" },
    stepsByAuthentication: { oauth2: [
      "The adapter lists/reads deals, people, organizations, activities, leads and pipelines, and creates/updates basic records except pipelines. The app must authorize each record and write. LIMITATIONS: no full CRM UI, pipeline administration, bulk import, custom-field editor, attachments, webhooks or automatic coding-chat attachment. For example, create a contact and follow-up deal; the app supplies its sales dashboard.",
      "Sign into your Pipedrive developer sandbox account and open the account menu → Developer Hub. If it is missing, request a developer sandbox through https://developers.pipedrive.com. Choose Create an app, then Create private app for an unlisted integration; choose public only when you need a Marketplace listing. This app type cannot be changed later.",
      "In Basic info enter your application's name and copy its Suggested callback URL into OAuth Callback URL, then Save. Pipedrive allows one callback per registration. Your application backend must serve this exact URL; save the same URL in its callback Env variable.",
      "In OAuth & access scopes copy Client ID here and put Client secret in the referenced Env variable using Set credential in Env after Save configuration. Keep env:PIPEDRIVE_CLIENT_SECRET and env:PIPEDRIVE_CALLBACK_URL as references. Never store the actual secret in configuration or chat.",
      "Verification reads the current profile with base permission. For CRM records, configure deals:read or deals:full (deals/leads/pipelines), contacts:read or contacts:full (people/organizations), and activities:read or activities:full. Use full only for create/update operations and reconnect after changing registration permissions. Pipedrive consent uses the registration's permissions, so this screen has no selectable OAuth scopes. For a private app, choose Change to live when ready to connect other companies; a draft is limited to its own company.",
      "Choose Each app user's own account for separate user grants, or One shared account for an application-owned connection. Connect account starts consent: sign into the intended company and choose Allow and Install. This authorizes CRM access; it does not sign the person into your application. Cancel leaves the attempt unconnected.",
      "Verification reads the authenticated profile. The runtime retains the returned company API address with that grant, and owns token refresh locally. Reconnect repeats consent. Disconnect removes the local grant; uninstall provider access separately under Pipedrive Settings → Tools and apps → Marketplace apps. A changed company address requires reconnecting."
    ] }
  }
});
const gitlabApiDefinition = Object.freeze({
  ...definition("gitlab-api", "GitLab API", "Read project content and activity; create and update issues and merge requests.",
    "https://docs.gitlab.com/integration/oauth_provider/", [
      "Select your GitLab instance URL; use https://gitlab.com for GitLab.com. For OAuth, open your instance's /user_settings/applications page, add an application and enable Confidential. Enter the exact Suggested callback URL here as its redirect URI and select read_user and read_api.",
      "Copy Application ID into Client ID here. Save configuration and use the Env links to store the Secret and the same callback under their referenced names. Your application backend must implement the callback. Each user's connection starts in the application's account screen.",
      "For token setup, select API key. On the chosen instance open your avatar > Edit profile > Access > Personal access tokens. Generate a token with a name, expiry and read_api/read_user permissions for reads; use api for issue/merge-request writes. Project or group tokens require the corresponding resource role and API permissions.",
      "Enter env:GITLAB_API_KEY as API key reference, Save configuration, then Set credential in Env. Store the real token as GITLAB_API_KEY and return to connect. The token must belong to the selected instance.",
      "Issue and merge-request writes require api permission and an authorized project role. OAuth users must select api and reconnect if adding writes. Creation is explicit, never part of verification; the app must restrict project access for its visitors. This connector does not synchronize source code or run pipelines.",
      "Verification reads the account profile, not repository contents. Changing the instance requires reconnection. Update rotated credentials in Env. Disconnect removes local state; revoke the token or authorized application in GitLab separately. CI job tokens and DPoP-bound tokens are not supported."
    ]),
  accountModes: ["shared", "per-user", "assistant"],
  authenticationMethods: ["api-key", "oauth2"],
  oauthClientAuthenticationMethods: ["client_secret_post"],
  scopes: [{ value: "read_user", label: "Read user profile", recommended: true },
    { value: "read_api", label: "Read API", recommended: true },
    { value: "api", label: "Full API access" }],
  settingsSchema: createSchema({ instanceUrl: { type: "string", defaultTo: "https://gitlab.com", noTrim: true,
    validator: (value) => {
      try {
        const url = new URL(value);
        return (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/") || "Enter the HTTPS GitLab instance origin without credentials, query or path.";
      } catch { return "Enter the HTTPS GitLab instance URL."; }
    }
  } }),
  settingsFields: [{ name: "instanceUrl", label: "Instance URL", placeholder: "https://gitlab.com",
    hint: "The trusted GitLab instance that receives this connection's credentials. Defaults to GitLab.com." }]
});
const tallyDefinition = definition("tally", "Tally", "Create forms and retrieve submissions using your Tally account.",
  "https://developers.tally.so/api-reference/api-keys", [
    "Open Tally Settings, then API keys and Create API key.",
    "Create the key for the intended user. It inherits that user's resource access; this flow does not offer per-form scopes.",
    "Copy the key before closing; it cannot be displayed again. Enter env:TALLY_API_KEY in API key reference here and save. Choose Set credential in Env, paste the copied key as the TALLY_API_KEY value, and save it there.",
    "Return here and choose Check connection. No OAuth registration or callback URL is needed. Verification lists forms without changing them.",
    "Creating forms defaults to draft. Publishing is an explicit app action; replacing blocks can change existing questions. The app must authorize each form and access to its responses.",
    "Submission reads default to completed responses. Partial responses require an explicit filter and appropriate provider access. Disconnect only removes the local connection; revoke or replace the key in Tally to end provider access.",
    "A lost key needs a replacement. Keys stop working when their user leaves the organization; use the account intended to maintain this application's access."
  ]);
const contentfulDefinition = Object.freeze({
  ...definition("contentful", "Contentful", "Read published entries, linked assets, content models and locales from a Contentful space.",
    "https://www.contentful.com/developers/docs/references/authentication/", [
    "Select the intended Contentful space. Open Settings > API keys, Content delivery / preview tokens, then Add API key. Name this application's key.",
    "Copy its Space ID into Space ID here. Copy the Content Delivery API access token; the Preview token and Content Management token are different credentials.",
    "Authorize the intended environment for this key in Contentful, then choose Save at the top of the token form. Set the matching Environment ID here (master by default) and select the region where the space is hosted.",
    "Enter env:CONTENTFUL_ACCESS_TOKEN in Content Delivery API token reference here and save. Choose Set credential in Env, paste the delivery token as CONTENTFUL_ACCESS_TOKEN and save it there. Return here and choose Connect account or Verify again. Check connection only refreshes local status.",
    "Publish entries and assets in Contentful before reading them. Delivery access does not expose drafts. Use locale and include depth (0–10) when listing entries; linked entries/assets are returned under includes. Unpublished or missing links can remain unresolved, so handle them explicitly in your app.",
    "To rotate access, create a replacement delivery token with the same required environment access, update Env and verify before retiring the old key. Disconnect only removes local state, not the Contentful API key. The app renders rich text and images and chooses its own cache policy.",
    "No OAuth registration or callback URL is needed. Verification reads published entries. A 404 can mean the key lacks access to the chosen environment; check the space, region and environment as well as the token."
    ]),
  apiKeyReferenceLabel: "Content Delivery API token reference",
  settingsSchema: createSchema({
    spaceId: { type: "string", required: true, minLength: 1, maxLength: 64,
      validator: (value) => /^[a-zA-Z0-9_-]+$/u.test(value) || "Enter the Space ID from Contentful API keys." },
    environmentId: { type: "string", minLength: 1, maxLength: 64, defaultTo: "master",
      validator: (value) => /^[a-zA-Z0-9_-]+$/u.test(value) || "Enter a Contentful environment ID." },
    region: { type: "string", enum: ["us", "eu"], defaultTo: "us" }
  }),
  settingsFields: [
    { name: "spaceId", label: "Space ID", hint: "Copy the Space ID from the selected space's API keys page." },
    { name: "environmentId", label: "Environment ID", hint: "The key must have access to this environment. Defaults to master." },
    { name: "region", label: "Region", items: [
      { value: "us", title: "United States" }, { value: "eu", title: "Europe" }
    ] }
  ]
});
const asanaDefinition = definition("asana", "Asana", "Discover projects and create, assign and track tasks in your Asana workspace.",
  "https://developers.asana.com/docs/personal-access-token", [
    "Open the Asana developer console using My apps in the provider setup guide.",
    "Under Personal access tokens, choose Create new token and give it a description identifying this application.",
    "Copy the token. Enter env:ASANA_TOKEN in API key reference here and save. Choose Set credential in Env, paste the token as the ASANA_TOKEN value, and save it there.",
    "Return here and choose Connect account or Verify again. Check connection only reads the current status. Verification lists workspaces without changing tasks or projects. Account policy may require administrator approval for personal tokens.",
    "This personal token acts as its owner and needs no callback or OAuth registration. It can only access workspaces, projects and tasks that owner is permitted to use; listing a workspace does not prove permission to edit every project. Your app chooses project privacy explicitly and grants team/user membership separately. Connecting each application user's own Asana account requires a separate OAuth flow; this token configuration does not provide it. To rotate access, create a replacement token and update Env before verifying again. Deauthorize the old token in the developer console when it is no longer needed; Disconnect alone does not revoke it."
  ]);

const stripeDefinition = Object.freeze({
  ...definition("stripe", "Stripe", "Read the Stripe account's available and pending balances.",
  "https://docs.stripe.com/keys/restricted-api-keys", [
    "Select the intended Stripe account and sandbox or live mode, then open the API keys page.",
    "Choose Create restricted key, start from zero permissions, name it and allow Balance read access.",
    "If configuring application payments, Balance read alone is insufficient. The current payment library also reads the account, invoices and subscriptions, writes customers, products and prices, and creates Checkout and customer portal sessions. Grant those resource permissions for your account. Leave unrelated resources and connected-account permissions disabled. Review failed requests in the key's request logs if Stripe reports missing permissions.",
    "Create the key, complete verification and copy it into Env. A publishable key cannot read balances.",
    "Save its reference here. This fragment reads the key owner's balance; payment collection and connected merchant onboarding require further integration."
  ]),
  paymentSetup: {
  "url": "https://docs.stripe.com/webhooks",
  "steps": [
    "Open Stripe and select the matching sandbox or live account. Complete the API-key instructions for this connection; keep secret keys in backend Env.",
    "Open Workbench → Webhooks → Add destination. Select events for your account and the snapshot webhook endpoint type. Add invoice.paid, invoice.payment_failed, invoice.payment_action_required and customer.subscription.created, updated and deleted. Set the endpoint's API version to the version supported by your application's Stripe SDK.",
    "Enter the suggested webhook URL only after your application implements that route. Create the destination, reveal its signing secret, and use Set signing secret in Env above. Each environment needs its own destination and secret.",
    "Configure the customer portal in Stripe's Billing settings. Your application creates an authenticated portal session for its own customer's account.",
    "Before live payments, finish Stripe's business verification and review its account restrictions. A successful API-key check is not proof that charges or payouts are enabled."
  ]
}
});
const replicateDefinition = definition("replicate", "Replicate", "Run asynchronous model predictions with an application-owned Replicate token.",
  "https://replicate.com/docs/topics/security/api-tokens", [
    "Select the Replicate user or organization that owns the intended usage, then open account/api-tokens.",
    "Create a token with a name identifying this application and copy its value.",
    "Enter env:REPLICATE_API_TOKEN in API key reference here and save. Choose Set credential in Env, paste the token as the REPLICATE_API_TOKEN value and save it there. Return here and choose Connect / Verify.",
    "No OAuth registration or callback URL is needed. Verification reads the token's account. Connecting never starts a prediction. Explicit prediction operations can incur charges on this Replicate account.",
    "Open the desired model on Replicate, select its API tab and copy the owner/name or version and model-specific input schema. models.get exposes latest_version.openapi_schema. Use models.predict for official models or predictions.create with a version; save the returned prediction ID, then call predictions.get until succeeded, failed or canceled. predictions.cancel requests cancellation.",
    "LIMITATIONS: the app owns polling, job history and result display. Text, image, audio and video outputs are returned unchanged; download needed files before Replicate removes API inputs/outputs, normally after one hour. No built-in media studio, training, deployment administration or automatic editor-tool attachment.",
    "If the token is disabled, create a replacement on the same API tokens page, update Env and reconnect. Disabling a shared token also stops other applications using it."
  ]);
const sentryDefinition = Object.freeze({
  id: "sentry", name: "Sentry", description: "Inspect and triage Sentry issues through scoped MCP tools.",
  accountModes: ["assistant"], authenticationMethods: ["oauth2"],
  scopes: [
    { value: "org:read", label: "Read organization data", recommended: true },
    { value: "project:write", label: "Write project data" },
    { value: "team:write", label: "Write team data" },
    { value: "event:write", label: "Write event data" }
  ],
  settingsSchema: createSchema({
    organizationSlug: { type: "string", required: true, minLength: 1, maxLength: 200,
      validator: (value) => /^[a-z0-9][a-z0-9_-]*$/u.test(value) || "Enter the organization slug from its Sentry URL." },
    projectSlug: { type: "string", minLength: 1, maxLength: 200,
      validator: (value) => /^[a-z0-9][a-z0-9_-]*$/u.test(value) || "Enter the project slug, not its numeric ID or URL." }
  }),
  settingsFields: [
    { name: "organizationSlug", label: "Sentry organization slug", hint: "Copy the organization slug from Sentry's URL. This connection is restricted to that organization." },
    { name: "projectSlug", label: "Sentry project slug (optional)", hint: "Copy the slug from Project Settings to restrict access to one project. Leave empty for the selected organization." }
  ],
  setup: { url: "https://mcp.sentry.dev/", clientRegistrationEndpoint: "https://mcp.sentry.dev/oauth/register", steps: [
    "This is assistant context, not application login or SDK error-reporting setup. Editor coding-assistant attachment is deferred; saving alone does not give Vibe64 chat access to errors.",
    "Open the intended organization in Sentry and copy its slug from the URL. Open the intended project's Settings for its slug. Project scoping is recommended; use slugs rather than display names or numeric IDs.",
    "Enter the exact HTTPS callback served by your backend in Suggested callback URL, then choose Register client and connect. This registers at https://mcp.sentry.dev/oauth/register and saves the client ID in configuration and its secret/callback in development Env. CLI users can call registerSentryClient instead. This is an MCP client, not a Sentry REST OAuth application.",
    "Save configuration and connect. Sign into Sentry and review the selected organization/project and MCP permissions before approving. Tool availability also depends on skills granted in Sentry's consent screen and your account permissions; configuration cannot grant extra access.",
    "Connecting checks tool discovery. Your assistant host must authorize each tool and its exact arguments. Changing organization or project requires a new connection for that resource.",
    "Reconnect when the grant expires or Sentry access changes. Disconnect removes the application's local grant; manage provider-side permissions separately. An application's error-reporting DSN is separate from this management connection."
  ] }
});
const incidentIoDefinition = definition("incident-io", "incident.io", "Manage incidents and follow-ups, resolve alerts, read on-call schedules and maintain catalogue entries.",
  "https://docs.incident.io/admin/api-keys", [
    "In the intended incident.io organization, open Settings > API keys and choose Add API key. Name it for this application. The token is displayed once; copy it privately before leaving.",
    "Choose View data (viewer) for incident verification. Add Create incidents / Edit incidents for writes, View on-call resources for alerts, Read schedules for schedules, and View catalog / Manage catalog for catalogue reads/writes. For follow-ups inspect the permission scopes badge for follow_ups.create and follow_ups.update; for alert resolution it must include alerts.resolve. Grant only the required actions. Restrict team-scoped access to intended teams; you cannot delegate permissions you do not hold.",
    "Enter env:INCIDENT_IO_API_KEY as API key reference and Save configuration. Choose Set credential in Env, save the actual token as INCIDENT_IO_API_KEY, return and choose Connect account. Verification reads incidents without changing them. This mode needs no OAuth client or callback URL.",
    "Creating incidents requires an application idempotency key and explicit public/private visibility; standard incidents may announce in Slack. Edits require an explicit notify_incident_channel choice. Follow-up updates require the current title and target status. Catalogue updates require the intended full attribute values. Your app must authorize each resource and action, retain IDs and reconcile uncertain writes.",
    "Schedule reads use pages of at most 25 so next shifts are included. This is not a rota editor or paging service. Alert sources such as Datadog can require external resolution; a 422 does not mean retry blindly. Private resources require provider permission, even when this form is valid.",
    "This key remains valid if its creator is deactivated. Rotate or revoke it in Settings > API keys, update Env and verify again. Disconnect only removes local state; it does not revoke the key, close incidents or cancel provider workflows. Editor coding-assistant attachment is deferred."
  ]);
const firefliesDefinition = definition("fireflies", "Fireflies", "Read and search Fireflies meetings, speaker-attributed transcripts and summaries.",
  "https://docs.fireflies.ai/fundamentals/authorization", [
    "Sign into Fireflies and open Integrations, then Fireflies API.",
    "Copy the API key privately. It follows this user's account permissions; a team administrator key can include team data. Choose the account appropriate for the application.",
    "Enter env:FIREFLIES_API_KEY as the API key reference and Save configuration. Follow Set credential in Env, store the real key as FIREFLIES_API_KEY, then return here and choose Connect account or Verify again. Check connection reads saved status. Verification reads the account profile; it does not request a recording or join a meeting.",
    "Transcript details include sentences, speakers, summaries and action items. Search defaults to titles and spoken words in meetings this account organized. Empty or unavailable summaries can mean Fireflies has not processed the recording or the plan does not provide them. Your app owns access checks, presentation, caching and follow-up tasks; this does not create recordings or receive webhooks.",
    "Transcript listing defaults to meetings this account organized. The application must authorize broader team access. If verification fails, check the key and account permissions. Replace keys in Env and verify again. Disconnect removes local state; revoke the provider key separately in Fireflies. This API-key setup needs no OAuth callback or app registration."
  ]);

const heygenKeyDefinition = definition("heygen", "HeyGen", "Read your API account profile and browse voice metadata.",
  "https://developers.heygen.com/docs/api-key", [
    "Sign into the intended HeyGen account. Open the API dashboard linked from Provider setup guide and choose the control to generate an API key.",
    "For a restricted key, allow account:read for verification and voices:read for voice listing. Set those permissions in HeyGen; editing this application's configuration cannot grant them. API-key usage and subscription OAuth use different billing arrangements.",
    "Enter env:HEYGEN_API_KEY in API key reference and Save configuration. Choose Set credential in Env, paste the actual key as HEYGEN_API_KEY and save there. Keep this key in backend Env, not browser code.",
    "Return and choose Connect account. Verification reads the account profile without generating media. If HeyGen reports insufficient_api_key_scope, check account:read; voice listing also needs voices:read. No OAuth registration or callback is needed for this API-key mode.",
    "Voice listing returns metadata and pagination. It does not generate speech, clone a voice or create a video. For replacement, manage the key in the HeyGen API dashboard, update Env and verify again. Disconnect removes local state and does not revoke the provider key."
  ]);
const heygenDefinition = Object.freeze({
  ...heygenKeyDefinition,
  description: "Read API profile and voices with a key, or connect HeyGen MCP tools through browser OAuth.",
  authenticationMethods: ["api-key", "oauth2"],
  scopes: [
    { value: "openid", label: "Identify the connected HeyGen account", recommended: true, authenticationMethods: ["oauth2"] },
    { value: "profile", label: "Read account profile", recommended: true, authenticationMethods: ["oauth2"] },
    { value: "email", label: "Read account email", recommended: true, authenticationMethods: ["oauth2"] }
  ],
  setup: { ...heygenKeyDefinition.setup,
    urlByAuthentication: { oauth2: "https://developers.heygen.com/mcp/overview" },
    clientRegistrationEndpoint: "https://api2.heygen.com/v1/oauth/register",
    stepsByAuthentication: { oauth2: [
      "Select Assistant access and OAuth to connect HeyGen MCP. Sign into the HeyGen account whose plan should pay for tool usage. This mode uses browser consent, not an API key; keep the identity, profile and email permissions selected.",
      "Confirm Suggested callback URL is the exact route your host will serve. Choose Register client and connect to create the client and save its ID, secret and callback to project configuration and private development Env. Register once for this host, not on every connection. CLI users can call registerHeyGenClient.",
      "For manual registration, copy the displayed endpoint and JSON body into an HTTP client and send one POST with Content-Type application/json. Copy client_id from the registration response into Client ID and Save configuration. Choose Set credential in Env to save client_secret under the displayed Client secret reference. Choose Set callback in Env and save the exact registered callback. Keep the registration response private.",
      "Return, save and choose Connect account. Sign into HeyGen and approve access. Verification lists available tools without creating media. The host must authorize each tool and its arguments; identity permissions do not restrict tools to reads. Creating media consumes the connected account's credits and some tools delete content.",
      "Reconnect starts consent again. Disconnect removes the local grant; it does not delete videos or undo accepted work. It does not promise provider-wide revocation. Saving configuration alone does not register a client or attach tools to an assistant. Discover available video/avatar/translation tools with tools.list; the host uses their input schemas, polls asynchronous results and obtains approval before chargeable or destructive calls."
    ] }
  }
});
const perplexityDefinition = definition("perplexity", "Perplexity", "Connect your Perplexity key for app-owned cited answers and streaming.",
  "https://docs.perplexity.ai/docs/admin/api-key-management", [
    "Open the Perplexity API console, then Projects. Create or select the project that will own this application's API usage; a project must exist before you can create its first key.",
    "Open API Keys and generate a named key for that project. Copy its full value immediately; it is only shown at creation.",
    "Enter env:PERPLEXITY_API_KEY in API key reference here and save. Choose Set credential in Env, paste the key as the PERPLEXITY_API_KEY value and save it there. Return here and choose Connect account or Verify again; Check connection only reloads status.",
    "No OAuth registration or callback URL is needed. Verification lists asynchronous Sonar requests without submitting a generation request. Listing the public model catalogue alone does not verify your key.",
    "Use the supplied AI-connections perplexity-answer example with this exact saved slot. Your application installs its native client, authorizes the caller and resolves this Env reference before requesting a cited answer or stream. It pays Perplexity directly; there is no Vibe64 inference gateway. The app renders citations and controls spending. LIMITATIONS: no premade research/chat screen, persistent conversation or automatic coding-chat attachment; async history lists only its initial page. For example, fetch a cited answer in your backend, then display it in your app. Never send the key to the browser.",
    "For replacement, create another key and update Env before revoking the old key. A revoked key cannot be recovered."
  ]);
const supabaseDefinition = definition("supabase", "Supabase", "List projects through the Supabase Management API.",
  "https://supabase.com/docs/guides/platform/personal-access-tokens", [
    "Open Supabase account settings, Access Tokens, and generate a personal access token.",
    "Where scoped tokens are available, select the intended resources and project read permission. Classic tokens carry your full account access.",
    "Copy the token into Env and save its reference here. Project publishable, anon and service-role keys are different credentials.",
    "The runtime lists project metadata. This does not add a database to the editor or execute SQL."
  ]);

const paddleDefinition = Object.freeze({
  ...definition("paddle", "Paddle", "Read and create Paddle Billing products and prices in sandbox or live mode.",
    "https://developer.paddle.com/api-reference/about/authentication", [
      "Sign into the Paddle Billing account that owns this application's catalogue. Use its sandbox account for testing and live account for production. Open Developer tools → Authentication → API keys → New API key.",
      "Enter a name and description identifying this application. Grant product.read for connection verification and catalogue reads. Also grant product.write to create products and price.write to create prices when your application needs those operations. Editing webhook destinations also needs notification_setting.write; reading domain approval needs checkout_domain.read. Set an expiry. Enable Rotatable only if you plan to configure key rotation; that choice cannot be changed later. Click Save and copy the key immediately because it is shown only once.",
      "Select the matching Environment here: Sandbox for a sandbox key, Live for a live key. Keep env:PADDLE_API_KEY in API key reference, Save configuration, then choose Set credential in Env and save the copied key as PADDLE_API_KEY. This must be a backend Billing API key, not a Paddle.js client-side token or Paddle Classic credential. No OAuth registration or callback is needed for API-key mode.",
      "If configuring application payments, also grant price.read, customer.write, transaction.read, transaction.write, subscription.read and customer_portal_session.write, alongside product.read, product.write and price.write. These cover the current payment library's catalogue, checkout, reconciliation and portal calls. A successful product check does not verify these additional permissions. Webhook signing uses the destination's separate secret, not the API key.",
      "Return and choose Connect account. Verification reads products without creating a checkout or charging anyone. An empty catalogue can be valid. If permission is denied, check product.read, key expiry and that the key belongs to the selected environment. The application controls which users may use its shared merchant connection.",
      "Changing Environment requires verifying the connection again with the corresponding key. Configure separate connections and Env references when retaining both environments. Keep backend keys out of browser code, configuration JSON and chat.",
      "If a key is lost or exposed, revoke it in Paddle and create a replacement, update Env and reconnect. Disconnect here removes the local grant only; revoke provider access separately in Paddle's API keys tab. This adapter verifies catalogue access; checkout, webhooks and merchant go-live setup remain separate application work."
    ]),
  paymentSetup: {
  "url": "https://developer.paddle.com/get-started/quickstart/",
  "steps": [
    "Open the matching Paddle sandbox or live account. Follow the connection's API-key instructions, including the permissions needed for products, prices, customers, transactions, subscriptions and customer portal sessions.",
    "Open Developer Tools → Notifications and create a notification destination for the suggested webhook URL. Subscribe to transaction.completed and subscription lifecycle events. Store that destination's signing secret using Set signing secret in Env.",
    "Open Developer Tools → Authentication → Client-side tokens → New client-side token. Name it for your app, save, and copy it using Set public client token in Env above. Your application supplies this value to its Paddle.js page. This public token is different from the private API key.",
    "The billing URL must open an app page with Paddle.js initialized for the same environment. Its checkout opens the transaction from the URL. Configure this as your default payment link and obtain live domain approval before selling.",
    "Complete Paddle's business and website verification. Check approval in Paddle; saving a key or listing products does not approve the merchant or domain."
  ]
},
  assistantActions: [
    { value: "enable", label: "Enable Paddle" },
    { value: "provider.recommend", label: "Recommend payment provider" },
    { value: "products.create", label: "Create product with price" },
    { value: "products.batchCreate", label: "Batch create products with prices" },
    { value: "prices.create", label: "Create price" },
    { value: "goLive.check", label: "Check go-live status" },
    { value: "api.read", label: "Read Paddle API" },
    { value: "api.write", label: "Write Paddle API" },
    { value: "webhooks.update", label: "Edit webhook" }
  ],
  settingsSchema: createSchema({ environment: { type: "string", enum: ["sandbox", "live"], defaultTo: "sandbox" } }),
  settingsFields: [{ name: "environment", label: "Environment", hint: "Use the environment that issued this API key.",
    items: [{ title: "Sandbox", value: "sandbox" }, { title: "Live", value: "live" }] }]
});
const mailgunDefinition = Object.freeze({
  ...definition("mailgun", "Mailgun", "Send transactional email, manage sending domains and inspect delivery logs.",
    "https://help.mailgun.com/hc/en-us/articles/26016288026907-API-Key-Roles", [
      "Sign into the intended Mailgun account as an administrator. In the top-right profile menu, choose API Security. Under Mailgun API Keys, choose Add new key; do not select the public verification key or webhook signing key.",
      "Enter a description for this application and choose Developer for sending and domain management, or Analyst only for read-only access, then Create Key. Free/Basic accounts may offer only Admin. Copy the secret from the creation dialog now: it is shown only once. If lost, create a replacement key.",
      "Enter env:MAILGUN_API_KEY in API key reference. Set API region to United States or European Union according to where your sending domains are hosted. Domain Sending Keys and SMTP passwords cannot perform this account domain-listing check.",
      "Save configuration, choose Set credential in Env, and store the actual account key as MAILGUN_API_KEY. Return and choose Connect account. This connects the application's shared Mailgun account; no OAuth app registration or callback is needed.",
      "Verification reads the selected region's domain list. It sends no messages, configures no DNS, and does not prove that a domain is ready to send. An empty list can mean the account has no domains in that region. Changing region requires verification again.",
      "Before sending, open Send > Sending > Domains > Add new domain in Mailgun. Add the exact sending DNS records shown under Domain Verification & DNS at your DNS host, then verify the domain. Choose a sender at that domain in your app. Sandbox domains only send to authorized recipients; queued does not mean delivered.",
      "The app can send text/HTML with messages.send and inspect logs.list by sending domain. Keep the queued message ID, show actual delivery/failure events, and use an app-owned bounded polling schedule. If sending times out, check logs before manually repeating the request; there is no automatic resend.",
      "LIMITATIONS: no attachments, stored templates, mailing-list/campaign UI, inbound routes or webhook receiver. Example: send and track a receipt email, but not attach its PDF through this adapter. The app owns sender/recipient authorization, content and duplicate prevention. Connecting does not attach Mailgun tools to Vibe64 coding chat.",
      "To change a key's role, create a new key, replace MAILGUN_API_KEY in Env and verify again; roles on existing keys cannot be edited. Disconnect removes the local connection. Delete an obsolete key in Mailgun separately to revoke its provider access."
    ]),
  settingsSchema: createSchema({ region: { type: "string", enum: ["us", "eu"], defaultTo: "us" } }),
  settingsFields: [{ name: "region", label: "API region", hint: "Select the region containing your sending domains.",
    items: [{ title: "United States (api.mailgun.net)", value: "us" }, { title: "European Union (api.eu.mailgun.net)", value: "eu" }] }]
});

const fireworksAiDefinition = definition("fireworks-ai", "Fireworks AI", "List accounts accessible to your Fireworks API key.",
  "https://docs.fireworks.ai/getting-started/quickstart", [
    "Sign into Fireworks. Open the Provider setup guide and follow its Fireworks dashboard link to API Keys; you can also open your profile icon > User Settings > API Keys.",
    "Choose Create API key, then copy the generated key for this application and keep it private. The Provider setup guide links to the account's API Keys page.",
    "Enter env:FIREWORKS_API_KEY in API key reference here and save. Choose Set credential in Env, paste the key as the FIREWORKS_API_KEY value and save it there. Return here and choose Check connection.",
    "No OAuth registration or callback URL is needed. Verification lists accounts available to the key; it does not generate text or create deployments. An empty list does not grant access to an account.",
    "If you revoke or replace the key in Fireworks, update its Env value and check the connection again."
  ]);
const gatewayApiDefinition = Object.freeze({
  ...definition("gatewayapi", "GatewayAPI", "Send SMS/RCS messages and read account credit on the Global or EU platform.",
    "https://gatewayapi.com/help-center/webhooks-and-api-keys/", [
      "Sign into the intended GatewayAPI Global or EU account and open API, then API Keys in the left menu.",
      "Choose ADD API KEY, name the credential, and copy its API token into Env.",
      "Choose the matching API domain here. The runtime uses the token, not an OAuth key/secret pair.",
      "Enter env:GATEWAYAPI_TOKEN as the API key reference, then Save configuration. Follow Set credential in Env and save the real API token as GATEWAYAPI_TOKEN. Return here and choose Connect account or Verify again. Check connection reads saved status. Verification reads account credit without sending a message; changing domain requires verification again.",
      "Sending uses the current Messaging API. RCS requires an approved agent configured in GatewayAPI; delivery can fall back to SMS. Check sender eligibility, account credit and destination restrictions before sending. Urgent SMS can cost more. Every message needs your application reference to match delivery events.",
      "For delivery reports or replies, create a public HTTPS webhook in your app and configure it in the matching GatewayAPI dashboard with a secret. Current Messaging API callbacks use Signature: v1=... over the raw body (not legacy X-Gwapi-Signature JWT). Save events once by event_id before acknowledging; the app owns its inbox and delivery history. Incoming SMS also requires a leased number/keyword; RCS requires agent setup.",
      "If verification fails, check that the token matches the selected Global or EU account and any configured IP restrictions permit the application server. Replace a rotated token in Env and verify again before revoking the old token in API Keys. Disconnect removes local connection state only. No OAuth callback or webhook is needed for this balance check."
    ]),
  settingsSchema: createSchema({ region: { type: "string", enum: ["global", "eu"], defaultTo: "global" } }),
  settingsFields: [{ name: "region", label: "API domain", hint: "Select the platform that issued this token.",
    items: [{ title: "Global (gatewayapi.com)", value: "global" }, { title: "EU (gatewayapi.eu)", value: "eu" }] }]
});
const polarDefinition = Object.freeze({
  ...definition("polar", "Polar", "Read your organization's Polar product catalogue.",
    "https://polar.sh/docs/integrate/oat", [
      "Open Settings for the intended Polar organization, scroll to Developers and choose New Token.",
      "Give the token a name and expiry, select products:read, and copy its value into Env.",
      "Choose the matching sandbox or production environment. Organization and customer access tokens are different credentials.",
      "Save the reference. The runtime verifies product reads; it does not create a checkout or enable merchant payments."
    ]),
  settingsSchema: createSchema({ environment: { type: "string", enum: ["sandbox", "production"], defaultTo: "sandbox" } }),
  settingsFields: [{ name: "environment", label: "Environment", hint: "Use the environment containing this organization and token.",
    items: [{ title: "Sandbox", value: "sandbox" }, { title: "Production", value: "production" }] }]
});

const storyblokDefinition = Object.freeze({
  ...definition("storyblok", "Storyblok", "Read space metadata and published or draft content in the space's region.",
    "https://www.storyblok.com/docs/concepts/access-tokens", [
      "Select the intended Storyblok space and open Settings, then Access Tokens.",
      "Create a named Public token for published content, or a Preview token when this application needs draft content.",
      "Copy the token into Env and select the space's region here. Management API personal tokens are different credentials.",
      "Save its reference, for example env:STORYBLOK_TOKEN. There is no OAuth client or callback. Connect verifies space access; an empty content list does not prove draft permission.",
      "For a public site, use a Public token and published content. Keep Preview tokens in a separate backend integration and require editor authorization before draft reads; never expose preview responses in public caches.",
      "Your app maps page slugs to story reads and renders its own components. It owns pagination, cache refresh after publishing and preview access. Saving this configuration does not create a website or attach the Vibe64 coding assistant.",
      "If verification fails, check the token type and space region, then reconnect after correcting Env. Disconnect removes the app connection; delete a token in Storyblok Settings → Access Tokens when it must stop working everywhere."
    ]),
  settingsSchema: createSchema({ region: { type: "string", enum: ["eu", "us", "ca", "ap", "cn"], defaultTo: "eu" } }),
  settingsFields: [{ name: "region", label: "Space region", hint: "Match the region selected when the Storyblok space was created.",
    items: [
      { title: "European Union (EU)", value: "eu" }, { title: "United States (US)", value: "us" },
      { title: "Canada (CA)", value: "ca" }, { title: "Australia / APAC (AP)", value: "ap" },
      { title: "China (CN)", value: "cn" }
    ] }]
});

const ashbyDefinition = definition("ashby", "Ashby", "Read hiring data, maintain candidate profiles and advance sourced applications.",
  "https://docs.ashbyhq.com/how-do-i-generate-an-api-key", [
    "As an Ashby Organization Admin, open Admin > Integrations > API Keys and choose + New.",
    "Name the key for this application, leave the optional integration partner unset, and choose Create API Key. Keys initially have no endpoint permissions: select Jobs read (jobsRead) for verification. Add Candidates read (candidatesRead) for candidates/applications and Candidates write (candidatesWrite) for profile edits, sourcing and stage changes. Add Interviews read (interviewsRead) for interview-plan/stage lookup and Hiring Process read (hiringProcessMetadataRead) for archive reasons.",
    "These endpoint permissions do not require all other access. Leave additional permissions off unless you need confidential jobs; those require Allow access to confidential jobs and projects. Choose Save and Continue and copy the key before closing the wizard.",
    "Enter env:ASHBY_API_KEY in API key reference here and save. Choose Set credential in Env, paste the key as the ASHBY_API_KEY value and save it there. Return here and choose Connect account or Verify again. Check connection only reads current status.",
    "No OAuth registration or callback URL is needed. Verification lists jobs without creating candidates or changing hiring stages. This organization key serves an administrator-approved hiring workflow; it is not an applicant login or public careers form. For missing_endpoint_permission, reopen the key, correct Jobs read and Save. A key that was not copied must be replaced. To rotate, create a replacement and update Env before verifying. To revoke, open the old key by name and click Disable; Disconnect only removes the application connection."
  ]);
const lexwareDefinition = definition("lexware", "Lexware", "Read accounting contacts, articles and vouchers, and create net-EUR draft invoices.",
  "https://help.lexware.de/de-form/articles/548863-alles-rund-um-public-api", [
    "You need Lexware Office XL for Public API access. In the intended account, open Erweiterungen > Weitere Apps > Public API, or app.lexware.de/addons/public-api.",
    "Choose API-Schlüssel erstellen and the individual-permissions option. Enable reading contacts for verification. Add article and accounting-document read permissions for those operations; allow invoice creation only if the app will create drafts.",
    "Choose WEITER, review the permissions, name the key for this application and choose API-Schlüssel erstellen. Copy the key before closing; it cannot be displayed again.",
    "Enter env:LEXWARE_API_KEY in API key reference here and save. Choose Set credential in Env, paste the key as the LEXWARE_API_KEY value and save it there. Return here and choose Connect account or Verify again. Check connection only refreshes status.",
    "Draft invoices require an existing contact UUID, invoice and service/delivery dates with timezones, and custom lines with quantity, unit, net EUR amount and tax rate. Choose those accounting values in the app; the connector does not infer tax. Review and finalize drafts in Lexware. No email or payment is sent.",
    "An interrupted invoice creation may already have succeeded. Check the voucher list before repeating it. Respect the provider limit of two requests per second across endpoints. The app must authorize each contact/document and approve writes before calling the connector.",
    "This adapter does not create contacts/articles/vouchers, download PDFs, finalize invoices, upload receipts or receive accounting events. For example, it can prepare a draft booking invoice for an existing customer, but receipt intake and signed event processing need native app implementation. Editor-assistant attachment is deferred.",
    "No OAuth registration or callback URL is needed. Verification reads contacts. Keys expire after at most 24 months: create a replacement and update Env before expiry. Public API does not mean the key is safe to publish."
  ]);
const sevdeskDefinition = Object.freeze({
  ...definition("sevdesk", "Sevdesk", "Read sevdesk contact organizations and people with offset pagination.",
    "https://hilfe.sevdesk.de/de/articles/9374740-wo-finde-ich-meinen-api-token-in-sevdesk", [
    "In the intended sevdesk account, open Erweiterungen > Integrationen and locate API-Token für Integrationen.",
    "Choose Einblenden and enter your sevdesk account password. Copy the displayed API token. Depending on your plan, Erweiterungen > API also offers Einblenden.",
    "Enter env:SEVDESK_API_TOKEN in API token reference here and save. Choose Set credential in Env, paste the token as the SEVDESK_API_TOKEN value and save it there. Return here and choose Check connection.",
    "No OAuth registration or callback URL is needed. Paste only the token, without adding Bearer. Verification reads contacts without modifying accounting data.",
    "This token belongs to its sevdesk user. Naming another configuration does not create a separate provider account or change the token's access."
    ]),
  apiKeyReferenceLabel: "API token reference"
});

const apolloIoDefinition = definition("apollo-io", "Apollo.io", "Find prospects, enrich selected records and manage your sales contacts, accounts and deals.",
  "https://docs.apollo.io/docs/create-api-key", [
    "API access depends on your Apollo plan. In the intended workspace, open Settings > Integrations > API Keys, then API Keys > Create new key.",
    "Enter a name and description. Keep api/v1/accounts/search enabled for verification. Add only the permitted endpoints needed by your app: api/v1/mixed_people/api_search for prospect people, api/v1/mixed_companies/search for companies, api/v1/people/match and api/v1/organizations/enrich for enrichment. Keep Set as master key off when endpoint permissions suffice.",
    "For saved CRM records, select api/v1/contacts/search, api/v1/contacts/create and api/v1/contacts/update as needed; api/v1/accounts/create and api/v1/accounts/update for company writes. Deals use deals/api/v1/opportunities/search, /create and /update; stage lookup uses deals/api/v1/opportunity_stages/index. Owner lookup uses api/v1/users/search. These permissions must also be available on your plan; do not broaden a key automatically after a denial.",
    "Choose Create API key, then Copy. Enter env:APOLLO_API_KEY in API key reference here and save. Choose Set credential in Env, paste the value as APOLLO_API_KEY and save it there. Return here and choose Connect account or Verify again. Check connection only reads current status.",
    "Verification reads saved accounts; it does not enrich, write CRM records or spend enrichment credits. Company prospect searches and enrichment can consume credits when your app invokes them. Review current Apollo pricing and require explicit approval or an administrator-authorized usage policy in your app.",
    "No OAuth registration or callback URL is needed. This key acts for the Apollo workspace, not an individual end user's account. Keys in that workspace share its limits. To replace access, regenerate the key and update Env before verifying again. Disconnect removes the local connection; delete the key on Apollo's API keys page to revoke provider access."
  ]);
const attentionDefinition = definition("attention", "Attention", "Read conversations and coaching results; manage call metadata, snippets, users and teams.",
  "https://docs.attention.com/api-authentication", [
    "Sign into app.attention.tech as an organization administrator. Open your profile avatar at the top left, Settings, then Organization > API Keys.",
    "Choose + Create API Key at the top right and give it a name identifying this application. Copy the value in API Key Created before closing; it is shown once.",
    "Enter env:ATTENTION_API_KEY in API key reference here and save. Choose Set credential in Env, paste the key as the ATTENTION_API_KEY value and save it there. Return here and choose Connect account (or Verify again when already connected). Check connection only reloads status.",
    "An organization key can expose broad read/write and user-management access. Your application must restrict each operation to authorized users; never publish this key in frontend code. New users require an explicit listener or recording seat choice; check your Attention plan before enabling provisioning.",
    "No OAuth registration or callback URL is needed. Verification reads a conversation page without changing recordings or CRM data.",
    "To replace access, create a new key and update Env, then verify before opening the old key's three-dot menu and choosing Delete. Deletion immediately stops every application still using that old key. Disconnect here removes the local grant only; revoke the key in Attention to stop provider access."
  ]);

const telegramDefinition = Object.freeze({
  ...definition("telegram", "Telegram", "Send bot messages and receive updates through application-owned polling.",
    "https://core.telegram.org/bots/tutorial", [
      "In Telegram, open the verified BotFather account and send /newbot. Choose a display name and an available username ending in bot.",
      "Copy the token returned by BotFather. Enter env:TELEGRAM_BOT_TOKEN in Bot token reference here and save. Choose Set credential in Env, paste the token as the TELEGRAM_BOT_TOKEN value and save it there.",
      "Return here and choose Check connection. Verification reads the bot identity; it does not consume messages. No OAuth client or callback URL is needed for this bot-token connection. Receiving updates through a webhook is a separate application setup.",
      "Start a conversation with the bot or add it to the intended group. Bot permissions and privacy settings control available messages; verification is not permission to message arbitrary users.",
      "For polling, first check that no webhook is configured. Use one app worker and save update offsets after successful processing. Verification never polls; disconnect does not revoke the bot token or discard updates.",
      "Use separate bots for independent public and paid application identities. Replacing a token for the same bot does not create another bot."
    ]),
  apiKeyReferenceLabel: "Bot token reference"
});
const klipyDefinition = definition("klipy", "KLIPY", "Browse clips, GIFs, stickers and existing AI emojis using your own KLIPY app key.",
  "https://klipy.com/blog/klipy-partner-panel", [
    "Sign into KLIPY Partner Panel and choose Add Platform. Enter the platform name, contact email, company website and product description, then accept the API terms and submit.",
    "Follow the key-creation flow, give the key an application-specific name and enter App URL when available. Copy the resulting test key. The application owner chooses any optional advertising settings in KLIPY separately.",
    "Enter env:KLIPY_APP_KEY in API key reference and Save configuration. Choose Set credential in Env, paste the key as KLIPY_APP_KEY and save there. Return here and choose Connect account. No OAuth client or callback URL is required.",
    "Verification fetches trending clip metadata with the high content filter and consumes an API request. It does not download or publish media, approve production access or implement the app's media picker. A content filter does not guarantee suitability for every audience.",
    "Test keys allow 100 calls per hour. For production, open the key's three-dot menu > Request Production. Supply the app category, estimated monthly active users and a screen recording (up to 25 MB), then Apply. Wait for KLIPY's approval; connecting here does not grant production capacity.",
    "The app builds its own media picker. Use Search KLIPY as the search placeholder; preserve returned media URLs and delivery data. Render media directly with appropriate image/video controls and follow KLIPY attribution, ranking, reporting and advertising requirements. No picker or ad renderer is generated by this connection.",
    "KLIPY requires prior approval for custom server-side requests, proxying or caching. Contact developers@klipy.com about this backend integration before production. Do not create a media cache or silently discard ad items. Production key approval and integration approval are provider decisions.",
    "Existing AI emoji search is available; new AI emoji generation, callbacks, share/report analytics and editor-assistant attachment are not implemented. For example, an app can find a dog sticker, but cannot generate a new dog emoji through this adapter.",
    "If replacing a key, update KLIPY_APP_KEY in Env and verify again before retiring the previous key in KLIPY. Disconnect only removes local connection state. The application must follow the provider's attribution and content requirements."
  ]);

const clayDefinition = Object.freeze({
  ...definition("clay", "Clay", "Search people and companies, run enrichment routines and query Enterprise tables with your Clay Public API key.",
    "https://developers.clay.com/public-api/authentication", [
    "Open Clay Settings > Account > API keys (beta). Create a Public API key for the intended user and workspace. The older Clay workspace API key is a different credential.",
    "Copy the new key. Enter env:CLAY_PUBLIC_API_KEY in Public API key reference here and save. Choose Set credential in Env, paste the key as CLAY_PUBLIC_API_KEY and save it there. Return here and choose Connect account or Verify again. Check connection only refreshes local status.",
    "No OAuth registration or callback URL is needed. Verification reads the authenticated user and workspace without starting a search. This is not app-user login.",
    "Search creation and next-page requests are explicit operations and can consume provider capacity. Approve the query and result volume before using them. Pages advance a stateful iterator, so an interrupted next-page request must not be retried automatically.",
    "Routine runs can spend Clay credits. In Clay, open Functions > select your function > Details > enable API. Copy its t_... function ID and prefix it with function:. Use the inputs defined by that function. Approve the routine, inputs and volume before running it. A returned in_progress run ID is not a finished enrichment: fetch results later and inspect each item for errors. Never automatically repeat an uncertain run.",
    "Table queries require Clay Enterprise. Open the target table and copy the ID after /tables/ in its URL. There is no public list-tables API. Use that ID with selected fields and filters; preserve cursors and deduplicate records by ID during concurrent edits. A truncated result without a cursor requires a narrower query.",
    "Search filters use the current query-mode reference. The legacy filters-mode API is deprecated. Vibe64 saves this connection configuration; automatically attaching Clay tools to the coding assistant remains unavailable.",
    "To replace the key, create another Public API key, update Env and verify before retiring the previous key. Disconnect removes local state, not the key in Clay."
    ]),
  apiKeyReferenceLabel: "Public API key reference"
});

const tokenDefinitions = Object.freeze([
  airtableDefinition, notionDefinition, brevoDefinition, elevenlabsDefinition, githubApiDefinition, apifyDefinition,
  calendlyDefinition, hubspotDefinition, linearDefinition, pipedriveDefinition, gitlabApiDefinition, tallyDefinition, contentfulDefinition, asanaDefinition,
  stripeDefinition, replicateDefinition, sentryDefinition, incidentIoDefinition, firefliesDefinition,
  heygenDefinition, perplexityDefinition, supabaseDefinition, paddleDefinition, mailgunDefinition,
  fireworksAiDefinition, gatewayApiDefinition, polarDefinition, storyblokDefinition,
  ashbyDefinition, lexwareDefinition, sevdeskDefinition, apolloIoDefinition, attentionDefinition, telegramDefinition, klipyDefinition, clayDefinition
]);
export {
  airtableDefinition, notionDefinition, brevoDefinition, elevenlabsDefinition, githubApiDefinition, apifyDefinition,
  calendlyDefinition, hubspotDefinition, linearDefinition, pipedriveDefinition, gitlabApiDefinition, tallyDefinition, contentfulDefinition, asanaDefinition,
  stripeDefinition, replicateDefinition, sentryDefinition, incidentIoDefinition, firefliesDefinition,
  heygenDefinition, perplexityDefinition, supabaseDefinition, paddleDefinition, mailgunDefinition,
  fireworksAiDefinition, gatewayApiDefinition, polarDefinition, storyblokDefinition,
  ashbyDefinition, lexwareDefinition, sevdeskDefinition, apolloIoDefinition, attentionDefinition, telegramDefinition, klipyDefinition,
  clayDefinition, tokenDefinitions
};
