import { createSchema } from "json-rest-schema";

function definition(id, name, description, permission, label, organizationOnly = false, verificationFields = []) {
  const authority = organizationOnly ? "organizations" : "common";
  const audiences = organizationOnly ? ["organizations"] : ["common", "organizations", "consumers"];
  return Object.freeze({
    id, name, description, verificationFields, categories: ["Microsoft", "Productivity"],
    accountModes: ["shared", "per-user", "assistant"], authenticationMethods: ["oauth2"],
    scopes: [
      { value: permission, label, recommended: true },
      { value: "offline_access", label: "Keep access when you are away", recommended: true }
    ],
    settingsSchema: createSchema({
      tenantId: { type: "string", maxLength: 36, defaultTo: authority,
        validator: (value) => audiences.includes(value) || /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(value) ||
          `Use ${audiences.join(", ")} or your Directory (tenant) ID as a GUID.` }
    }),
    settingsFields: [{ name: "tenantId", label: "Directory (tenant) ID", placeholder: authority,
      hint: `Use ${authority} for the default audience, or the directory GUID for a single-tenant app. This is not the Application (client) ID.` }],
    setup: {
      url: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
      steps: [
        "In Microsoft Entra admin center, select the directory that owns your app. Open Entra ID > App registrations > New registration.",
        organizationOnly
          ? "Choose Multiple Entra ID tenants. This connector requires a work or school account."
          : "Choose Any Entra ID Tenant + Personal Microsoft accounts for this connector's common sign-in endpoint.",
        "For a single-tenant registration, choose Single tenant only and copy Directory (tenant) ID into this form. The selected audience must match your app registration.",
        "Register the app. Under Authentication, add a Web platform with the exact callback URL served by your backend.",
        `Under API permissions, add Microsoft Graph delegated ${permission} and offline_access permissions. Tenant policy may require administrator consent.`,
        "Copy Application (client) ID into this form. Under Certificates & secrets, create a client secret and store its Value in the referenced Env variable.",
        "Store the callback URL in its Env variable, then save configuration. The runtime requests consent and verifies the selected operation."
      ]
    }
  });
}

