# Airtable

Import `airtableProvider` from `@jskit-ai/connectors-catalog/server/airtable`.
The initial adapter uses a personal access token (PAT), recorded as the common
`api-key` authentication method. OAuth installation is not implemented by this
adapter yet. Legacy account API keys cannot authenticate.

## Set up access

1. Sign in as the account that should own the connection. Open
   [Developer hub](https://airtable.com/create/tokens).
2. Choose **Personal access tokens**, then **Create token**. Name it for the
   application/environment.
3. Choose **Add a scope**. Add `schema.bases:read` for discovery,
   `data.records:read` for reading records, `data.records:write` for creating,
   updating or deleting records, and `schema.bases:write` only when the app
   creates bases or changes tables/fields. Base creation needs Workspace Creator access and a token resource grant covering the target workspace. The token owner needs Editor access for record writes
   and Creator access for schema writes; scopes do not increase base permissions.
4. Under access, select the individual bases or workspaces the app needs.
   A token only inherits rights the creating account already has.
5. Create the token. Store the value outside source, for example in the backend
   environment as `AIRTABLE_TOKEN`. In `integrations.json`, set provider
   `airtable`, account mode `shared` or `assistant`, empty `scopes`, and
   `authentication: { "method": "api-key", "secretRef": "env:AIRTABLE_TOKEN" }`.
   Leave `registrations` empty for this slot.
6. Use `connectApiKey` to verify access. Rotating the value behind the same
   reference affects the next operation; changing the reference requires
   verification again. See [Airtable's PAT guide](https://support.airtable.com/docs/creating-personal-access-tokens).

## Runtime and AI composition

`bases.list` calls `GET /v0/meta/bases`. Its optional `offset` is the cursor
returned by the previous page. Results retain `bases` and `offset`. There is no
page-size input: this endpoint pages up to 1,000 bases. An empty collection
can indicate missing resource grants or an organization restriction; it does
not prove access to a particular base. See [List bases](https://airtable.com/developers/web/api/list-bases).

Use the [API-key source pattern](../patterns/api-key-connection/PATTERN.md),
substituting this provider, slot and secret reference. The application owns
authorization and maps the trusted caller to the connection owner. The library
supplies validation, HTTP errors and file persistence. A CLI and Vibe64 edit
the same JSON. The provider supplies the record and schema operations below. Application screens
and rules deciding which rows a caller may access remain application work.

## Provisioning automation and capacity

An AI can prepare configuration, secret names and operation calls once a PAT
is supplied. No supported ordinary-account API for issuing PATs was verified
in this pass; token creation and resource grants use the console above.
The application owner supplies its authorized PAT through private Env. Two
PAT names alone do not establish separate capacity:
check the relevant base, workspace and token-owner limits. OAuth registrations
for distribution to unrelated customers are a separate future mode.

Automated fixtures verify the authenticated endpoint, encoded pagination,
file-store restart, rotation, isolation, disconnect, malformed success and
401/403/429 failures. No real Airtable account was used.

## Record and schema workflows

`bases.create` accepts `{ name, workspaceId, tables }`. Supply an explicitly
selected Airtable workspace ID and at least one table containing at least one
field; field names must be unique ignoring case. This writes a new base and must
be an explicitly authorized action, never part of verification. The first field
is the primary field. A token granted only one existing base cannot provision
another base: grant the intended workspace in the PAT's resource access and use
an account with Workspace Creator access. The API returns the new base ID and
table schema. Existing-base workflows need no workspace ID.
[Create base](https://airtable.com/developers/web/api/create-base).


Use `tables.list` with `{ baseId }` to discover the base's tables and fields.
Prefer returned table and field IDs over mutable display names. A selected token
resource grant is still required even when the API scope is enabled.
[Base schema](https://airtable.com/developers/web/api/get-base-schema).

```js
const page = await connections.invoke({ context, integrationId: "data",
  operation: "records.list", input: { baseId: "appYourBase", tableId: "tblYourTable",
    pageSize: 100, filterByFormula: '{Status}="Open"' } });
const created = await connections.invoke({ context, integrationId: "data",
  operation: "records.create", input: { baseId: "appYourBase", tableId: "tblYourTable",
    fields: { Name: "A task", Done: false } } });
await connections.invoke({ context, integrationId: "data", operation: "records.update",
  input: { baseId: "appYourBase", tableId: "tblYourTable", recordId: created.id,
    fields: { Done: true } } });
```

`records.list` uses the documented POST `/listRecords` variant, avoiding URL
length limits for formulas. Supply returned `offset` on the next call and retain
the same view/formula. No offset means the last page. Inputs include optional
`view` and `filterByFormula`, and `pageSize` from 1 to 100. Empty values may be
omitted by Airtable; absence in a read response does not mean a field was removed.
[Record listing](https://airtable.com/developers/web/api/list-records).

`records.create` creates one record. `records.update` uses PATCH, preserving
unspecified cells. Both require a nonempty `fields` object and disable automatic
`typecast`. Validate user fields against your application contract and the returned
Airtable schema; the API validates provider-specific cell formats. Do not copy
arbitrary HTTP request bodies into this operation. Use `records.delete` with
`{ baseId, tableId, recordId }` for an explicitly authorized deletion. None of
these mutations occurs on connection verification.
[Create](https://airtable.com/developers/web/api/create-records),
[update](https://airtable.com/developers/web/api/update-record),
[delete](https://airtable.com/developers/web/api/delete-record).

`tables.create` accepts `{ baseId, name, description?, fields }`, where each field
has `name`, `type`, and optional `description`/`options`. The first field is the
primary field; choose a supported primary type such as `singleLineText` and unique
field names. `tables.update` accepts `{ baseId, tableId, name, description? }`.
`fields.create` accepts `{ baseId, tableId, field }`; `fields.update` accepts
`{ baseId, tableId, fieldId, name, description?, options? }`. Use the documented
write shape for each field type, not a copied read-only schema response. Unknown
field types/options are rejected by Airtable, not converted silently. The adapter
currently requires a name on schema updates.
[Create table](https://airtable.com/developers/web/api/create-table),
[update table](https://airtable.com/developers/web/api/update-table),
[create field](https://airtable.com/developers/web/api/create-field),
[update field](https://airtable.com/developers/web/api/update-field).

Surface 403 as missing scope, base resource, account role or policy; surface 429
for application-owned backoff. Uncertain writes are not automatically retried.
The application owns deduplication/reconciliation before another creation attempt.

`test/airtable.test.js` proves the schema and record workflow through the real
connection service with controlled responses: discovery, table/field writes,
pagination, encoded table names, partial updates, deletion, nonempty field
validation, authorization, app isolation, 403/429 and uncertain-write handling.
One focused test passed. No live Airtable account was used. This is runtime
repair evidence. A focused public-editor browser fixture also passed: PAT references save without secrets, and scope, verification and revocation guidance is visible. This adapter does not itself attach tools to an editor’s coding assistant; that remains an assistant-host responsibility.
