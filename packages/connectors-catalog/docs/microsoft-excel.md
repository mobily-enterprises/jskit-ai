# Microsoft Excel

Provider ID `microsoft-excel`; export `microsoftExcelProvider` from
`@jskit-ai/connectors-catalog/server/microsoft-excel`.

Follow all [Microsoft registration steps](microsoft-oauth.md). Choose the
organizational + personal account audience. In **API permissions → Microsoft
Graph → Delegated permissions**, add **`Files.Read`** and `offline_access` for file browsing and verification.
Add **`Files.ReadWrite`** for worksheet access.
Microsoft's worksheet-list reference currently requires this permission even
for a GET, and lists delegated organizational and personal accounts as supported.
Application-only permission is unsupported for this operation. The form makes
the broader permission explicit. [Worksheet API](https://learn.microsoft.com/en-us/graph/api/workbook-list-worksheets?view=graph-rest-1.0).

Use an existing accessible Excel workbook in the signed-in user's drive. Obtain
its drive item ID from your app's file picker or drive listing; this is not a
share URL or the worksheet ID. Connection verification lists the drive root and needs no workbook ID.
`items.list` accepts an optional `folderId` and bounded `pageSize` (default 25,
maximum 100). Its returned `id` supplies `worksheets.list`'s `itemId`; do not use
a sharing URL or worksheet ID. Missing or malformed worksheet IDs fail before
transport. Files.Read-only connections can browse but cannot list worksheets.
The form includes the captured optional Files.Read.All and Files.ReadWrite.All
permissions; the runtime requires the operation's explicit Files.Read or
Files.ReadWrite grant and does not infer one permission from another.

`worksheets.list` calls
`/v1.0/me/drive/items/{itemId}/workbook/worksheets`. Its required `itemId` and
optional `nextLink` are validated. It returns the worksheet `value` collection.
The adapter also exposes bounded range reads/updates and explicit workbook sessions, described below.

AI provisioning is **API-capable after operator authorization**: create the
registration and secret using the common guide, with the permission above.
The AI can prepare the resource input and JSON, but cannot grant access to a
workbook the user does not own or cannot open. The application owner supplies
its registration and private Env bindings; shared tenant limits still apply.

The common guide gives console navigation, ownership and file-store composition.
Automated tests cover ID validation, delegated scope, verification read,
pagination resource binding, cancellation, refresh and encrypted restart.
Live workbook use and application generation are outside this delivery.

## Editor and CLI handoff

The screen includes app-registration navigation, audience/tenant selection,
Web callback registration, delegated permissions and one-time secret **Value**.
Save the references `env:MICROSOFT_EXCEL_CLIENT_SECRET` and
`env:MICROSOFT_EXCEL_CALLBACK_URL`; use **Set credential in Env** and **Open Env**
to supply their values. The callback must exactly match the app's registered Web
redirect URI and its implemented backend route. Shared/assistant mode connects
one project account; per-user mode requires each app user to authorize separately.
Microsoft connection does not establish application login.

After connection, the same JSKIT service can browse and read worksheet metadata:

```js
const files = await connections.invoke({ context, integrationId: "excel",
  operation: "items.list", input: { pageSize: 25 } });
// Select an accessible Excel workbook's id from the result (or browse folderId).
const sheets = await connections.invoke({ context, integrationId: "excel",
  operation: "worksheets.list", input: { itemId: selectedWorkbookId } });
```

File browsing returns folders and other file types too. The framework owns the
picker and decides which workbook to open. No file ID is requested before OAuth.
Connection success proves drive-list access, not worksheet support or access to
every workbook. The worksheet API still requires Files.ReadWrite; range updates explicitly edit cells. Laravel implements its own Graph integration and reads
its own environment; it does not depend on the JavaScript runtime.

## Cell operations and sessions

Use `ranges.get` with `{ itemId, worksheetId, address: "A1:B1" }`.
Use `ranges.update` with the same inputs plus exactly one of
`values: [[2, 3]]` or `formulas: [["=SUM(C1:C3)", null]]`.
Matrices must exactly match the address, with at most 10,000 cells. Null leaves
the corresponding cell unchanged. Files.ReadWrite is required even for reading.
The application owns workbook/worksheet selection, cell-edit authorization and
presentation; Vibe64 only configures credentials. CLI applications use the same
connection service without Vibe64; another framework calls Graph itself.

For a work/school account, call `sessions.create` with
`{ itemId, persistChanges: true }` and pass returned `id` as `sessionId` to range
calls. Use false for a temporary analysis copy. Close using `sessions.close`
with `{ itemId, sessionId }` in cleanup. Calls without a session persist edits.
Never silently create a persistent replacement for an expired temporary session.
Do not blindly retry uncertain writes; read the affected cells and let the app
resolve uncertainty. Formula text is app-approved content, not trusted instructions.

**LIMITATIONS:** Synchronous session creation only; asynchronous 202 responses
are not claimed as sessions. No workbook creation, formatting editor, charts,
pivot tables or editor assistant attachment. Example: update a budget and formula,
but no spreadsheet designer appears. Microsoft documents personal-account range
permissions but excludes personal accounts from session close; use work/school
for the session workflow. No live workbook or generated-app proof.

References: [range updates](https://learn.microsoft.com/en-us/graph/api/range-update?view=graph-rest-1.0),
[create session](https://learn.microsoft.com/en-us/graph/api/workbook-createsession?view=graph-rest-1.0),
[close session](https://learn.microsoft.com/en-us/graph/api/workbook-closesession?view=graph-rest-1.0).
