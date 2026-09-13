import { createSchema } from "json-rest-schema";
const scope = (name) => name.startsWith("https:") ? name : `https://www.googleapis.com/auth/${name}`;
function definition(id, name, api, description, recommended, permissions, verificationFields = [], setupNotes = []) {
  return Object.freeze({
    id, name, description, verificationFields, categories: ["Google", "Productivity"],
    accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
    scopes: permissions.map(([value, label, required = false]) => ({ value: scope(value), label,
      recommended: Array.isArray(recommended) ? recommended.includes(value) : value === recommended, ...(required ? { required: true } : {}) })),
    setup: {
      url: "https://developers.google.com/identity/protocols/oauth2/web-server",
      steps: [
        `In Google Cloud, select the project for this application. Open APIs & Services > Library, search for ${api}, open it and choose Enable.`,
        "Open Google Auth Platform > Branding. If setup has not started, choose Get Started; enter the app name, support email and contact email, choose the audience, review the policy and finish with Create.",
        "Choose External if people outside your Google Workspace organization will connect. During testing, open Audience > Test users > Add users, enter the allowed Google accounts and Save. Internal is only for your organization. External Testing refresh tokens for these API permissions expire after seven days; reconnect during testing. Public release also requires completing the applicable Google review.",
        "For an external app, open Data Access > Add or Remove Scopes. Add the permissions selected in this integration and Save. Sensitive or restricted scopes can require Google verification before public use; creating a client does not complete that review.",
        ...setupNotes,
        "Open Clients > Create Client. Choose Web application and name it. Under Authorized redirect URIs, choose Add URI and paste the application callback shown here, then Create. The editor dashboard URL is not the callback.",
        "Copy the Client ID into this form and copy or download the full client secret immediately; Google only shows it at creation. Save configuration, then use Set credential in Env to put the secret value in the variable named by Client secret reference. If lost, open Clients, select this client and Add Secret; save the new value before disabling the old secret.",
        "Use Set callback in Env to save the same application callback URL. If a Configured callback URL is shown, preserve it unless intentionally changing both Env and Google. Scheme, path, case and trailing slash must match exactly.",
        "For a shared account, return here and check or connect the account once the application runtime is ready. For per-user connections, each person authorizes inside your application. Saving this registration neither connects every user nor installs the callback route."
      ]
    }
  });
}

