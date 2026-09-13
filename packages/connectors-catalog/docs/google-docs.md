# Google Docs setup and runtime

Documentation checked: 13 September 2026. Automated tests use simulated provider
responses and real private JSON state; live provider use is outside this delivery.

## Registration and manual setup

Follow all numbered steps in [Google registration setup](google-oauth.md).
For this connector, choose **Google Docs API** in APIs & Services → Library and enable
`docs.googleapis.com` in the selected Cloud project. Create a Web application client
with the exact backend callback URI. Set the client ID, secret reference and
callback URL reference in the same registration fields used by the CLI.

In Google Auth Platform → Data Access, select
`https://www.googleapis.com/auth/drive.file` for create-first access. Also enable
**Google Drive API** (`drive.googleapis.com`) for the blank-ID connection check.
For read-only access to an existing document, choose `documents.readonly` and
supply its Document ID. `documents` permits account-accessible document writes.
Changing selected permissions requires reconnecting. Use External plus explicit
test users while testing outside an eligible internal Workspace audience.

## Fields and useful fragment

Provider ID: `google-docs`. Import its provider from
`@jskit-ai/connectors-catalog/server/google-docs`. Display name, scopes, account mode,
Client ID/secret and callback references follow the shared field mapping.
Membership and project access are enforced by the host/application policy,
not by storing untrusted people IDs in application source.

Operations: `connection.verify`, `documents.get`, `documents.create`,
`documents.batchUpdate`. Verification input is optional.

- With the recommended `drive.file`, leave Document ID blank. Verification lists
  one accessible Drive file's metadata; an empty file list is valid. This creates
  nothing and proves neither Docs API enablement nor access to every document.
- With `documents.readonly` or `documents` alone, provide
  `{ "documentId": "the_id_between_d_and_edit" }` to verify by reading the document.
  Supplying a file ID does not share it with the app. `drive.file` grants access
  only to app-created files or files explicitly selected/opened for this app.
  Google Picker is app-owned wiring, not an embedded editor feature.
- `documents.get` includes all tabs using includeTabsContent=true. Preserve tab IDs,
  document content and revisionId in the app; there is no result pagination.
- `documents.create` accepts `{title}` and returns a blank document. Store its ID
  under the authorized application user, then call batchUpdate to add content.
  Do not retry an uncertain creation without reconciling the user's files.
- `documents.batchUpdate` accepts documentId, 1–100 native Google Docs `requests`
  within 1 MiB, and optional `requiredRevisionId`. Each request contains one native
  operation object. Google validates operation names, resource-dependent indices,
  styles and atomic batch semantics; this adapter validates the envelope, not a
  duplicate version of Google's request schema. Errors remain errors, not success.

```js
const created = await connections.invoke({ context, integrationId: "docs",
  operation: "documents.create", input: { title: "Appointment notes" } });
await connections.invoke({ context, integrationId: "docs",
  operation: "documents.batchUpdate", input: {
    documentId: created.documentId,
    requests: [{ insertText: { endOfSegmentLocation: {}, text: "Customer notes\n" } }]
  } });
```

For a multi-tab document, read tabs first and target the intended tabId in each
native request. Use UTF-16 indices from Google's document representation; do not
calculate text positions by byte count. Native requests support insertion,
replacement/deletion, styles and tables. Fetch a current revision and supply
requiredRevisionId to reject an edit against a changed document, then refetch and
review a conflict rather than blindly retrying. The app renders content safely,
authorizes user/document mappings and reviews destructive edits.

Other frameworks use the same config and private Env references with their
native Google Docs client or HTTP. No JSKIT requirement or Vibe64 service applies.

**Limitations:** no visual editor, Google Picker component, sharing/Drive exports,
comment/suggestion review UI, autonomous editing agent or editor chat attachment.
For example, an app can create a booking report and format its text, but saving
this connector does not let Vibe64's coding assistant edit the report. Fixtures
prove request flow, not Google's live document rendering or approval.

References: [create](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/create),
[batchUpdate](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate),
[Drive list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list).

## Automation and application setup

Classification: **assisted**, as detailed in the common Google guide. An
operator-authorized AI can check/create the Cloud project and enable
`docs.googleapis.com` with Service Usage or gcloud. It can prepare this connector's
JSON and callback/scope values. Web-client creation, branding, audience,
provider review and account consent remain the documented console/operator
steps; this adapter does not invent an API for them.

The application owns the Cloud project selection, registration, callback and
private secret bindings. It uses the same setup from a CLI or either editor.
Follow the common guide for rotation, revocation, domain changes and recovery.
Provider quotas belong to the selected Cloud project and resources; editor
subscription level does not allocate a shared registration.

## AI/CLI wiring

Use the file-store composition from the [connection pattern](../patterns/api-key-connection/PATTERN.md),
replace the API-key authentication with `oauth2` plus a registrationRef, and
register this provider. Use beginAuthorization / completeAuthorization instead
of connectApiKey, with an optional verification input as described above. The existing application
owns authenticated callback routes and its permission policy. Configuration,
OAuth, refresh, provider requests and storage remain library imports.