const microsoftOutlookDefinition = Object.freeze({
  ...definition("microsoft-outlook", "Microsoft Outlook", "Read messages and files, send text mail, manage read/folder state and calendar appointments.", "Mail.Read", "Read your mail"),
  scopes: [
    { value: "Mail.Read", label: "Read your mail", required: true, recommended: true },
    { value: "Mail.ReadWrite", label: "Read and write your mail", recommended: true },
    { value: "Mail.Send", label: "Send mail as you", recommended: true },
    { value: "Mail.ReadBasic", label: "Read basic mail properties" },
    { value: "Calendars.Read", label: "Read your calendars" },
    { value: "Calendars.ReadWrite", label: "Read and write your calendars", recommended: true },
    { value: "offline_access", label: "Keep access when you are away", recommended: true }
  ],
  setup: {
    url: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
    steps: [
      "In Microsoft Entra admin center → Entra ID → App registrations → New registration, name the application. For common, choose accounts in any organizational directory and personal Microsoft accounts. For single tenant, choose this directory only and enter its Directory (tenant) ID. Select Register and copy Application (client) ID into Client ID.",
      "Under Authentication → Redirect URI configuration → Add Redirect URI, choose Web, paste this project's exact Suggested callback URL and select Configure. The generated backend must serve that callback. Directory (tenant) ID identifies the directory, not the application.",
      "Under API permissions → Add a permission → Microsoft Graph → Delegated permissions, add Mail.Read and offline_access. Add any other permissions selected here. For reading only, clear optional write, send and calendar choices. Mail.ReadBasic is a narrower provider permission, but does not replace this connector's required Mail.Read. Directory policy may require administrator consent.",
      "Under Certificates & secrets → Client secrets → New client secret, add a description and expiry, then Add. Copy Value immediately, not Secret ID. Use env:MICROSOFT_OUTLOOK_CLIENT_SECRET and env:MICROSOFT_OUTLOOK_CALLBACK_URL as references. Store secret values in Env rather than these fields.",
      "Save configuration, then use Set credential in Env for the secret and Open Env for the exact registered callback. Connect account authorizes the shared mailbox-owning account for this project. Per-user mode lets each generated-app user connect their own mailbox; connecting the builder does not connect everyone. Application login is separate.",
      "The account needs an accessible mailbox. Verification lists root folders. messages.get requests text bodies; attachments.list/get reads file attachments. Treat message content as untrusted and sanitize any returned HTML before display. Reading mail needs Mail.Read; setting read state or moving a message needs Mail.ReadWrite.",
      "messages.send needs Mail.Send and sends plain text to 1–20 approved recipients as the connected account, saving Sent Items. Accepted means queued, not delivered. Approve recipients/content before sending; inspect Sent Items before retrying an uncertain send. messages.move returns the moved message's new ID; retain it.",
      "calendars.list and events.list require Calendars.Read or Calendars.ReadWrite. events.create requires Calendars.ReadWrite and explicit UTC start/end with end after start. It creates a personal appointment without attendees or invitations. App login, mailbox consent and calendar consent are separate concerns.",
      "LIMITATIONS: no email-client UI, outgoing attachments, replies/drafts, shared-mailbox delegation, recurrence, meeting invitations or editor tool attachment. File-attachment reads are bounded to about 5 MB; larger and embedded-item attachments need native Graph wiring. Example: send a receipt and create a calendar appointment, but do not receive an Outlook replacement.",
      "Rotate expiring secrets in Env before removing the old secret. Reconnect after consent or permission changes. Disconnect removes the project's local grant; Microsoft account or directory application-permission controls manage provider consent separately."
    ]
  }
});
const microsoftOneDriveDefinition = Object.freeze({
  ...definition("microsoft-onedrive", "Microsoft OneDrive", "Browse folders, obtain file downloads and upload small files.", "Files.Read", "Read your files"),
  scopes: [
    { value: "Files.Read", label: "Read your files", required: true, recommended: true },
    { value: "Files.Read.All", label: "Read all files you can access", recommended: true },
    { value: "Files.ReadWrite", label: "Read and write your files", recommended: true },
    { value: "Files.ReadWrite.All", label: "Read and write all files you can access" },
    { value: "Files.ReadWrite.AppFolder", label: "Read and write files in the application's folder" },
    { value: "offline_access", label: "Keep access when you are away", recommended: true }
  ],
  setup: {
    url: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
    steps: [
      "In Microsoft Entra admin center → Entra ID → App registrations → New registration, name the application. For common, select accounts in any organizational directory and personal Microsoft accounts. For single tenant, select this directory only and use its Directory (tenant) ID instead. Select Register.",
      "Copy Application (client) ID from Overview into Client ID. Directory (tenant) ID identifies the directory, not the app. Under Authentication → Redirect URI configuration → Add Redirect URI, choose Web, paste this project's exact Suggested callback URL and select Configure. The generated backend must serve that callback.",
      "Under API permissions → Add a permission → Microsoft Graph → Delegated permissions, add Files.Read and offline_access. Match any additional selected permissions. All permissions cover files the user can access beyond their own files; write permissions allow changes. For listing only, clear the optional read-all and write choices. Directory policy may require administrator consent.",
      "Under Certificates & secrets → Client secrets → New client secret, add a description and expiry, then Add. Copy Value immediately, not Secret ID. Use env:MICROSOFT_ONEDRIVE_CLIENT_SECRET as the secret reference and env:MICROSOFT_ONEDRIVE_CALLBACK_URL as the callback reference. Secret values belong in Env, not these reference fields.",
      "Save configuration, then use Set credential in Env for the secret and Open Env for the exact registered callback URL. Connect account authorizes the shared account for this project; each app user connects inside the generated app in per-user mode. This connector does not establish application login.",
      "Use an account with OneDrive already provisioned. Verification only lists its drive root. Browse folders with items.list(folderId), then items.get for metadata and a short-lived download URL. That URL grants file access: send it only to the authorized app user, never log/cache it, and download without forwarding the Microsoft Authorization header. Folder metadata has no download URL.",
      "files.upload needs Files.ReadWrite, a parent folder ID, file name and Base64 content up to 5 MB. Its conflict behavior defaults to fail; explicitly approve replace before overwriting. Do not retry uncertain uploads automatically: inspect the folder first.",
      "LIMITATIONS: larger/resumable transfers use your framework's native Graph upload-session client. No file manager, sharing editor, app-folder automation or Vibe64 tool attachment is supplied. Example: upload a small report and provide its download link; a multi-gigabyte video needs native transfer wiring.",
      "Replace expiring client secrets in Env before removing the old secret. Reconnect after consent or permission changes. Disconnect removes the project's local grant; remove Microsoft consent separately through the account or directory's application-permission controls."
    ]
  }
});
const microsoftExcelDefinition = Object.freeze({
  ...definition("microsoft-excel", "Microsoft Excel", "Browse workbooks and read or update bounded cell ranges with explicit sessions.", "Files.Read", "Read your files"),
  scopes: [
    { value: "Files.Read", label: "Read your files", required: true, recommended: true },
    { value: "Files.ReadWrite", label: "Read and write your files (required by Excel worksheets)", recommended: true },
    { value: "Files.Read.All", label: "Read all files you can access" },
    { value: "Files.ReadWrite.All", label: "Read and write all files you can access" },
    { value: "offline_access", label: "Keep access when you are away", recommended: true }
  ],
  setup: {
    url: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
    steps: [
      "Sign into Microsoft Entra admin center → Entra ID → App registrations → New registration. Name your application. For common, choose accounts in any organizational directory and personal Microsoft accounts; for a single directory, choose single tenant and use its Directory (tenant) ID instead.",
      "Select Register. Copy Application (client) ID from Overview into Client ID. Under Authentication → Redirect URI configuration → Add Redirect URI, choose Web, paste this project's exact Suggested callback URL and select Configure. The generated application's backend must serve that address.",
      "Under API permissions → Add a permission → Microsoft Graph → Delegated permissions, add Files.Read and offline_access. Add Files.ReadWrite for worksheet access, even when only reading worksheets. The optional All permissions cover broader file access; select them only when needed. Directory policy may require an administrator's consent.",
      "Under Certificates & secrets → Client secrets → New client secret, choose a description and expiry, then Add. Copy Value immediately, not Secret ID. Use env:MICROSOFT_EXCEL_CLIENT_SECRET as the secret reference and env:MICROSOFT_EXCEL_CALLBACK_URL as the callback reference; never paste the secret into the reference field.",
      "Save configuration. Use Set credential in Env to store the secret and Open Env to store the same callback URL you registered. For a shared connection, Connect account authorizes the account this project will use; for per-user access, each application user connects inside the generated app. This does not create your application's login session.",
      "Verification lists the signed-in user's drive root without requiring a workbook ID or changing files. Your app can browse folders using items.list and pass a workbook's returned id to worksheets.list. Worksheet access needs Files.ReadWrite and a supported accessible workbook; successful connection alone does not prove either.",
      "After selecting a workbook and worksheet, ranges.get reads a bounded A1 address such as A1:B2. ranges.update writes an exactly matching matrix of values OR formulas, up to 10,000 cells. A null cell leaves its existing value unchanged. Your app must approve the target and content before writing; the form itself never edits cells.",
      "For repeated operations, sessions.create requires an explicit persistChanges choice: true saves edits, false uses a temporary copy. Pass the returned sessionId to each range call and close it with sessions.close. Use a work or school account for sessions; Microsoft does not support personal accounts for session close. Without a session, edits persist. Do not automatically repeat a write after a timeout; inspect the workbook first.",
      "LIMITATIONS: no workbook creation, charts, pivot tables, formatting editor or asynchronous session polling. Example: update a budget range and formula, but do not receive a spreadsheet designer. Application login and Vibe64 assistant tool attachment remain separate.",
      "Replace expiring client secrets in Env before deleting the old secret. Reconnect when consent expires or permissions change. Disconnect removes the project's local grant; Microsoft consent remains until removed through the account or directory's application-permission controls."
    ]
  }
});
const microsoftTeamsDefinition = Object.freeze({
  ...definition("microsoft-teams", "Microsoft Teams", "Browse teams/channels and read or send channel and existing-chat messages.", "Team.ReadBasic.All", "List joined teams", true),
  scopes: [
    { value: "Team.ReadBasic.All", label: "List joined teams", required: true, recommended: true },
    { value: "Channel.ReadBasic.All", label: "List channels in teams", required: true, recommended: true },
    { value: "User.Read", label: "Read user profile", required: true, recommended: true },
    { value: "ChannelMessage.Send", label: "Send messages to channels", recommended: true },
    { value: "ChannelMessage.Read.All", label: "Read channel messages" },
    { value: "Chat.ReadWrite", label: "Read and send chat messages" },
    { value: "User.Read.All", label: "Read all users' full profiles", recommended: true },
    { value: "offline_access", label: "Keep access when you are away", recommended: true }
  ],
  setup: {
    url: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
    steps: [
      "In Microsoft Entra admin center → Entra ID → App registrations → New registration, name the application and choose accounts in any organizational directory. Select Register and copy Application (client) ID into Client ID. Keep organizations as tenant, or choose single tenant and enter its Directory (tenant) ID. This connector requires a work or school account with Teams access; personal Microsoft accounts are unsupported.",
      "Under Authentication → Redirect URI configuration → Add Redirect URI, choose Web, paste this project's exact Suggested callback URL and select Configure. The generated backend must serve this callback. Directory (tenant) ID identifies the directory, not the application.",
      "Open API permissions → Add a permission → Microsoft Graph → Delegated permissions. Add Team.ReadBasic.All, Channel.ReadBasic.All, User.Read and offline_access, plus any optional permissions selected here. For listing teams only, clear optional channel-send and all-user-profile access. The form retains channel/profile read choices; the current teams.list operation uses only Team.ReadBasic.All. Tenant policy and some permissions require administrator consent.",
      "Open Certificates & secrets → Client secrets → New client secret, enter a description and expiry, then Add. Copy Value immediately, not Secret ID. Keep env:MICROSOFT_TEAMS_CLIENT_SECRET and env:MICROSOFT_TEAMS_CALLBACK_URL as references; store their actual values in Env.",
      "Save configuration, then use Set credential in Env for the secret and Open Env for the registered callback. Connect account authorizes the shared account for this project. In per-user mode, each generated-app user connects separately. Connecting the builder does not connect everyone; application login is separate.",
      "Verification lists teams where the signed-in account is a direct member. An empty list can be valid, and access to a shared channel does not necessarily include its host team. Use channels.list for a selected team. Reading messages/replies needs ChannelMessage.Read.All; sending needs ChannelMessage.Send. Enable the chosen permission in Entra and this form, obtain any administrator consent, then reconnect.",
      "messages.list and replies.list read channel conversations; messages.send and replies.send send plain text to the explicitly selected channel/thread. Existing chats use chats.list, chatMessages.list and chatMessages.send with Chat.ReadWrite. The app must approve each destination and message; do not retry uncertain sends automatically. Sanitize returned HTML before display.",
      "LIMITATIONS: no team/chat creation, membership changes, message edits/deletion, attachments, meeting bot or Vibe64 tool attachment. Example: read a channel and post an approved status update, but do not receive a Teams client or automatic team administration. Profile-read consent does not create a user-directory feature.",
      "Rotate expiring secrets in Env before deleting the old secret. Reconnect after consent or permission changes. Disconnect removes local grants; Microsoft account or directory application-permission controls manage provider consent separately."
    ]
  }
});
const microsoftOneNoteDefinition = Object.freeze({
  ...definition("microsoft-onenote", "Microsoft OneNote", "Browse notebooks and pages, read content, and create or append text notes.", "Notes.Read", "Read your notebooks"),
  scopes: [
    { value: "Notes.Read", label: "Read your notebooks", required: true, recommended: true },
    { value: "Notes.Read.All", label: "Read notebooks you can access in your organization", recommended: true },
    { value: "Notes.ReadWrite.All", label: "Read and modify notebooks you can access in your organization", recommended: true },
    { value: "Notes.Create", label: "Create pages in OneNote notebooks", recommended: true },
    { value: "Notes.ReadWrite", label: "Read and modify your notebooks", recommended: true },
    { value: "offline_access", label: "Keep access when you are away", recommended: true }
  ],
  setup: {
    url: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
    steps: [
      "In Microsoft Entra admin center → Entra ID → App registrations → New registration, name your application. For common, choose accounts in any organizational directory and personal Microsoft accounts. For single tenant, choose this directory only and use its Directory (tenant) ID. Select Register and copy Application (client) ID into Client ID.",
      "Under Authentication → Redirect URI configuration → Add Redirect URI, choose Web, paste this project's exact Suggested callback URL and select Configure. The generated application's backend must serve that address. Directory (tenant) ID is the directory identifier, not the Application (client) ID.",
      "Under API permissions → Add a permission → Microsoft Graph → Delegated permissions, add Notes.Read and offline_access. Match any optional permissions selected here. For listing only, clear all optional notebook permissions. Personal Microsoft accounts must clear both organization-wide All permissions; those require work or school accounts. Tenant policy may require administrator consent.",
      "Open Certificates & secrets → Client secrets → New client secret, enter a description and expiry, then Add. Copy Value immediately, not Secret ID. Keep env:MICROSOFT_ONENOTE_CLIENT_SECRET and env:MICROSOFT_ONENOTE_CALLBACK_URL as references; put the actual secret and registered callback in Env.",
      "Save configuration, then use Set credential in Env for the secret and Open Env for the callback. Connect account authorizes the shared account this project will use. In per-user mode, each user connects inside the generated application. OneNote authorization does not create your application's login session.",
      "Verification lists the signed-in user's notebooks without creating a notebook or changing pages. Browse notebooks, sections and pages with notebooks.list, sections.list and pages.list; pages.content returns HTML up to 1 MiB. The app must sanitize HTML before rendering it, or show it as plain text. Use an account with access to the notebooks your application needs.",
      "To create a note, add Notes.Create (or Notes.ReadWrite), reconnect, then call pages.create with a section ID, title and plain text. To append text to an existing page, add Notes.ReadWrite and call pages.append with its page ID and text. Text is escaped, not treated as HTML. Approve the destination and content before writes; inspect the page before retrying an uncertain result.",
      "LIMITATIONS: no rich-text editor, binary attachments, page replacement/deletion, nested section-group traversal or Vibe64 tool attachment. Example: create meeting notes and append an action item, but do not expect an embedded OneNote designer or image upload.",
      "Rotate expiring client secrets in Env before deleting the old secret. Reconnect after consent or permission changes. Disconnect removes the project's local grant; Microsoft account or directory application-permission controls manage provider consent separately."
    ]
  }
});
const microsoftSharePointDefinition = Object.freeze({
  ...definition("microsoft-sharepoint", "Microsoft SharePoint", "Browse sites/libraries, transfer small files and edit list items.", "Sites.Read.All", "Read items in all site collections", true, [
    { name: "search", required: true, label: "Site search", hint: "Enter a search term for accessible SharePoint sites. Verification performs this search without changing a site." }
  ]),
  scopes: [
    { value: "Sites.Read.All", label: "Read items in all site collections", required: true, recommended: true },
    { value: "User.Read", label: "Read user profile", required: true, recommended: true },
    { value: "Sites.ReadWrite.All", label: "Edit or delete items in all site collections", recommended: true },
    { value: "Sites.Manage.All", label: "Create, edit, and delete items and lists in all site collections" },
    { value: "Sites.FullControl.All", label: "Have full control of all site collections" },
    { value: "Files.Read.All", label: "Read all files that user can access", recommended: true },
    { value: "Files.ReadWrite.All", label: "Read and write all files that user can access" },
    { value: "offline_access", label: "Keep access when you are away", recommended: true }
  ],
  setup: {
    url: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
    steps: [
      "In Microsoft Entra admin center → Entra ID → App registrations → New registration, name the application and choose accounts in any organizational directory. Select Register and copy Application (client) ID into Client ID. Keep organizations as tenant, or choose single tenant and enter that Directory (tenant) ID. SharePoint site search requires a work or school account; personal Microsoft accounts are unsupported.",
      "Open Authentication → Redirect URI configuration → Add Redirect URI, choose Web, paste this project's exact Suggested callback URL, then Configure. The generated backend must serve this callback. The tenant ID identifies the directory, not the application.",
      "Under API permissions → Add a permission → Microsoft Graph → Delegated permissions, add Sites.Read.All, User.Read and offline_access, plus any optional permissions selected here. For site search only, clear optional site-write and file permissions. The form retains User.Read for profile access; site search itself requires Sites.Read.All. Tenant policy may require administrator consent. Add Sites.ReadWrite.All for list-item edits or file uploads; reconnect after changing consent.",
      "Open Certificates & secrets → Client secrets → New client secret, enter a description and expiry, then Add. Copy Value immediately, not Secret ID. Keep env:MICROSOFT_SHAREPOINT_CLIENT_SECRET and env:MICROSOFT_SHAREPOINT_CALLBACK_URL as references; actual values belong in Env.",
      "Save configuration, then use Set credential in Env for the secret and Open Env for the registered callback. Enter a Site search term before Connect account. This verifies the shared account for this project; per-user mode requires each generated-app user to connect separately. Application login is separate.",
      "Use an account with access to the intended SharePoint sites. Verification searches site names and other indexed properties without changing a site. Empty results can be a successful search. It does not crawl documents, edit lists or grant access to additional sites. Sites.Selected application permissions are not supported by this search operation.",
      "After sites.search, use the returned site ID with libraries.list or lists.list. files.list browses a selected drive and folder; files.get supplies metadata/private short-lived download links. Never log these links or forward the Microsoft bearer token to them. files.upload supports up to 5 MB and defaults to fail on an existing name; approve replace explicitly.",
      "listItems.list returns fields and ETags. listItems.create/update accepts internal column names and scalar values. Updates require the current eTag; if Microsoft returns 412, reload and review the conflicting edit rather than overwriting. Approve the site, list and values in your app before writing.",
      "LIMITATIONS: no site-collection creation, SharePoint admin UI, complex field editors, sharing/permissions editor or Vibe64 tool attachment. Large/resumable file transfers need native Graph wiring. Example: update a project-status list and upload a report, but do not receive a SharePoint site builder.",
      "Rotate expiring secrets in Env before removing the old secret. Reconnect after consent or permission changes. Disconnect removes local grants; use Microsoft account or directory application-permission controls to manage provider consent separately."
    ]
  }
});
const microsoftWordDefinition = Object.freeze({
  ...definition("microsoft-word", "Microsoft Word", "Browse Word files and folders in your drive and read document metadata.", "Files.Read", "Read your files"),
  setup: {
    url: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
    steps: [
      "In Microsoft Entra admin center → Entra ID → App registrations → New registration, name the application. For common, choose accounts in any organizational directory and personal Microsoft accounts. For single tenant, choose this directory only and enter its Directory (tenant) ID. Select Register and copy Application (client) ID into Client ID.",
      "Under Authentication → Redirect URI configuration → Add Redirect URI, choose Web, paste this project's exact Suggested callback URL and select Configure. The generated backend must serve that callback. Directory (tenant) ID identifies the directory, not the app.",
      "Under API permissions → Add a permission → Microsoft Graph → Delegated permissions, add Files.Read and offline_access. These authorize file reads and ongoing access; the fragment requires no write permission. Directory policy may require administrator consent. Use an account with an existing OneDrive and access to the documents you need.",
      "Open Certificates & secrets → Client secrets → New client secret, enter a description and expiry, then Add. Copy Value immediately, not Secret ID. Keep env:MICROSOFT_WORD_CLIENT_SECRET and env:MICROSOFT_WORD_CALLBACK_URL as references; actual values go in Env.",
      "Save configuration, then use Set credential in Env for the secret and Open Env for the exact registered callback. Connect account authorizes the shared account for this project. Per-user mode requires each generated-app user to connect separately; application login is a separate concern.",
      "Verification lists drive-root folders and document filenames. The app can browse folders and read a selected file's metadata using its returned item ID. It does not read document contents, edit or download documents, execute macros or scan the whole drive. An empty filtered page can still have another page to fetch.",
      "Rotate expiring secrets in Env before deleting the old secret. Reconnect after consent or permission changes. Disconnect removes local grants; Microsoft account or directory application-permission controls manage provider consent separately."
    ]
  }
});
const microsoftPowerPointDefinition = Object.freeze({
  ...definition("microsoft-powerpoint", "Microsoft PowerPoint", "Browse PowerPoint files and folders in your drive and read presentation metadata.", "Files.Read", "Read your files"),
  setup: {
    url: "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
    steps: [
      "In Microsoft Entra admin center → Entra ID → App registrations → New registration, name the application. For common, choose accounts in any organizational directory and personal Microsoft accounts. For single tenant, choose this directory only and enter its Directory (tenant) ID. Select Register and copy Application (client) ID into Client ID.",
      "Under Authentication → Redirect URI configuration → Add Redirect URI, choose Web, paste this project's exact Suggested callback URL and select Configure. The generated backend must serve that callback. Directory (tenant) ID identifies the directory, not the app.",
      "Under API permissions → Add a permission → Microsoft Graph → Delegated permissions, add Files.Read and offline_access. These authorize file reads and ongoing access; the fragment requires no write permission. Directory policy may require administrator consent. Use an account with an existing OneDrive and access to the presentations you need.",
      "Open Certificates & secrets → Client secrets → New client secret, enter a description and expiry, then Add. Copy Value immediately, not Secret ID. Keep env:MICROSOFT_POWERPOINT_CLIENT_SECRET and env:MICROSOFT_POWERPOINT_CALLBACK_URL as references; actual values go in Env.",
      "Save configuration, then use Set credential in Env for the secret and Open Env for the exact registered callback. Connect account authorizes the shared account for this project. Per-user mode requires each generated-app user to connect separately; application login is a separate concern.",
      "Verification lists drive-root folders and presentation filenames. The app can browse folders and read a selected file's metadata using its returned item ID. It does not read slides, edit or download presentations, execute macros or scan the whole drive. An empty filtered page can still have another page to fetch.",
      "Rotate expiring secrets in Env before deleting the old secret. Reconnect after consent or permission changes. Disconnect removes local grants; Microsoft account or directory application-permission controls manage provider consent separately."
    ]
  }
});
const microsoftDefinitions = Object.freeze([
  microsoftOutlookDefinition, microsoftOneDriveDefinition, microsoftExcelDefinition,
  microsoftTeamsDefinition, microsoftOneNoteDefinition, microsoftSharePointDefinition,
  microsoftWordDefinition, microsoftPowerPointDefinition
]);
export { microsoftOutlookDefinition, microsoftOneDriveDefinition, microsoftExcelDefinition, microsoftTeamsDefinition, microsoftOneNoteDefinition, microsoftSharePointDefinition, microsoftWordDefinition, microsoftPowerPointDefinition, microsoftDefinitions };