const gmailDefinition = definition("gmail", "Gmail", "Gmail API", "Read and search mail, manage drafts and labels, and explicitly send messages.", ["gmail.readonly", "gmail.send", "gmail.compose", "gmail.modify"], [
  ["gmail.readonly", "Read messages", true], ["gmail.send", "Send messages"], ["gmail.compose", "Manage drafts and send messages"],
  ["gmail.modify", "Read and modify messages"], ["gmail.labels", "Manage labels"], ["gmail.metadata", "Read message headers and labels"],
  ["gmail.insert", "Insert messages"], ["gmail.settings.basic", "Manage basic mail settings"], ["gmail.settings.sharing", "Manage sharing settings"],
  ["https://mail.google.com/", "Full mailbox access including permanent deletion"],
  ["gmail.addons.current.message.readonly", "Read the current add-on message"], ["gmail.addons.current.message.action", "Act on the current add-on message"],
  ["gmail.addons.current.message.metadata", "Read the current add-on message headers"], ["gmail.addons.current.action.compose", "Compose from an add-on"]
], [], [
  "For inbox reading, retain Read messages (gmail.readonly) and deselect optional sending or editing permissions your application does not use. Gmail read access is restricted: check Google's restricted-scope review and server-data security assessment requirements before public release.",
  "Read messages gives full bodies, search and attachments. Send messages permits sending; Manage drafts and send messages permits drafts; Read and modify messages permits marking read, archiving and moving mail to trash. Adding permission requires reconnecting. Connect only reads the mailbox profile and never sends or edits mail.",
  "The app builds MIME messages with its framework, renders mail safely and authorizes each mailbox user. A send receipt is not proof of delivery. No automatic retry occurs after an uncertain send; check Sent before retrying. No background sync or permanent-delete operation is supplied.",
  "Leave Manage sharing settings unselected: its operations require a Workspace service account with domain-wide delegation, which this Web application connection does not configure. Add-on permissions apply only to an actual Gmail add-on; they do not replace mailbox permissions."
]);
const googleDriveDefinition = definition("google-drive", "Google Drive", "Google Drive API", "Find files, upload and download content, and manage basic file metadata.", ["drive.file", "drive.appdata", "drive.appfolder", "drive.readonly"], [
  ["drive.metadata.readonly", "Read file metadata"], ["drive.file", "Manage files selected for this application", true], ["drive.readonly", "Read and download files"],
  ["drive", "Manage all Drive files"], ["drive.metadata", "Manage file metadata"], ["drive.appdata", "Manage application data"],
  ["drive.appfolder", "Manage this application’s Drive folder data"],
  ["drive.apps.readonly", "Read installed Drive apps"], ["drive.meet.readonly", "Read Meet-created files"],
  ["drive.photos.readonly", "Read photos"], ["drive.scripts", "Manage Apps Script files"],
  ["drive.activity", "Read and add file activity"], ["drive.activity.readonly", "Read file activity"]
], [], [
  "Select only the file access your application needs. With drive.file, users must select or open files through your application's file-picker flow, or the application must create them. Pasting an existing file ID alone does not grant access. App-data permissions do not grant access to ordinary Drive files.",
  "The app can upload files up to 5 MB and download/export up to 8 MiB with this adapter. Google Docs/Sheets/Slides require export to a supported MIME type; ordinary stored files use download. Larger or resumable transfers need the framework's native client.",
  "Use file capabilities and sharing access before offering writes. Uploading with an existing file ID replaces its content and name; moving a file to trash is an explicit metadata update. The app owns file selection, safe rendering and ambiguous-transfer reconciliation. No sync service or embedded Google Picker is installed.",
  "Broad Drive read or management permissions are restricted scopes. Review Google's verification and server-data security assessment requirements before public release. An empty file list with drive.file can mean no files have yet been shared with this application."
]);
const drivePermissions = [["drive.file", "Access files selected for this application"], ["drive.readonly", "Read Drive files"], ["drive", "Manage Drive files"]];
const googleSheetsDefinition = definition("google-sheets", "Google Sheets", "Google Sheets API", "Create spreadsheets, read and write ranges, and apply native batch updates.", "drive.file", [
  ["spreadsheets.readonly", "Read spreadsheets"], ["spreadsheets", "Manage spreadsheets"],
  ["drive.metadata.readonly", "Read Drive file metadata (does not grant spreadsheet content access)"], ...drivePermissions
], [{ name: "spreadsheetId", required: false, label: "Spreadsheet ID (optional)", hint: "Leave blank for create-first access with drive.file and Drive API enabled. Otherwise copy the ID between /spreadsheets/d/ and /edit, not the gid tab number; the account and app must have access." }], [
  "For create-first access, retain Access files selected for this application (drive.file) and also enable Google Drive API in APIs & Services > Library. Leave Spreadsheet ID blank: verification reads accessible Drive metadata and accepts an empty list. It does not create a spreadsheet or prove Sheets API is enabled.",
  "With drive.file, the app can create and edit its own spreadsheets. An existing file needs Google Picker or an app-open grant; pasting an ID alone does not grant access. For spreadsheets.readonly-only or spreadsheets-only access, supply an accessible Spreadsheet ID. Adding write permissions requires reconnecting.",
  "Value writes default to RAW so untrusted strings are not interpreted as formulas. Choose USER_ENTERED explicitly for formulas and locale-dependent parsing. Ranges use A1 notation; quote sheet titles with spaces. Appending finds the next row in the table, not necessarily the requested start cell; uncertain writes are never automatically retried.",
  "The app can create spreadsheets, update or append rows, clear values, and send bounded native batch requests for sheets and formatting. Clear preserves formatting. The app owns conflict handling, file selection and its data UI; this form installs neither a spreadsheet editor nor editor-assistant tools."
]);
const googleDocsDefinition = definition("google-docs", "Google Docs", "Google Docs API", "Create documents, read tabs and edit content with native batch requests.", "drive.file", [
  ["documents.readonly", "Read documents"], ["documents", "Manage documents"], ...drivePermissions
], [{ name: "documentId", required: false, label: "Document ID (optional)", hint: "Leave blank for create-first access with drive.file and Drive API enabled. To verify an existing document, copy its ID between /document/d/ and /edit; the account and this app must have access." }], [
  "For create-first access, retain Access files selected for this application (drive.file) and also enable Google Drive API in APIs & Services > Library. Leave Document ID blank: connection checks accessible Drive metadata and accepts an empty list; it does not create a document or prove Docs API is enabled.",
  "With drive.file the app can create and edit its own documents. For existing files, use Google Picker or an app-open flow to grant this application access; pasting an ID alone does not grant access. Picker wiring belongs to the app.",
  "For documents.readonly-only or documents-only access, supply an accessible Document ID for verification. Manage documents enables writing documents accessible to the account; adding permissions requires reconnecting. Broad Drive permissions can require restricted-scope review.",
  "Create a blank document, then insert content with documents.batchUpdate. The app owns tab IDs, UTF-16 text indices, formatting requests and revision conflict handling. No editor-assistant attachment or visual document editor is installed by this form."
]);
const googleSlidesDefinition = definition("google-slides", "Google Slides", "Google Slides API", "Create and edit presentations, read pages and obtain preview thumbnails.", "drive.file", [
  ["presentations.readonly", "Read presentations"], ["presentations", "Manage presentations"],
  ["spreadsheets.readonly", "Read linked spreadsheets"], ["spreadsheets", "Manage linked spreadsheets"], ...drivePermissions
], [{ name: "presentationId", required: false, label: "Presentation ID (optional)", hint: "Leave blank for create-first access with drive.file and Drive API enabled. Otherwise copy the ID between /presentation/d/ and /edit; this is not a slide object ID. The account and app must have access." }], [
  "For create-first access, retain Access files selected for this application (drive.file) and enable Google Drive API as well as Google Slides API in APIs & Services > Library. Leave Presentation ID blank: verification reads Drive metadata and accepts an empty list; it neither creates a deck nor proves Slides API is enabled.",
  "The app can create and edit its own decks with drive.file. Existing decks need an app-open or Google Picker grant; a pasted ID alone is insufficient. For presentations.readonly-only or presentations-only access, supply an accessible Presentation ID. Additional permissions require reconnecting; spreadsheet permissions alone do not grant deck access.",
  "Create a blank presentation, then use native batch requests to add slides, text, images or formatting. The app owns object IDs, positions, linked-chart access and revision conflict handling. Images must be reachable by Google; thumbnails return temporary URLs that should not be logged or stored as permanent public assets.",
  "No slide designer, template catalogue, embedded Picker or editor-assistant attachment is installed. Copying, sharing, exporting or deleting the whole deck uses the separate Drive API. An uncertain create or edit is not automatically retried."
]);
const googleSearchConsoleDefinition = definition("google-search-console", "Google Search Console", "Google Search Console API", "Query search performance, inspect indexed URLs and manage sitemaps.", "webmasters.readonly", [
  ["webmasters.readonly", "Read Search Console properties"], ["webmasters", "Manage Search Console properties"],
  ["siteverification", "Manage website ownership through Site Verification"],
  ["siteverification.verify_only", "Verify new website ownership through Site Verification"]
], [], [
  "The connecting Google account needs access to the intended Search Console property. A property owner can open that property, choose Settings > Users and permissions > Add user, enter the account email, choose the appropriate role and save.",
  "To add a property, open Search Console > property selector > Add property. Domain properties require your DNS provider's TXT record; URL-prefix properties offer verification methods such as an HTML file or tag. Follow Google's displayed instructions and Verify, or have an existing owner add this account. An OAuth grant does not verify domain ownership.",
  "Search performance uses finalized Pacific-time dates and top rows, not a complete traffic export. URL inspection reports Google's indexed snapshot, not a live page test or request for indexing. Use the exact property identifier returned by the connection.",
  "To submit or remove sitemaps, select Manage Search Console properties (webmasters), add the scope in Data Access and reconnect. The app must publish a real sitemap URL first. Submission does not create the file, guarantee indexing or change DNS; deletion removes its Search Console entry, not the hosted file.",
  "Keep Read Search Console properties for the initial check, which lists accessible properties. Site Verification permissions alone do not authorize that check or create property access. An empty result can mean this Google account has no properties."
]);
const googleAnalyticsDefinition = Object.freeze({
  id: "google-analytics", name: "Google Analytics", description: "Configure website tracking with your public GA4 Measurement ID.",
  categories: ["Google", "Marketing"], configurationOnly: true,
  accountModes: ["shared"], authenticationMethods: ["none"], scopes: [],
  authenticationLabels: { none: "Public configuration · no credentials" },
  authenticationHint: "Your application loads the Google tag. This does not grant access to Analytics reports.",
  settingsSchema: createSchema({ measurementId: {
    type: "string", required: true, minLength: 3, maxLength: 64,
    validator: (value) => /^G-[A-Z0-9]+$/u.test(value) || "Enter the GA4 web stream Measurement ID beginning G-."
  } }),
  settingsFields: [{ name: "measurementId", label: "Measurement ID", required: true,
    hint: "Public: this value will be visible in your published application. Copy it from your GA4 web stream." }],
  setup: {
    url: "https://support.google.com/analytics/answer/9304153",
    steps: [
      "Sign into Google Analytics and select this application's GA4 property. You need Editor or higher access at property level. If you need a new account or property, follow the Provider setup guide first.",
      "Open Admin > Data collection and modification > Data streams, then the Web tab and the application's stream. If none exists, choose Add stream > Web, enter the application website URL and stream name, review enhanced measurement and choose Create stream.",
      "Copy the Measurement ID beginning G- from Stream details into Measurement ID here and save. Use the web stream's measurement identifier, not its numeric property ID or a Google Ads identifier.",
      "No OAuth client, API key, Env secret or callback URL is needed. This identifier is public and does not grant access to Analytics reports.",
      "Ask your application's framework to install the Google tag using this setting, respecting existing tracking and consent behavior. Saving this configuration does not install tracking or verify event delivery.",
      "Choose one tracking owner: an existing Google tag/Tag Manager, or the optional JSKIT browser helper. Do not install both. For manual SPA page views, turn off Page changes based on browser history events in the web stream’s Enhanced measurement settings as well as automatic page-view sending in code.",
      "The app decides consent before loading tracking and calls page views on completed navigation. For conversions, emit an event such as generate_lead and mark it as a key event in Analytics Admin > Data display > Events. Never send email addresses, message text or sensitive URL parameters.",
      "Removing this configuration disables tracking after the app’s next configuration reload or deployment; already-loaded pages need cleanup or reload. It does not erase historical Analytics data."
    ]
  }
});
const bigqueryDefinition = Object.freeze({ ...definition("bigquery", "BigQuery", "BigQuery API", "Configure the query project, run queries and retrieve results.", "bigquery", [
  ["bigquery.readonly", "Read BigQuery data and metadata"], ["bigquery", "Manage BigQuery data"],
  ["cloud-platform.read-only", "Read Google Cloud resources"], ["cloud-platform", "Manage Google Cloud resources"]
], [], [
  "In the project that will run queries, open IAM & Admin > IAM > Grant access. Add the connecting Google account and grant BigQuery Job User when it must create query jobs. OAuth consent alone does not grant project or dataset access.",
  "In BigQuery Studio, select the intended dataset in Explorer, choose Sharing > Permissions > Add principal, and grant only the needed dataset role, such as BigQuery Data Viewer for reading data and metadata. A dataset administrator must make this grant. Repeat for any source dataset the authorized queries use.",
  "Enter the execution and billing project ID below. Dataset/table discovery uses that configured project; use a separate integration slot to browse another project. Your app must set the query location and a maximum bytes billed limit when needed, and authorize each job before inspecting or cancelling it.",
  "Connect only lists accessible projects; it does not run a billable query or prove table access. Cancellation is a request, not a guarantee that execution or charges stopped; inspect job status afterwards."
]),
  settingsSchema: createSchema({ projectId: {
    type: "string", required: true, minLength: 6, maxLength: 30,
    validator: (value) => /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(value) || "Enter the Google Cloud project ID, not its number or URL."
  } }),
  settingsFields: [{ name: "projectId", label: "Google Cloud project ID", required: true,
    hint: "The project that runs and is billed for queries. It can differ from the project containing your datasets. The initial connection check only lists accessible projects." }]
});
const googleDefinitions = Object.freeze([gmailDefinition, googleDriveDefinition, googleSheetsDefinition, googleDocsDefinition, googleSlidesDefinition, googleSearchConsoleDefinition, googleAnalyticsDefinition, bigqueryDefinition]);
export { gmailDefinition, googleDriveDefinition, googleSheetsDefinition, googleDocsDefinition, googleSlidesDefinition, googleSearchConsoleDefinition, googleAnalyticsDefinition, bigqueryDefinition, googleDefinitions };
