# Wave

`waveProvider` from `@jskit-ai/connectors-catalog/server/wave` provides OAuth
consent, profile verification, business/accounting reads, customer/product and
account/tax maintenance, invoice/estimate workflows and money-transaction creation. An ordinary CLI or backend composes the shared connection service
with encrypted file storage. Vibe64 edits the same portable JSON; saving it
does not connect an account.

## Provider registration

1. Sign in to Wave, open the [Create an application guide](https://developer.waveapps.com/hc/en-us/articles/50682251860884-2-Create-an-application),
   and follow **Manage applications**. Applications belong to that Wave account;
   separate applications can represent different environments.
2. Choose **Create New Application**. Enter your application name and the
   redirect URI your backend actually serves, then create it. These fields and
   the issued Client ID/Secret are described in Wave's
   [application setup instructions](https://developer.waveapps.com/hc/en-us/articles/51070420388628-Webhooks-Setup-Guide).
3. Copy **Client ID** into the configuration below. Put **Client Secret** in
   `WAVE_CLIENT_SECRET`; put the callback URL in `WAVE_CALLBACK_URL`. Keep both
   environment values outside source. The form takes references to these values.
4. Use an exact registered HTTPS callback for deployment. For a local operator
   CLI, register and serve a fixed loopback callback such as
   `http://localhost:8080/connections/wave/callback`. Wave's matching rules check
   host/port and permit subpaths; this runtime deliberately requires its exact
   configured callback. Changing the callback requires new consent.
5. Start consent from your backend/CLI, sign in as the intended Wave user, and
   review the requested permissions. Complete the callback in the same
   authenticated application context. OAuth business access requires an active
   **Pro or Wave Advisor** subscription. A later subscription loss can make
   refresh return 403. See the [OAuth guide](https://developer.waveapps.com/hc/en-us/articles/360019493652-OAuth-Guide).

Wave's [authentication guide](https://developer.waveapps.com/hc/en-us/articles/50682277703188-3-Authentication)
also describes **Create token** under an application's full-access tokens.
Those tokens are for personal/development use and can reach all businesses in
the account. They are not a substitute for customer OAuth. This adapter
implements OAuth only; full-access-token configuration remains a separate flow.
Do not paste such a token into the Client Secret field.

## Portable configuration

```json
{
  "schemaVersion": 1,
  "integrations": {
    "wave": {
      "provider": "wave",
      "displayName": "Business accounts",
      "accountMode": "per-user",
      "scopes": ["user:read", "business:read", "customer:read", "invoice:read"],
      "authentication": { "method": "oauth2", "registrationRef": "wave" }
    }
  },
  "registrations": {
    "wave": {
      "source": "own",
      "clientId": "replace-with-issued-client-id",
      "clientSecretRef": "env:WAVE_CLIENT_SECRET",
      "callbackUrlRef": "env:WAVE_CALLBACK_URL",
      "tokenEndpointAuthMethod": "client_secret_post"
    }
  }
}
```

The editor exposes all ten captured permission choices and the documented
granular alternatives, 32 choices in total. Four read permissions are initially
selected. Wave's [scope contract](https://developer.waveapps.com/hc/en-us/articles/360032818132-OAuth-Scopes)
treats read/write independently: `customer:write` does not authorize a read;
`customer:*` does. Broad permissions also include future operations. Selecting
extra permissions does not implement additional library operations.

Use `shared` for an intentionally shared connection with application membership
checks. Use `per-user` for individual grants, or `assistant` for access governed
by the host's assistant/workspace policy. The host derives stable
`applicationId` and `subjectId`; it must not trust these identifiers from a
browser request. A connected profile is data, not an application login.

## Runtime operations

| Operation | Inputs | Returned data |
|---|---|---|
| `user.read` | None | Connected user ID, first/last names and email; verifies new consent. |
| `businesses.list` | Optional `page`, `pageSize` | Business IDs, names, personal flags and paging. |
| `customers.list` | Required `businessId`; optional paging | One business's customers ordered by name, with ID/name/email. |
| `invoices.list` | Required `businessId`; optional paging | ID, number, date, status and currency for invoice summaries, newest creation first. |
| `accounts.list` | Required `businessId`; optional paging | Chart-of-accounts IDs, types/subtypes, currency, archived flag and decimal balance. |
| `products.list` | Required `businessId`; optional paging | Names, prices, sold/bought flags and income/expense account IDs, sorted by name. |
| `salesTaxes.list` | Required `businessId`; optional paging | Tax IDs, names, abbreviation, decimal rate and compound/recoverable/archived flags. |
| `vendors.list` | Required `businessId`; optional paging | Vendor IDs, names, email and phone. |

Results retain the GraphQL `{ data: ... }` envelope. Requests use fixed queries
and typed variables at Wave's [GraphQL endpoint](https://developer.waveapps.com/hc/en-us/articles/50682329964564-4-Making-API-calls).
The [business](https://developer.waveapps.com/hc/en-us/articles/360032908111-Query-List-businesses),
[customer](https://developer.waveapps.com/hc/en-us/articles/360032908311-Query-List-and-sort-customers)
and [invoice](https://developer.waveapps.com/hc/en-us/articles/360038426192-Query-List-invoices)
examples establish the selected query fields.

This fragment defaults to page 1 and 20 records, limits requested page size to
1–100, and requires positive GraphQL Int page numbers. These are library input
bounds, not a promised provider capacity. Wave's [pagination](https://developer.waveapps.com/hc/en-us/articles/360018856791-Pagination)
uses `currentPage`, `totalPages` and `totalCount`; the caller advances explicitly.
Empty pages and nullable edge nodes remain visible. Decimal prices, rates and
balances remain exact strings; this library never converts them to JavaScript
floating-point numbers. Applications choose their own decimal arithmetic library. The adapter rejects wrong
business IDs, inconsistent returned page numbers, excessive result counts and
malformed records. It does not crawl, calculate money or follow URLs in returned data. Sending
invoices and estimates requires a separate explicit operation.

Choose a business explicitly from `businesses.list` and authorize that choice
in the host before requesting records. A provider grant can cover more than one
business; the provider enforces its grant, while the application must enforce
its own business/workspace membership. No business defaults to the first entry.

The shared runtime handles state, code exchange, rotation and file locking.
Wave requires the original callback in refresh requests, so the grant records
it. Token responses must state granted scopes; a reduced grant stays reduced.
OAuth PKCE parameters are sent, but provider enforcement is not proven by local
fixtures. GraphQL errors, including partial-data responses, are rejected;
`UNAUTHENTICATED` requires reconnecting and `NOT_FOUND` returns a resource error.
Provider messages are not exposed. See Wave's [error examples](https://developer.waveapps.com/hc/en-us/articles/360018571372-Errors).

`cancelAuthorization` abandons one pending attempt. Failed replacement consent
preserves the previous connection. `disconnect` deletes local access and
attempts; provider token revocation is not implemented. Provider-side access
must be removed separately when needed.

## Create a customer

`customers.create` requires `customer:write` or `customer:*`. Supply an explicit
business ID chosen and authorized by your backend, plus the customer's name:

```js
const result = await connections.invoke({ context, integrationId: "wave",
  operation: "customers.create", input: { input: {
    businessId: selectedBusinessId, name: "Customer name",
    email: "customer@example.com"
  } } });
const customer = result.data.customerCreate.customer;
```

Optional contact fields are `firstName`, `lastName`, `email`, `phone`, `mobile`,
`displayId` and `internalNotes`. Address/shipping/currency fields are not yet
exposed. Input limits are library bounds; Wave still validates business rules.
The fixed `CustomerCreateInput` mutation returns the customer and owning business.
A business mismatch is rejected. `didSucceed: false` becomes a 422 error with a
safe message; provider error text is not exposed. On timeout, network failure or
an invalid success response, inspect Wave before retrying: the write may already
have happened. The runtime does not automatically replay it.

Another framework sends the same named mutation and variables to Wave using its
native HTTP client and the project-owned token. There is no editor dependency.
See the [official schema](https://developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference).
`customers.update` takes `{ businessId, input: { id, name, ... } }` and the same
optional contact fields. At least one field must change. Before the mutation,
the adapter reads that customer under the selected business and checks both IDs;
an absent or mismatched customer prevents the write. This requires both customer
read and write permissions (or `customer:*`). The application still authorizes
the selected business in its connection-service policy. These checks do not
substitute for workspace membership checks.

```js
await connections.invoke({ context, integrationId: "wave",
  operation: "customers.update", input: {
    businessId: selectedBusinessId,
    input: { id: customerId, name: "Updated customer name" }
  } });
```

The native equivalent is the business/customer lookup followed by the fixed
`CustomerPatchInput` mutation; `businessId` is not a field of that patch input.
The returned customer ID/business are checked too. There is no automatic retry.
The accounting operations below use the same project-owned connection.

## Invoice workflow

The app chooses a business, customer and products from authorized records. Use
`invoice:write` plus the relevant read permissions, and add `invoice:send` only
for sending. Wildcard `invoice:*` covers invoice reads/writes/sends. Creation
checks the customer under the business; update, approve and send first check the
existing invoice under that business. Customer changes also check the new customer.
The app's authorization policy must approve the business and requested operation.

```js
const draft = await connections.invoke({ context, integrationId: "wave",
  operation: "invoices.create", input: { businessId: selectedBusinessId, input: {
    customerId,
    items: [{ productId, quantity: "1.5", unitPrice: "75.00" }],
    invoiceDate: "2026-09-13"
  } } });
const invoiceId = draft.data.invoiceCreate.invoice.id;
await connections.invoke({ context, integrationId: "wave",
  operation: "invoices.update", input: { businessId: selectedBusinessId,
    input: { id: invoiceId, memo: "Appointment completed" } } });
await connections.invoke({ context, integrationId: "wave",
  operation: "invoices.approve", input: { businessId: selectedBusinessId,
    input: { invoiceId } } });
// Run only after the app user deliberately chooses to send this invoice.
await connections.invoke({ context, integrationId: "wave",
  operation: "invoices.send", input: { businessId: selectedBusinessId,
    input: { invoiceId, to: ["customer@example.com"], attachPDF: true } } });
```

Creation defaults to `DRAFT`; an explicit `SAVED` status is also supported.
Create accepts `customerId`, `items` (1–100), status, currency, title, invoice/PO
number, invoice/due date, exchange rate, memo and footer. Patch accepts the same
fields but requires `id`; omitted fields stay unchanged and supplied items replace
all existing items. At least one patch field is required. Dates must be real
YYYY-MM-DD dates. Monetary values and quantities must be decimal **strings**, up
to eight fractional places, never JavaScript numbers. Wave performs calculations.
Each item requires `productId`; description, quantity, unit price and taxes are
optional. Omit taxes to use product defaults; `taxes: []` explicitly removes them,
or pass `[{ salesTaxId }]`. Deprecated manual tax amounts are not sent.

Send requires a nonempty explicit recipient list and `attachPDF`; subject,
message and `ccMyself` are optional. The operation checks that the invoice is
approved and `business.emailSendEnabled` is true. A successful result means Wave
queued the email, not that the recipient received it. Never retry an uncertain
send automatically. `invoices.get` takes `{ businessId, invoiceId }` and returns
status, customer, currency, exact total/amount due and provider PDF/view links.
The adapter never downloads those private links.

Other frameworks use the same configuration/Env and native GraphQL operations:
`InvoiceCreateInput`, `InvoicePatchInput`, `InvoiceApproveInput`, `InvoiceSendInput`.
Business selection is passed into create input; for the other mutations it is
used for the preceding ownership lookup, not as an unsupported input field.
See the [invoice creation example](https://developer.waveapps.com/hc/en-us/articles/360038817812-Mutation-Create-invoice),
[sending example](https://developer.waveapps.com/hc/en-us/articles/360041888312-Mutation-Send-invoice)
and [schema](https://developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference).
Discounts, payment recording, cloning/deletion and advanced document formatting
are not covered by these invoice operations. The full Wave acceptance packet,
including final setup/lifecycle and distribution evidence, is still open.

## Application registration and hosting

Each application owns its provider registration, callback route, credentials
and grants. Hosted and installed editors configure the same app-owned setup;
neither supplies a shared Vibe64 registration or token gateway. Use the app's
assigned public URL as the initial callback origin, append the route the backend
actually implements, and register the exact URL with the provider. Keep the
client secret and callback binding in the application's Env.

A custom-domain or hosting move that changes the callback requires updating both
the provider registration and the app's Env. Preserve the application's identity
and private connection store, validate callback state and initiator, and allow
only application-approved return destinations. The editor's address is not the
provider callback. See the [callback contract](../../connectors-core/docs/oauth-callbacks.md)
and [setup command](../../connectors-core/docs/setup-command.md).

Wave approval requirements still apply to the developer's actual integration;
customer integrations use OAuth. Follow
[Developers and Integrators](https://developer.waveapps.com/hc/en-us/articles/360020596771-Permitted-Use-Developers-and-Integrators).
Distinct registrations alone do not establish independent API quotas. The
application must follow its approved usage and account limits.

## Automation feasibility

- **AI can prepare:** JSON, environment variable names, callback handler wiring,
  explicit business selection/policy, named read/write invocations and local fixtures.
  The protocol and storage implementation remain JSKIT library code.
- **Human/provider step:** account ownership, subscription choice, consent and
  provider review. Portal actions can be assisted after authentication, but
  issued secrets must enter protected fields directly.
- **Registration automation:** the reviewed public guides describe portal
  creation; no supported public registration-creation API was established.
  Do not invent a GraphQL mutation to create provider applications.
  Read APIs and token refresh do not establish provisioning API availability.
- **Rotation:** create/update credentials in the portal and protected bindings.
  Changed client IDs or callbacks require reconnecting; changing the secret
  binding can support ordinary provider-side secret rotation.

## Verification and remaining scope

`test/wave.test.js` exercises the real shared service with temporary encrypted
files and controlled HTTP responses. It covers code consent, restart, named
queries, input boundaries, scopes, owner policy, callback changes, serialized
refresh, permission/subscription failures, partial GraphQL errors, cancellation
and malformed success responses. The guide's JSON is parsed by the same schema.
The public editor cases passed at desktop and phone widths, checking all ten
setup steps, configuration/Env references and file persistence, owner-mode
changes, consent cancellation, reconnect and local disconnect.

These tests use no live Wave account, consent, invoices or registration. They do
not generate a sample application. Live success, provider PKCE enforcement,
partner approval and actual quota allocation remain unproven. Full-access
tokens, webhooks and provider-side revocation are not implemented. The implemented mutations are described below.

## Estimates in the application

Use `estimates.list` with `{ businessId, page, pageSize }` and `estimates.get`
with `{ businessId, estimateId }` to populate the app's estimate screens. List
ordering is newest-created first. The app owns those screens and the business
access policy; Vibe64 does not approve or send estimates.

```js
const draft = await connections.invoke({ context, integrationId: "wave",
  operation: "estimates.create", input: { businessId, input: {
    customerId, estimateDate: "2026-09-13", dueDate: "2026-10-13",
    items: [{ productId, quantity: "1", unitPrice: "125.00", taxes: [] }]
  } }
});
const estimateId = draft.data.estimateCreate.estimate.id;
// Each write follows a separate deliberate action authorized by your application.
await connections.invoke({ context, integrationId: "wave", operation: "estimates.approve",
  input: { businessId, input: { estimateId } } });
await connections.invoke({ context, integrationId: "wave", operation: "estimates.send",
  input: { businessId, input: { estimateId, to: [customerEmail], attachPDF: true } } });
```

Create defaults to DRAFT. Every estimate item requires an explicit decimal-string
`unitPrice`; numeric JavaScript prices are rejected. To update, pass
`estimates.update` with `{ businessId, input: { id, customerId, status, title,
estimateDate, dueDate, currency, exchangeRate, ...changes } }`. These fields are
required by Wave's patch input; read the current estimate before constructing
an edit. Optional `items` replaces the list. Creation and edits support memo,
footer, purchase-order number, estimate number and subheading.

Enable `estimate:read`, `estimate:write` and, only for sending, `estimate:send`
(or the explicit wildcard), plus customer read access for ownership checks.
The runtime verifies the estimate/customer business before mutation and validates
returned ownership. Sending a draft or deleted/converted estimate is rejected.
Sending success acknowledges the provider request, not recipient delivery.
Returned PDF/view URLs are private application data; the runtime does not fetch them.

Other frameworks use the same project configuration, Env credentials and native
Wave GraphQL operations: `estimateCreate`, `estimatePatch`, `estimateApprove` and
`estimateSend`. Preserve their differing input requirements and the same business
checks. See the [Wave schema](https://developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference).
Estimate conversion, deposits, attachments, discounts and advanced formatting are
not yet exposed by these operations; this estimate workflow alone does not close
the provider's full acceptance checklist.

## Maintain products and services

`products.create` takes `{ businessId, input: { name, unitPrice, description?,
incomeAccountId?, expenseAccountId?, defaultSalesTaxIds? } }`.
`products.update` takes `{ businessId, input: { id, ...changes } }`.
Supply prices as strings with at most five decimal places. Empty
`defaultSalesTaxIds: []` clears defaults; omit it to leave them unchanged.
The generated app owns the product editor and the decision to save.

Grant product write access (and product read for updates). When selecting
account/tax references, also grant the corresponding account/sales-tax read
permissions. Before writing, the runtime verifies each referenced record belongs
to the selected business. Choose permitted income/expense account subtypes from
`accounts.list`; Wave enforces which account types can be associated. There is
no automatic retry after a mutation failure or uncertain result.

```js
await connections.invoke({ context, integrationId: "wave", operation: "products.create",
  input: { businessId, input: {
    name: "Dog grooming", unitPrice: "125.00", incomeAccountId,
    defaultSalesTaxIds: selectedTaxIds
  } } });
```

Native framework implementations use `ProductCreateInput` / `ProductPatchInput`
and the matching `productCreate` / `productPatch` mutations at the same Wave
GraphQL endpoint. Preserve the business authorization checks before writes.
Creating products does not create accounting accounts or tax definitions.

## Accounting accounts and tax definitions

`accounts.create` accepts `{ businessId, input: { name, subtype, currency?,
description?, displayId? } }`. The app chooses a supported Wave account subtype;
JSKIT does not infer accounting treatment. `accounts.get` accepts
`{ businessId, accountId }` and returns `sequence`. Pass that revision to
`accounts.update` as `{ businessId, input: { id, sequence, ...changes } }`.
Edits support name, description and display ID. A changed revision produces
`connector_conflict`; reload and let the user review their edit. Wave still
performs its own revision check if the account changes after the preflight.

`salesTaxes.create` accepts `{ businessId, input: { name, abbreviation, rate,
description?, taxNumber?, showTaxNumberOnInvoices?, isCompound?, isRecoverable? } }`.
Use decimal strings for rates: `"0.15"` means 15%, with up to six decimal places.
`salesTaxes.get` accepts `{ businessId, salesTaxId }` and includes dated rates.
`salesTaxes.update` accepts `{ businessId, input: { id, ...changes } }` with name,
abbreviation, description, tax number, invoice display choice and optional
`rates: [{ effective: "2026-10-01", rate: "0.15" }]`. Review the full intended
rate history before submitting it; no automatic rate merging occurs.

Both update operations verify the record's business before writing. Read and
write scopes must be granted separately (or explicitly grant the corresponding
wildcard). Native frameworks use `accountCreate`, `accountPatch`, `salesTaxCreate`
and `salesTaxPatch`, preserving revision checks and explicit decimal/date inputs.
The app owns authorization, edit screens and accounting choices. These operations
do not yet expose tax archiving, account restrictions or null-to-clear account fields.

## Record a money transaction

`transactions.create` takes `{ businessId, input: { externalId, date, description,
notes?, anchor, lineItems } }`. An anchor is `{ accountId, amount, direction }`,
where direction is `DEPOSIT` or `WITHDRAWAL`. Each line has `{ accountId, amount,
balance, customerId?, description?, taxes? }`; balance is `INCREASE`, `DECREASE`,
`DEBIT` or `CREDIT`. Taxes are `{ salesTaxId, amount }`. All amounts are positive
strings with at most two decimal places. There are at most 100 lines, 20 taxes
per line and 100 distinct referenced records per request.

The application must deliberately choose valid accounting categories and balance
the lines against the anchor. Wave validates the accounting result; the adapter
does not guess debit/credit treatment. It verifies that the referenced accounts,
customers and taxes belong to the selected business before submitting once.
Grant transaction write and the relevant record-read permissions.

Save `externalId` with the application's source event and submission outcome.
It is not a claimed provider idempotency guarantee: after a timeout, reconcile
in Wave before resubmitting. There is no automatic retry or background import.
Successful output contains `data.moneyTransactionCreate.transaction.id`.
Native frameworks use the same `MoneyTransactionCreateInput` and
`moneyTransactionCreate` operation. See [Wave's transaction example](https://developer.waveapps.com/hc/en-us/articles/360057230751-Mutation-Create-Money-Transaction).
This records accounting data; it does not move money or initiate bank transfers.

## Captured scope reconciliation

The captured vendor permission advertises creation and updates. The reviewed
[public schema](https://developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference)
has vendor queries but no vendor create/patch mutation. This adapter supplies
`vendors.list`; it does not invent undocumented vendor endpoints. Business-write
and checkout scope choices likewise do not imply corresponding operations here.
The transaction implementation creates records; it does not claim transaction
search/edit/delete capabilities absent from the reviewed public API. These
provider limits must remain visible in the final acceptance record.

The inline setup screen keeps credential values in project Env bindings, gives
the callback origin/route rule, separates read/write/send permissions and explains
related-record read permissions. Registration creation remains a portal action;
no supported API for provisioning developer applications was established.

## Archive an accounting account

Call `accounts.archive` with `{ businessId, input: { id } }` after the application
user deliberately chooses to archive that account. The backend verifies the
account belongs to the selected business before submitting `accountArchive`.
Grant account read and write access (or `account:*`). The mutation carries only
the account ID; the business ID remains an application authorization input.
Wave decides whether this account can be archived. A rejected mutation produces
a safe input error; no automatic retry occurs. On success refresh the account
view. This hides an account from the default view, rather than deleting it.
Native frameworks use the same ownership lookup and `AccountArchiveInput`, whose
output provides `didSucceed` and `inputErrors`, without an account object. See
[Wave API reference](https://developer.waveapps.com/hc/en-us/articles/360019968212-API-Reference).
