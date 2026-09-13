# Google Drive setup and runtime

Documentation checked: 13 September 2026. Automated tests use simulated provider
responses and real private JSON state; live provider use is outside this delivery.

## Registration and manual setup

Follow all numbered steps in [Google registration setup](google-oauth.md).
For this connector, choose **Google Drive API** in APIs & Services → Library and enable
`drive.googleapis.com` in the selected Cloud project. Create a Web application client
with the exact backend callback URI. Set the client ID, secret reference and
callback URL reference in the same registration fields used by the CLI.

In Google Auth Platform → Data Access, select
`https://www.googleapis.com/auth/drive.file` (required by this connector). The
captured defaults also select `drive.appdata`, `drive.appfolder` and
`drive.readonly`; remove optional permissions your application does not need.
The UI exposes additional documented scopes for applications that need them;
selecting a scope does not implement every API it permits. Use External plus explicit
test users while testing outside an eligible internal Workspace audience.

## Fields and useful fragment

Provider ID: `google-drive`. Import its provider from
`@jskit-ai/connectors-catalog/server/google-drive`. Display name, scopes, account mode,
Client ID/secret and callback references follow the shared field mapping.
Membership and project access are enforced by the host/application policy,
not by storing untrusted people IDs in application source.

Verification input: `{}`. Connection checks list metadata without modifying files.

| Operation | Inputs and result |
| --- | --- |
| `files.list` | pageSize (1–1000), pageToken, q, optional driveId; returns files and nextPageToken. driveId sets shared-drive corpus/flags. |
| `files.get` | fileId; returns metadata including parents, capabilities, exportLinks and webViewLink where Google supplies them. |
| `files.download` | fileId for a stored binary/text file; returns bodyBase64, size and contentType, up to 8 MiB. |
| `files.export` | fileId of a Workspace document and supported mimeType, e.g. application/pdf; same bounded binary result. Google enforces format and its own export limits. |
| `files.create` | name, optional parentId, folder=true for a folder; creates metadata, not uploaded content. |
| `files.upload` | name, contentType, standard padded bodyBase64, optional parentId for a new file or fileId to replace one; one native multipart request, max 5 MB input. Returns file metadata. |
| `files.update` | fileId and at least one of name, description or trashed; explicit true moves to trash, false restores where permitted. |

`drive.file` permits app-created or explicitly selected files. A copied ID alone
is not a Google Picker grant. Broad `drive.readonly` can read accessible content;
metadata-only scopes cannot download it. Writers need drive.file/drive or the
relevant metadata scope **and** actual file sharing permissions. Reconnect after
adding scopes. File capabilities and Google errors remain authoritative.

The app resolves the authenticated user's connection and allowed file IDs before
invoking operations. Never expose all file contents through an unauthenticated
proxy. Decode bodyBase64 in the framework, preserve its MIME type, and choose safe
download/content-disposition behavior; do not render arbitrary returned HTML.
Treat transfer failures as failures. A timed-out upload may have succeeded: inspect
Drive before retrying to avoid duplicate files or overwritten content. Replacing
an existing file explicitly replaces its name and data. Moving an existing file
between folders uses native addParents/removeParents, not upload parentId.

```js
const file = await connections.invoke({ context, integrationId: "drive",
  operation: "files.upload", input: { name: "report.txt", contentType: "text/plain",
    bodyBase64: Buffer.from("Appointment notes").toString("base64") } });
const downloaded = await connections.invoke({ context, integrationId: "drive",
  operation: "files.download", input: { fileId: file.id } });
```

Other frameworks use native Drive clients/HTTP with the same project config and
private Env. For larger transfers use native resumable upload/streaming, not a
larger JSON/base64 payload. No Vibe64 gateway receives or stores the content.

**Limitations:** no sync/watch service, embedded Picker, large/resumable transfer,
sharing administration, permanent deletion, revision history or Workspace-format
conversion on upload. Activity and app-data scopes do not implement those APIs.
For example, a generated app can upload a booking report and offer a PDF export,
but it cannot mirror a whole shared drive automatically. Editor assistant access
is deferred. Controlled fixtures do not prove live Google sharing or file export.

References: [uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
[downloads and exports](https://developers.google.com/workspace/drive/api/guides/manage-downloads).

The first read must succeed before Connected is returned. Invalid resource
identifiers fail before opening consent. Denied scopes, wrong account context,
replayed callbacks and provider rate limits are covered by the automated tests.
See the [official operation reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list) for the response and resource
permission requirements; the implementation also checks Google's public API
discovery document for request paths and supported scope strings.

## Automation and application setup

Classification: **assisted**, as detailed in the common Google guide. An
operator-authorized AI can check/create the Cloud project and enable
`drive.googleapis.com` with Service Usage or gcloud. It can prepare this connector's
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
of connectApiKey, with the verification input above. The existing application
owns authenticated callback routes and its permission policy. Configuration,
OAuth, refresh, provider requests and storage remain library imports.
