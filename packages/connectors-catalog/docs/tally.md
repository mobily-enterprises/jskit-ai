# Tally

Import `tallyProvider` from `@jskit-ai/connectors-catalog/server/tally`.
The adapter lists account forms and reads their submissions with an API key.

## Configure access

1. Sign into the intended Tally user account. Keys inherit that user's resource
   access, including access changes made later.
2. Open **Settings → API keys → Create API key**.
3. Create and copy the key while it is displayed. This flow does not provide
   per-form permission selection; do not invent scope checkboxes in application
   setup that imply the provider enforces them.
4. Store the key in backend Env as `TALLY_API_KEY`.
5. Save provider `tally`, mode `shared` or `assistant`, `scopes: []`, and
   authentication `{ "method": "api-key", "secretRef": "env:TALLY_API_KEY" }`.
6. Verify through `connectApiKey`. Manage keys in Settings; removing the owner
   from an organization also affects their keys' access.
   [Key ownership and setup](https://developers.tally.so/api-reference/api-keys).

## Runtime and AI composition

`forms.list` sends `GET https://api.tally.so/forms` with Bearer authorization
and `tally-version: 2025-02-01`. Inputs are `page` (starting at 1) and `limit`
(1–500, default 50). The response retains `items`, `page`, `limit`, `total`
and `hasMore`. Increment the page while `hasMore` is true. The connection check
uses the same operation; it does not create forms or fetch submission content during verification.
[Forms API](https://developers.tally.so/api-reference/endpoint/forms/list),
[version header](https://tally.so/help/api).

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) from CLI
code or an application service. The application owns which form metadata each
of its users may see; a shared provider key is not end-user authentication.

## Automation and application registrations

After interactive key setup, an AI can wire calls and prepare forms or webhooks
using documented provider APIs. The adapter exposes listing, draft creation, reading/updating forms and submission retrieval. No ordinary
API for creating the initial API key was verified; it remains an operator step.

This mode has no provider app/client ID. The application owner supplies its
user's authorized key through private Env. Distinct configuration names cannot
create independent capacity from one user's keys. Tests simulate pagination,
header versioning, bad keys, rate limits, malformed results, file-store restart,
rotation and cross-application isolation. No live forms were created or accessed.

## Submission retrieval

Invoke `submissions.list` with `formId`, optional `page` (default 1), `limit`
(1–500, default 50), `filter` (`completed` by default, or `all`/`partial`) and
`afterId` from an earlier submission. GET `/forms/{formId}/submissions` retains
questions, answers, provider totals and `hasMore`. Advance pages explicitly;
keep the form/filter with pagination state and deduplicate imported submissions
by ID. An empty page is valid. False, zero and structured answers are preserved.

The application owns who can read these responses and how they are retained.
A shared key does not grant every app user access to every form. Do not fetch
returned PDF/preview/file URLs automatically or render answers as trusted HTML.
Other frameworks can use their native server HTTP client with the same Env
Bearer token and version header; no JSKIT or Vibe64 process is required.
[Submission API](https://developers.tally.so/api-reference/endpoint/forms/submissions/list).

No live submission was read.


## Create, review and publish

```js
const draft = await connections.invoke({
  context: authenticatedOwner, integrationId: "forms", operation: "forms.create",
  input: { blocks: [
    { uuid: crypto.randomUUID(), type: "FORM_TITLE", groupUuid: crypto.randomUUID(),
      groupType: "FORM_TITLE", payload: { title: "Booking request" } },
    { uuid: crypto.randomUUID(), type: "INPUT_TEXT", groupUuid: crypto.randomUUID(),
      groupType: "INPUT_TEXT", payload: { isRequired: true, placeholder: "Your name" } }
  ] }
});
// After the application's explicit review/approval:
await connections.invoke({ context: authenticatedOwner, integrationId: "forms",
  operation: "forms.update", input: { formId: draft.id, status: "PUBLISHED" } });
```

`forms.create` accepts native `blocks` (up to 500), optional workspace/template/
folder IDs and status (default `DRAFT`). The provider uses the account's default
workspace when no workspace ID is supplied. Native block schema and account
access remain Tally's authority; local validation checks the outer block shape,
not every block-specific payload. Construct fresh UUIDs for new blocks and retain
existing identifiers when editing. Never blindly replay an uncertain creation:
list forms and reconcile the result before deliberately retrying.

`forms.get` returns blocks and metadata. `forms.update` accepts a name, status
(`BLANK`, `DRAFT`, `PUBLISHED`) or replacement blocks; omitted fields are not sent.
Fetch and review before replacing blocks, since existing submissions may refer
to old questions. No automatic publication, polling loop or form designer is
created by configuring the connector.
[Create](https://developers.tally.so/api-reference/endpoint/forms/post),
[read](https://developers.tally.so/api-reference/endpoint/forms/get),
[update](https://developers.tally.so/api-reference/endpoint/forms/patch).

Other frameworks send the same JSON via their own server HTTP client and Env
binding. The application owns review screens, publication decisions, ingestion
and retention. A native Tally embed or hosted form can collect answers without
exposing this administrative API key to the browser. Settings, webhooks, form
trash and response deletion are not implemented by this adapter; account-level
setup and advanced form editing remain available in Tally.
