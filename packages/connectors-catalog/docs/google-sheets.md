# Google Sheets setup and runtime

Documentation checked: 13 September 2026. Provider responses are simulated;
no live account, real spreadsheet or generated app has been exercised.

## Registration and connection

1. Follow [Google registration setup](google-oauth.md): select this application's
   Cloud project, configure Google Auth Platform Branding/Audience and add test users.
2. APIs & Services → Library → **Google Sheets API** → Enable. For the default
   create-first connection, also enable **Google Drive API**.
3. Google Auth Platform → Data Access → Add or Remove Scopes → select
   `https://www.googleapis.com/auth/drive.file` → Update/Save. This grants only
   files created by or explicitly opened/selected for this app. An arbitrary
   spreadsheet ID does not grant access. The app wires Google Picker if needed.
4. Clients → Create Client → Web application → Authorized redirect URIs → Add URI.
   Paste the app backend callback displayed in the editor, then Create. Copy the
   client ID and secret immediately. The common guide explains reviews, Testing
   token expiry and rotation; the editor address is not the callback.
5. Save the registration fields in integrations.json. Use **Set credential in Env**
   and **Set callback in Env** for the private values named by their references.
   CLI users write the same file and set the same app Env values themselves.
6. Leave **Spreadsheet ID (optional)** blank to verify accessible Drive metadata.
   An empty list succeeds without creating a file; this does not prove Sheets API
   is enabled. To verify an existing file, copy the ID between `/spreadsheets/d/`
   and `/edit`, not its tab's `gid`. Both the account and app need access.
7. For read-only existing sheets, choose `spreadsheets.readonly` and supply the ID.
   `spreadsheets` grants broader writes. Add selected scopes in Data Access and
   reconnect after changing them. Drive metadata-only permission cannot read cells.
   Broad Drive access can require restricted-scope review.

## Application operations

Import `googleSheetsProvider` from
`@jskit-ai/connectors-catalog/server/google-sheets`. Register it with the existing
connection service/file store; the app authenticates each subject and owns its
callback, consent, grants and authorization policy. For a shared connection the
app administrator authorizes once; per-user connections require individual consent.
Use `beginAuthorization` with `verificationInput: {}` for create-first, then
`completeAuthorization`. [Connection composition](../patterns/api-key-connection/PATTERN.md)
shows configuration/storage; substitute OAuth plus registrationRef for API-key auth.

| Operation | Input and effect |
| --- | --- |
| spreadsheets.create | title; returns a new spreadsheet and initial sheet. |
| spreadsheets.get | spreadsheetId; metadata without grid data. |
| values.get | spreadsheetId, range; optional valueRenderOption FORMATTED_VALUE, UNFORMATTED_VALUE or FORMULA, and dateTimeRenderOption SERIAL_NUMBER or FORMATTED_STRING. |
| values.update | spreadsheetId, range, values (row matrix); valueInputOption defaults RAW. |
| values.append | Same fields; insertDataOption defaults INSERT_ROWS, optionally OVERWRITE. Google detects the logical table before appending. |
| values.clear | spreadsheetId, range; clears values, preserving formatting/validation. |
| values.batchUpdate | spreadsheetId, data [{range, values}], valueInputOption; writes several ranges. |
| spreadsheets.batchUpdate | spreadsheetId, requests [{nativeOperation: {...}}]; sheet creation/deletion, formatting and other native updates. Google validates operation semantics. |

```js
const sheet = await service.invoke({ ...connection, operation: "spreadsheets.create", input: { title: "Bookings" } });
await service.invoke({ ...connection, operation: "values.update", input: {
  spreadsheetId: sheet.spreadsheetId, range: "Sheet1!A1:B2",
  values: [["Customer", "Amount"], ["Example", 40]]
} });
```

Use A1 ranges and quote sheet titles with spaces/apostrophes using Google's rules.
The adapter URL-encodes the whole range. Value matrices use ROWS, finite numbers,
strings, booleans and null; null skips a cell and an empty string clears it.
RAW is safe for untrusted strings such as `=IMPORTXML(...)`; USER_ENTERED explicitly
allows formulas and parses dates/numbers according to spreadsheet locale. Formula
reads use FORMULA; formatted output is locale-dependent. Empty ranges may omit values.

Each matrix is limited to 10,000 cells/1 MiB; multi-range/native batches to 100
entries/1 MiB. Native formatting requests use sheet numeric IDs, zero-based grid
indices and explicit field masks. These differ from the spreadsheet ID/A1 ranges.
The app owns authorization, conflict detection and any chunking of larger work.
No automatic retry follows a timeout/503: inspect the spreadsheet before repeating
an append/create, or duplicate rows/files may result.

Other frameworks use their native Google client or HTTP implementation with the
same project-owned JSON/Env configuration; JSKIT is optional and requires no Vibe64
runtime. No PHP code or editor-specific credential service is involved.

## Provisioning and limitations

An authorized AI can enable APIs via gcloud/Service Usage and prepare JSON/Env
references. Client creation, branding, audience, provider review and consent follow
the console steps above; credentials do not bypass Google approval.

**LIMITATIONS:** No spreadsheet designer, embedded Picker, background synchronization,
Apps Script engine or editor-assistant attachment. For example the app can append a
booking and format its header, but must build its own table UI and ask the user to
select an existing private spreadsheet. Live Google behavior remains unproven.

References: [values guide](https://developers.google.com/workspace/sheets/api/guides/values),
[append](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append),
[batch updates](https://developers.google.com/workspace/sheets/api/guides/batchupdate),
[create](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/create).
