# Microsoft OneDrive

Provider ID `microsoft-onedrive`; export `microsoftOneDriveProvider` from
`@jskit-ai/connectors-catalog/server/microsoft-onedrive`.

Follow all [Microsoft registration steps](microsoft-oauth.md). Choose the
organizational + personal account audience. In **API permissions → Microsoft
Graph → Delegated permissions**, add `Files.Read` and `offline_access`. Use an
account with a provisioned drive; this fragment does not provision OneDrive.

The verification and useful operation is `items.list`, reading
`/v1.0/me/drive/root/children`. Inputs: optional `pageSize` (1–100, default 25;
this fragment's bound) and `nextLink`. Initial selection includes ID, name, size,
web URL, file/folder facets and parent reference. Results retain `value` and the
opaque `@odata.nextLink`. Verification input is `{}`. Nested browsing uses folderId. File downloads and small uploads are described below; sharing changes remain outside this adapter.
[Children API](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0).

AI provisioning is **API-capable after operator authorization** through the
application and credential endpoints documented in the common guide. Use these
delegated permissions and the same callback/secret fields as the CLI. The
application owner supplies its registration and private Env bindings; tenant/user
limits can overlap. Account consent and organizational policy remain provider
and administrator decisions.

Use the common guide's file-based library composition and ownership policy.
Automated fixtures cover OAuth permissions, API requests, paging, cancellation,
encrypted restart, rotation and denied access. No live account or generated app
is used. Saving the configuration is separate from establishing a connection.

## Permission choices and editor setup

The form matches the captured choices: required Files.Read; initially selected
Files.Read.All and Files.ReadWrite; optional Files.ReadWrite.All and
Files.ReadWrite.AppFolder. offline_access requests refresh capability. For read-only use, clear optional read-all/write selections. Add the same
selected delegated permissions to your Entra registration. The runtime retains
explicit Files.Read for its root listing and does not infer permission equivalence.
Selecting extra permissions does not implement new library operations.

AppFolder is a distinct Microsoft permission; its API creates the folder on first
access. This fragment never requests that endpoint during verification and does
not implement app-folder operations. See Microsoft's
[app-folder guide](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder).

The screen supplies full Entra registration, audience/tenant, Web callback and
secret-Value instructions. Save `env:MICROSOFT_ONEDRIVE_CLIENT_SECRET` and
`env:MICROSOFT_ONEDRIVE_CALLBACK_URL`, then use **Set credential in Env** and
**Open Env** for the actual values. Shared/assistant **Connect account** uses
this application's runtime; per-user consent takes place inside the application.
The callback and grant store remain application-owned when hosting changes.

## File operations in CLI and generated apps

`items.list({folderId})` navigates children; retain the returned nextLink for the
same folder. `items.get({itemId})` returns metadata and, for downloadable files,
`@microsoft.graph.downloadUrl`. This temporary URL itself authorizes content
access: give it only to the authorized app user, do not log/cache it, and never
forward the Microsoft bearer token to it. Download immediately using the browser
or the framework's native transfer client. Treat folders as navigation, not files.

`files.upload({parentId, name, bodyBase64, conflictBehavior: "fail"})` sends bytes
up to 5 MB. Optional replace/rename must be an explicit application choice;
Files.ReadWrite is required. CLI apps call the same connections.invoke operation.
The editor stores only configuration and Env references. Other frameworks use
Graph's binary PUT and their own authorization and file UI.

**LIMITATIONS:** No native transfer client execution in these tests. Large files
and resumable upload sessions are framework-owned: createUploadSession, transfer
ordered byte ranges to its uploadUrl without the Graph bearer token, track returned
nextExpectedRanges/expiry, and confirm the final driveItem. Keep upload URLs private.
This adapter does not provide that resumable loop, sharing UI, app-folder automation
or editor attachment. Example: a small report works; multi-gigabyte video needs
native transfer wiring. No live account or generated-app proof.

[Download content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0),
[upload content](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0),
[upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0).
