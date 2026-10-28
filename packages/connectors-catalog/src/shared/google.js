import { createSchema } from "json-rest-schema";
const scope = (name) => name.startsWith("https:") ? name : `https://www.googleapis.com/auth/${name}`;
function definition(id, name, api, description, recommended, permissions, verificationFields = [], setupNotes = []) {
  return Object.freeze({
    id, name, description, verificationFields,
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

const gmailDefinition = definition("gmail", "Gmail", "Gmail API", "jskit.connectors.gmail.description", ["gmail.readonly", "gmail.send", "gmail.compose", "gmail.modify"], [
  ["gmail.readonly", "jskit.connectors.gmail.scopes.gmailReadonly.label", true], ["gmail.send", "jskit.connectors.gmail.scopes.gmailSend.label"], ["gmail.compose", "jskit.connectors.gmail.scopes.gmailCompose.label"],
  ["gmail.modify", "jskit.connectors.gmail.scopes.gmailModify.label"], ["gmail.labels", "jskit.connectors.gmail.scopes.gmailLabels.label"], ["gmail.metadata", "jskit.connectors.gmail.scopes.gmailMetadata.label"],
  ["gmail.insert", "jskit.connectors.gmail.scopes.gmailInsert.label"], ["gmail.settings.basic", "jskit.connectors.gmail.scopes.gmailSettingsBasic.label"], ["gmail.settings.sharing", "jskit.connectors.gmail.scopes.gmailSettingsSharing.label"],
  ["https://mail.google.com/", "jskit.connectors.gmail.scopes.httpsMailGoogleCom.label"],
  ["gmail.addons.current.message.readonly", "jskit.connectors.gmail.scopes.gmailAddonsCurrentMessageReadonly.label"], ["gmail.addons.current.message.action", "jskit.connectors.gmail.scopes.gmailAddonsCurrentMessageAction.label"],
  ["gmail.addons.current.message.metadata", "jskit.connectors.gmail.scopes.gmailAddonsCurrentMessageMetadata.label"], ["gmail.addons.current.action.compose", "jskit.connectors.gmail.scopes.gmailAddonsCurrentActionCompose.label"]
], [], [
  "For inbox reading, retain Read messages (gmail.readonly) and deselect optional sending or editing permissions your application does not use. Gmail read access is restricted: check Google's restricted-scope review and server-data security assessment requirements before public release.",
  "Read messages gives full bodies, search and attachments. Send messages permits sending; Manage drafts and send messages permits drafts; Read and modify messages permits marking read, archiving and moving mail to trash. Adding permission requires reconnecting. Connect only reads the mailbox profile and never sends or edits mail.",
  "The app builds MIME messages with its framework, renders mail safely and authorizes each mailbox user. A send receipt is not proof of delivery. No automatic retry occurs after an uncertain send; check Sent before retrying. No background sync or permanent-delete operation is supplied.",
  "Leave Manage sharing settings unselected: its operations require a Workspace service account with domain-wide delegation, which this Web application connection does not configure. Add-on permissions apply only to an actual Gmail add-on; they do not replace mailbox permissions."
]);
const googleDriveDefinition = definition("google-drive", "Google Drive", "Google Drive API", "jskit.connectors.googleDrive.description", ["drive.file", "drive.appdata", "drive.appfolder", "drive.readonly"], [
  ["drive.metadata.readonly", "jskit.connectors.googleDrive.scopes.driveMetadataReadonly.label"], ["drive.file", "jskit.connectors.googleDrive.scopes.driveFile.label", true], ["drive.readonly", "jskit.connectors.googleDrive.scopes.driveReadonly.label"],
  ["drive", "jskit.connectors.googleDrive.scopes.drive.label"], ["drive.metadata", "jskit.connectors.googleDrive.scopes.driveMetadata.label"], ["drive.appdata", "jskit.connectors.googleDrive.scopes.driveAppdata.label"],
  ["drive.appfolder", "jskit.connectors.googleDrive.scopes.driveAppfolder.label"],
  ["drive.apps.readonly", "jskit.connectors.googleDrive.scopes.driveAppsReadonly.label"], ["drive.meet.readonly", "jskit.connectors.googleDrive.scopes.driveMeetReadonly.label"],
  ["drive.photos.readonly", "jskit.connectors.googleDrive.scopes.drivePhotosReadonly.label"], ["drive.scripts", "jskit.connectors.googleDrive.scopes.driveScripts.label"],
  ["drive.activity", "jskit.connectors.googleDrive.scopes.driveActivity.label"], ["drive.activity.readonly", "jskit.connectors.googleDrive.scopes.driveActivityReadonly.label"]
], [], [
  "Select only the file access your application needs. With drive.file, users must select or open files through your application's file-picker flow, or the application must create them. Pasting an existing file ID alone does not grant access. App-data permissions do not grant access to ordinary Drive files.",
  "The app can upload files up to 5 MB and download/export up to 8 MiB with this adapter. Google Docs/Sheets/Slides require export to a supported MIME type; ordinary stored files use download. Larger or resumable transfers need the framework's native client.",
  "Use file capabilities and sharing access before offering writes. Uploading with an existing file ID replaces its content and name; moving a file to trash is an explicit metadata update. The app owns file selection, safe rendering and ambiguous-transfer reconciliation. No sync service or embedded Google Picker is installed.",
  "Broad Drive read or management permissions are restricted scopes. Review Google's verification and server-data security assessment requirements before public release. An empty file list with drive.file can mean no files have yet been shared with this application."
]);
const drivePermissions = [["drive.file", "jskit.connectors.google.scopes.driveFile.label"], ["drive.readonly", "jskit.connectors.google.scopes.driveReadonly.label"], ["drive", "jskit.connectors.google.scopes.drive.label"]];
const googleSheetsDefinition = definition("google-sheets", "Google Sheets", "Google Sheets API", "jskit.connectors.googleSheets.description", "drive.file", [
  ["spreadsheets.readonly", "jskit.connectors.googleSheets.scopes.spreadsheetsReadonly.label"], ["spreadsheets", "jskit.connectors.googleSheets.scopes.spreadsheets.label"],
  ["drive.metadata.readonly", "jskit.connectors.googleSheets.scopes.driveMetadataReadonly.label"], ...drivePermissions
], [{ name: "spreadsheetId", required: false, label: "jskit.connectors.googleSheets.verificationFields.spreadsheetId.label", hint: "jskit.connectors.googleSheets.verificationFields.spreadsheetId.hint" }], [
  "For create-first access, retain Access files selected for this application (drive.file) and also enable Google Drive API in APIs & Services > Library. Leave Spreadsheet ID blank: verification reads accessible Drive metadata and accepts an empty list. It does not create a spreadsheet or prove Sheets API is enabled.",
  "With drive.file, the app can create and edit its own spreadsheets. An existing file needs Google Picker or an app-open grant; pasting an ID alone does not grant access. For spreadsheets.readonly-only or spreadsheets-only access, supply an accessible Spreadsheet ID. Adding write permissions requires reconnecting.",
  "Value writes default to RAW so untrusted strings are not interpreted as formulas. Choose USER_ENTERED explicitly for formulas and locale-dependent parsing. Ranges use A1 notation; quote sheet titles with spaces. Appending finds the next row in the table, not necessarily the requested start cell; uncertain writes are never automatically retried.",
  "The app can create spreadsheets, update or append rows, clear values, and send bounded native batch requests for sheets and formatting. Clear preserves formatting. The app owns conflict handling, file selection and its data UI; this form installs neither a spreadsheet editor nor editor-assistant tools."
]);
const googleDocsDefinition = definition("google-docs", "Google Docs", "Google Docs API", "jskit.connectors.googleDocs.description", "drive.file", [
  ["documents.readonly", "jskit.connectors.googleDocs.scopes.documentsReadonly.label"], ["documents", "jskit.connectors.googleDocs.scopes.documents.label"], ...drivePermissions
], [{ name: "documentId", required: false, label: "jskit.connectors.googleDocs.verificationFields.documentId.label", hint: "jskit.connectors.googleDocs.verificationFields.documentId.hint" }], [
  "For create-first access, retain Access files selected for this application (drive.file) and also enable Google Drive API in APIs & Services > Library. Leave Document ID blank: connection checks accessible Drive metadata and accepts an empty list; it does not create a document or prove Docs API is enabled.",
  "With drive.file the app can create and edit its own documents. For existing files, use Google Picker or an app-open flow to grant this application access; pasting an ID alone does not grant access. Picker wiring belongs to the app.",
  "For documents.readonly-only or documents-only access, supply an accessible Document ID for verification. Manage documents enables writing documents accessible to the account; adding permissions requires reconnecting. Broad Drive permissions can require restricted-scope review.",
  "Create a blank document, then insert content with documents.batchUpdate. The app owns tab IDs, UTF-16 text indices, formatting requests and revision conflict handling. No editor-assistant attachment or visual document editor is installed by this form."
]);
const googleSlidesDefinition = definition("google-slides", "Google Slides", "Google Slides API", "jskit.connectors.googleSlides.description", "drive.file", [
  ["presentations.readonly", "jskit.connectors.googleSlides.scopes.presentationsReadonly.label"], ["presentations", "jskit.connectors.googleSlides.scopes.presentations.label"],
  ["spreadsheets.readonly", "jskit.connectors.googleSlides.scopes.spreadsheetsReadonly.label"], ["spreadsheets", "jskit.connectors.googleSlides.scopes.spreadsheets.label"], ...drivePermissions
], [{ name: "presentationId", required: false, label: "jskit.connectors.googleSlides.verificationFields.presentationId.label", hint: "jskit.connectors.googleSlides.verificationFields.presentationId.hint" }], [
  "For create-first access, retain Access files selected for this application (drive.file) and enable Google Drive API as well as Google Slides API in APIs & Services > Library. Leave Presentation ID blank: verification reads Drive metadata and accepts an empty list; it neither creates a deck nor proves Slides API is enabled.",
  "The app can create and edit its own decks with drive.file. Existing decks need an app-open or Google Picker grant; a pasted ID alone is insufficient. For presentations.readonly-only or presentations-only access, supply an accessible Presentation ID. Additional permissions require reconnecting; spreadsheet permissions alone do not grant deck access.",
  "Create a blank presentation, then use native batch requests to add slides, text, images or formatting. The app owns object IDs, positions, linked-chart access and revision conflict handling. Images must be reachable by Google; thumbnails return temporary URLs that should not be logged or stored as permanent public assets.",
  "No slide designer, template catalogue, embedded Picker or editor-assistant attachment is installed. Copying, sharing, exporting or deleting the whole deck uses the separate Drive API. An uncertain create or edit is not automatically retried."
]);
const googleSearchConsoleDefinition = definition("google-search-console", "Google Search Console", "Google Search Console API", "jskit.connectors.googleSearchConsole.description", "webmasters.readonly", [
  ["webmasters.readonly", "jskit.connectors.googleSearchConsole.scopes.webmastersReadonly.label"], ["webmasters", "jskit.connectors.googleSearchConsole.scopes.webmasters.label"],
  ["siteverification", "jskit.connectors.googleSearchConsole.scopes.siteverification.label"],
  ["siteverification.verify_only", "jskit.connectors.googleSearchConsole.scopes.siteverificationVerifyOnly.label"]
], [], [
  "The connecting Google account needs access to the intended Search Console property. A property owner can open that property, choose Settings > Users and permissions > Add user, enter the account email, choose the appropriate role and save.",
  "To add a property, open Search Console > property selector > Add property. Domain properties require your DNS provider's TXT record; URL-prefix properties offer verification methods such as an HTML file or tag. Follow Google's displayed instructions and Verify, or have an existing owner add this account. An OAuth grant does not verify domain ownership.",
  "Search performance uses finalized Pacific-time dates and top rows, not a complete traffic export. URL inspection reports Google's indexed snapshot, not a live page test or request for indexing. Use the exact property identifier returned by the connection.",
  "To submit or remove sitemaps, select Manage Search Console properties (webmasters), add the scope in Data Access and reconnect. The app must serve a real sitemap URL first. Submission does not create the file, guarantee indexing or change DNS; deletion removes its Search Console entry, not the hosted file.",
  "Keep Read Search Console properties for the initial check, which lists accessible properties. Site Verification permissions alone do not authorize that check or create property access. An empty result can mean this Google account has no properties."
]);
const googleAnalyticsDefinition = Object.freeze({
  id: "google-analytics", name: "Google Analytics", description: "jskit.connectors.googleAnalytics.description",
  configurationOnly: true,
  accountModes: ["shared"], authenticationMethods: ["none"], scopes: [],
  authenticationLabels: { none: "jskit.connectors.googleAnalytics.authenticationLabels.none" },
  authenticationHint: "jskit.connectors.googleAnalytics.authenticationHint",
  settingsSchema: createSchema({ measurementId: {
    type: "string", required: true, minLength: 3, maxLength: 64,
    validator: (value) => /^G-[A-Z0-9]+$/u.test(value) || "Enter the GA4 web stream Measurement ID beginning G-."
  } }),
  settingsFields: [{ name: "measurementId", label: "jskit.connectors.googleAnalytics.fields.measurementId.label", required: true,
    hint: "jskit.connectors.googleAnalytics.fields.measurementId.hint" }],
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
const bigqueryDefinition = Object.freeze({ ...definition("bigquery", "BigQuery", "BigQuery API", "jskit.connectors.bigquery.description", "bigquery", [
  ["bigquery.readonly", "jskit.connectors.bigquery.scopes.bigqueryReadonly.label"], ["bigquery", "jskit.connectors.bigquery.scopes.bigquery.label"],
  ["cloud-platform.read-only", "jskit.connectors.bigquery.scopes.cloudPlatformReadOnly.label"], ["cloud-platform", "jskit.connectors.bigquery.scopes.cloudPlatform.label"]
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
  settingsFields: [{ name: "projectId", label: "jskit.connectors.bigquery.fields.projectId.label", required: true,
    hint: "jskit.connectors.bigquery.fields.projectId.hint" }]
});
const googleDefinitions = Object.freeze([gmailDefinition, googleDriveDefinition, googleSheetsDefinition, googleDocsDefinition, googleSlidesDefinition, googleSearchConsoleDefinition, googleAnalyticsDefinition, bigqueryDefinition]);
export { gmailDefinition, googleDriveDefinition, googleSheetsDefinition, googleDocsDefinition, googleSlidesDefinition, googleSearchConsoleDefinition, googleAnalyticsDefinition, bigqueryDefinition, googleDefinitions };
