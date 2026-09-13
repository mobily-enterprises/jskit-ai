# Xero

The `xeroProvider` export from `@jskit-ai/connectors-catalog/server/xero`
connects an own web registration through the shared OAuth runtime. It discovers
authorised tenants and provides organisation settings, contacts, invoices,
payments, reports, budgets, manual journals, bank transactions and attachments. Configuration, consent, refresh and encrypted file storage work from
an ordinary backend or CLI; no database or Vibe64 service is required.

## Create the provider registration

1. Sign in to the [Xero developer portal](https://developer.xero.com/myapps/).
   Open **My Apps**, choose **New app**, and enter your application's name.
2. Choose the **Auth Code** grant type for a backend that can keep a secret.
   Supply the application's website and its exact callback URL, then complete
   the portal's required agreement and create the app.
3. Open the app's configuration, copy **Client ID**, and use **Generate a
   secret**. Save that secret in the backend's environment or secret store.
4. Register an HTTPS callback. Local CLI testing may use
   `http://localhost:8080/connections/xero/callback`; Xero explicitly excludes
   `http://127.0.0.1`. Configure a listener on that same hostname, path and port.
5. Put the Client ID in the configuration below. Bind `XERO_CLIENT_SECRET`
   and `XERO_CALLBACK_URL` outside source. Preserve the provider-specific
   `tokenEndpointAuthMethod: "client_secret_basic"` value.

The [code-flow guide](https://developer.xero.com/documentation/guides/oauth2/auth-flow/)
defines these endpoints, callback rules and client authentication. This
fragment implements a confidential web registration. Native secret-free
registrations and client-credentials Custom Connections are different flows
and are not implemented here. A CLI can operate the backend flow; do not ship
a confidential client secret inside a downloadable frontend.

## Portable configuration

```json
{
  "schemaVersion": 1,
  "integrations": {
    "xero": {
      "provider": "xero",
      "displayName": "Accounting organisations",
      "accountMode": "per-user",
      "scopes": [
        "offline_access",
        "accounting.settings.read",
        "accounting.contacts.read",
        "accounting.invoices.read"
      ],
      "authentication": { "method": "oauth2", "registrationRef": "xero" }
    }
  },
  "registrations": {
    "xero": {
      "source": "own",
      "clientId": "replace-with-provider-client-id",
      "tokenEndpointAuthMethod": "client_secret_basic",
      "clientSecretRef": "env:XERO_CLIENT_SECRET",
      "callbackUrlRef": "env:XERO_CALLBACK_URL"
    }
  }
}
```

The editor fills the same Basic registration field automatically and displays
the shared Client ID, secret-reference and callback-reference inputs. All 16
captured permissions are represented, together with seven read-only accounting
variants and the tax-report permission. The four defaults above suit the
implemented reads. Current [Xero scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/)
replace the old broad transaction/report permissions with granular ones.
Select the permission required by the operation below and reconnect when
adding permissions. A scope alone does not add operations beyond this adapter’s
documented set; in particular GST/BAS tax reports are not implemented. Requested scopes can still be declined or
restricted by the provider's app tier and user permissions.

Use `shared` only when the application deliberately authorises members to use
one connection; map them to a stable shared subject in its policy. `per-user`
keeps individual grants separate; `assistant` still needs explicit assistant
and workspace policy. Connecting an organisation never makes its data public.
This adapter requests no identity scopes and implements no application login.

## Operations and ownership

| Operation | Inputs | Result and boundary |
|---|---|---|
| `connections.list` | None | The token's connected tenants; also used to verify consent. An empty list is valid, but permits no accounting request. |
| `organisation.read` | Required `tenantId` | One organisation's metadata, after verifying an `ORGANISATION` connection. Its returned ID must match. |
| `contacts.list` | Required `tenantId`; optional `page`, `pageSize`, `includeArchived`, `searchTerm` | One lightweight contact page, with `summaryOnly=true`. |
| `invoices.list` | Required `tenantId`; optional `page`, `pageSize` | One lightweight invoice page, with `summaryOnly=true`. |
| `contacts.get`, `invoices.get` | `tenantId`, `id` | Individual records with full native detail. |
| `contacts.create/update`, `invoices.create/update` | See write sections below | Deliberate contact, sales invoice and supplier bill changes. |
| `accounts.list`, `currencies.list`, `taxRates.list`, `trackingCategories.list` | `tenantId`; tracking optionally `includeArchived` | Organisation-owned settings for preparing entries. |
| `payments.list/create` | See payment sections below | Read payment pages or record an invoice payment; no card charge. |
| `reports.profitAndLoss`, `reports.balanceSheet`, `reports.agedReceivables`, `reports.agedPayables`, `reports.executiveSummary`, `reports.bankSummary`, `reports.trialBalance`, `reports.budgetSummary` | Explicit dates and report-specific fields below | Native report rows and decimal text. |
| `budgets.list/get` | `tenantId`, optional date range; detail requires `id` | Existing budgets and account budget lines. |
| `bankTransactions.list/get/create/update` | See bank sections below | Reads plus ordinary spend/receive writes. |
| `manualJournals.list/get/create/update` | See journal sections below | Reads and deliberate journal changes/posting. |
| `attachments.list/download/upload/replace` | Parent resource, record ID and file inputs below | Files attached to supported accounting records. |


Choose an organisation explicitly from `connections.list`; do not silently use
the first connection. Every accounting request rechecks the token's current
connections before adding the chosen `Xero-tenant-id` header. Practice tenants
are discoverable but cannot be used with these accounting operations. No caller
can supply arbitrary headers or URLs. The host must additionally authorise the
selected organisation for that application/workspace/user; a Xero grant can
contain more organisations than this application should expose.

Contact and invoice pages default to 100 items and allow 1–200; payment
pages allow 1–100. Bank transaction and manual journal pages are fixed at
up to 100. Page numbers start at 1 and are bounded at 1,000,000. Contact search is limited to 255 characters; archived contacts
default to excluded. Paging, summary payloads and any returned metadata are
preserved. The caller chooses subsequent pages; there is no automatic crawl,
inference of missing pages or accounting calculation. Writes are separate
explicit operations; listing or verifying a connection never writes records. Returned records
are private application data, not status metadata to broadcast or log.
The [contacts guide](https://developer.xero.com/documentation/api/accounting/contacts/)
and [paging guide](https://developer.xero.com/documentation/best-practices/api-call-efficiencies/paging/)
describe the underlying read parameters and lightweight responses.

## Application registration ownership

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

Distinct client IDs do not prove separate developer-wide quotas or exemption
from commercial tiers. Do not create duplicate free apps to evade limits.

The newer [tenant guide](https://developer.xero.com/documentation/guides/oauth2/tenants/)
states that new apps start at five organisations and Core permits 50. Multiple
users connected to the same tenant count once toward the app's tenant limit.
The older code-flow page still mentions 25; use the current tenant and
[pricing documentation](https://developer.xero.com/pricing/), then check the
registration's actual tier. Per-organisation throttling and app capacity still
apply. The application owns its usage policy and operator provisioning.

## What an AI can automate

| Work | Available path |
|---|---|
| Create an application registration and obtain its secret | No documented general app-registration API was found in the public OAuth/tenant guides. Use the portal; an authorised browser operator can help with those fields. Human consent, agreements and account access remain required. |
| Generate application configuration and wire callbacks | AI can write this JSON and compose the shared library. Only real assigned IDs and externally supplied bindings make the flow usable. |
| Discover permitted organisations and read accounting data | Documented OAuth and Accounting APIs; these operations are implemented and locally tested. |
| Remove provider connections or revoke grants | Xero documents connection deletion and token revocation. These are provider mutations, separate from this fragment's local disconnect; they are not implemented here. |
| Upgrade capacity or obtain distribution approval | Portal/operator process. Configuration does not perform an upgrade or bypass it. |

The [tenants API](https://developer.xero.com/documentation/guides/oauth2/tenants/)
describes connection management, including a separate client-credentials path.
Do not confuse that management capability with public developer-app creation.

## Lifecycle and proof

`offline_access` permits refresh. The runtime serialises refresh for a stored
connection and saves rotated credentials even if the following read fails.
Expired/revoked grants become reconnect-required. Local disconnect removes the
encrypted grant and pending attempts; it does not revoke other Xero connections.
Callers must surface provider errors, preserve the file-store key across
restarts and authorise each named operation before references are resolved.

The focused source suite currently passes 24 controlled tests, covering OAuth,
tenant access, reads/writes, report and budget results, raw attachment transfer,
encrypted persistence, interruption and redacted failures. All provider responses
are fixtures. Earlier public editor phone/desktop checks covered the initial
Basic registration, 24 permission choices, ownership, references and persistence;
they do not prove the subsequently expanded instructions. The updated compact-screen form check passed with the expanded instructions
and persistence assertions. The offline installed-package suite also passed
24/24 tests through public exports. The current expanded instructions have not
been rerun at desktop width; the earlier desktop form evidence is retained. No real registration, consent, accounting
data or generated application has been exercised.

## Payment reads

`payments.list({ tenantId, page, pageSize })` returns the native `Payments`
envelope. Select `tenantId` from `connections.list`; access is checked again
before every accounting request. `page` starts at 1; `pageSize` is 1–100,
default 100. The application requests later pages explicitly.

Select `accounting.payments.read` (or `accounting.payments` for an application
that also needs payment writes) and obtain fresh consent before invoking this
operation. Payment scope is separate from invoice scope. Preserve each payment's
amount, currency rate, account and invoice references; do not assume an amount is
in the organisation's base currency or recompute financial totals with binary
floating-point arithmetic. Native frameworks use GET `/api.xro/2.0/Payments`
with the same bearer grant, `Xero-tenant-id` and paging query. No payment is
created by this read.

Contracts: [Xero Accounting OpenAPI](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml)
and [current granular scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/).
The OpenAPI still lists older broad scopes in places; the current scope guide
maps payment reads to `accounting.payments.read`.

## Financial reports

- `reports.profitAndLoss({ tenantId, fromDate, toDate, ...options })` needs
  `accounting.reports.profitandloss.read` and an ordered YYYY-MM-DD date range.
- `reports.balanceSheet({ tenantId, date, ...options })` needs
  `accounting.reports.balancesheet.read` and an explicit YYYY-MM-DD date.

Options are `periods` (1–12), `timeframe` (MONTH, QUARTER or YEAR),
`standardLayout` and `paymentsOnly` (cash basis). The application chooses these
accounting/reporting settings and displays them with the result. These endpoints
return a native `Reports` envelope with headings, sections, rows, cells and
attributes. Preserve monetary cell strings exactly; do not convert them into
JavaScript numbers to display or add them. The provider calculates the report.
An empty Rows array remains a successful empty report, not fabricated zero totals.

Select the corresponding report permission in setup and reconnect for consent.
The connected Xero user also needs report access in the selected organisation.
Native frameworks GET `/api.xro/2.0/Reports/ProfitAndLoss` or
`/api.xro/2.0/Reports/BalanceSheet` with the same tenant header, user token and
query names. Report rendering, filters and organisation selection stay app-owned.
Tracking-category filters and other report types are not yet supplied by these
operations; the Xero completion checklist remains open.

## Full contact and invoice detail

`contacts.get({ tenantId, id })` and `invoices.get({ tenantId, id })` retrieve
one record using its returned UUID. Their existing contact/invoice read or write
permissions suffice. The runtime rechecks the connected organisation before
fetching and rejects a mismatched record ID. It retains full provider fields,
including addresses/contact people and invoice line items, currency and balances.
The app decides which fields its authenticated visitor may see.

Native frameworks use GET `/api.xro/2.0/Contacts/{ContactID}` or
`/api.xro/2.0/Invoices/{InvoiceID}` with no summaryOnly query, the selected
`Xero-tenant-id` and the app-held bearer token. The list operations remain
lightweight summaries; request detail for a selected record. Treat attachment
links as data rather than automatically forwarding authorization headers to them.

## Contact creation and changes

`contacts.create({ tenantId, idempotencyKey, Name, ...fields })` creates a contact.
`contacts.update({ tenantId, id, idempotencyKey, ...fields })` changes the supplied
fields on an existing contact. Supported fields are Name, FirstName, LastName,
EmailAddress and ContactNumber. At least one changed field is required. Xero
still validates tenant-specific uniqueness and field semantics.

Select `accounting.contacts` and reconnect for write consent. The application
must authorize the person making the change and supply a stable idempotency key
for that exact logical request (maximum 128 printable non-space ASCII characters).
Keep the key with the request; a retry of the same action must not generate a new
key or change its content. There are no automatic retries. On timeout or uncertain
provider outcome, reconcile the contact in Xero before deciding whether to retry.

Native frameworks use PUT `/api.xro/2.0/Contacts` for creation or POST
`/api.xro/2.0/Contacts/{ContactID}` for an update, with `{ Contacts: [fields] }`,
`Idempotency-Key`, the authorized tenant header and bearer token. Tenant discovery
is always a separate GET with no body or write headers. The adapter rejects
validation-error records even when the provider returns HTTP success. Saving
configuration never creates or changes a contact.

## Record an invoice payment

Use `accounts.list({ tenantId })` to discover account IDs and payment eligibility.
It needs the settings read permission already selected by default. Choose an
appropriate bank or payment-enabled account in the same organisation.

`payments.create({ tenantId, idempotencyKey, invoiceId, accountId, Date, Amount,
CurrencyRate?, Reference? })` records one payment using `accounting.payments`.
Select that write permission and reconnect first. Supply an explicit invoice,
account, YYYY-MM-DD payment date and positive numeric amount. CurrencyRate is
optional and positive; the application determines whether the invoice needs it.
Xero validates the amount against the invoice balance and tenant accounting rules.
This operation does not debit a bank, charge a card or mark a payment reconciled.

The app authorizes and confirms this accounting change. Persist its request key
and exact input. Native frameworks PUT `/api.xro/2.0/Payments` with
`{ Payments: [{ Invoice: { InvoiceID }, Account: { AccountID }, Date, Amount,
CurrencyRate?, Reference? }] }` and the tenant, bearer and Idempotency-Key headers.
A provider failure can leave the outcome unknown: inspect payment history before
retrying the exact request with the same key. Never silently create a fresh key.
No batch payments, credit-note refunds, reconciliation or payment deletion are
implemented by this operation. Saving the editor form makes no accounting change.

## Create and update invoices or bills

`invoices.create({ tenantId, idempotencyKey, Type, contactId, Date, CurrencyCode,
LineAmountTypes, LineItems, ...fields })` creates one sales invoice (`ACCREC`) or
supplier bill (`ACCPAY`). Status defaults to DRAFT; the app can explicitly request
SUBMITTED or AUTHORISED. Optional fields are DueDate, Reference and InvoiceNumber.
The app chooses currency and Exclusive/Inclusive/NoTax basis explicitly.

Supply 1–100 lines with Description, Quantity, UnitAmount and AccountCode. Optional
TaxType and DiscountRate are supported; discounts apply only to sales invoices.
`unitdp=4` preserves four-decimal unit prices in the provider request. The runtime
passes supplied numeric values without recalculating totals; Xero validates tax,
account, currency and status rules and computes totals. Do not build monetary
calculations from JavaScript floating-point additions. Use the framework's decimal
facilities for calculations before creating the request.

`invoices.update({ tenantId, id, idempotencyKey, ...fields })` changes supplied
fields only. Read the full invoice before changing its lines: a supplied LineItems
collection must contain the intended complete set, including existing LineItemID
values when retaining lines. The application owns concurrent-edit review. It may
request DRAFT, SUBMITTED, AUTHORISED, VOIDED or DELETED; Xero decides which transition
is legal for the current record. PAID is not a direct status operation: record a
payment separately. A status update does not email the invoice.

Select Read and manage invoices and bills (`accounting.invoices`) and reconnect.
The app must authorize and confirm meaningful status/accounting changes. Persist
an idempotency key and exact payload for each logical action; inspect the invoice
before retrying an uncertain write. Native frameworks PUT `/api.xro/2.0/Invoices`
or POST `/api.xro/2.0/Invoices/{InvoiceID}`, adding `unitdp=4`, with an Invoices
array containing one record and the same tenant/token/idempotency headers.
Use `Contact: { ContactID: contactId }` in the provider payload.

This does not implement credit notes, tracked-inventory overrides, recurring
invoices, attachments/PDF/email delivery, batch writes or arbitrary custom fields.
Saving configuration never writes an invoice or grants the app user accounting
permissions they do not have in Xero.

### Settings and additional financial reports

`currencies.list`, `taxRates.list` and `trackingCategories.list` take `tenantId` and use `accounting.settings.read` (or `accounting.settings`). Tracking categories additionally accept `includeArchived` (default false). Results preserve Xero's currency codes, tax components/rates and tracking options; use these organisation-owned values when preparing accounting entries.

Select the corresponding report permission in the configuration form and reconnect before invoking a newly enabled report. The connected Xero user must have report access too. All operations require `tenantId`:

| Operation | Additional inputs | Scope |
| --- | --- | --- |
| `reports.agedReceivables` / `reports.agedPayables` | Required `contactId`, `date`; optional `fromDate`, `toDate` | `accounting.reports.aged.read` |
| `reports.executiveSummary` | Required `date` | `accounting.reports.executivesummary.read` |
| `reports.bankSummary` | Required `fromDate`, `toDate` | `accounting.reports.banksummary.read` |
| `reports.trialBalance` | Required `date`; optional `paymentsOnly` | `accounting.reports.trialbalance.read` |

Dates use `YYYY-MM-DD`. Choose the contact from `contacts.list`; aged reports are per contact. Date ranges must be chronological. Responses retain native report rows, titles and decimal text; the framework owns rendering and calculations. CLI consumers use the same operation inputs and configuration scopes as the editor.

### Budget reads

Select **Read budgets** (`accounting.budgets.read`) and reconnect. Call `budgets.list` with `tenantId`; call `budgets.get` with that tenant and the returned budget UUID as `id`. Both accept optional `DateFrom` and `DateTo` in `YYYY-MM-DD` format (capitalization matches Xero). The adapter preserves account budget lines, balances, periods, notes and tracking data, and rejects a detail response for a different budget. It does not create or edit budgets.

For a summary, separately select **Read budget summary reports** (`accounting.reports.budgetsummary.read`) and reconnect. `reports.budgetSummary` takes `tenantId`, required `date`, optional `periods` (1–12) and optional integer `timeframe`: 1=month, 3=quarter, 12=year. This differs from the string timeframe used by profit/loss reports. The application owns rendering; no Vibe64 runtime is required.

### Bank transaction and manual journal reads

Select **Read bank transactions** (`accounting.banktransactions.read`) or **Read manual journals** (`accounting.manualjournals.read`), then reconnect. Full corresponding write scopes also permit these reads. `bankTransactions.list` and `manualJournals.list` accept `tenantId` and `page` (default 1); Xero uses fixed pages of up to 100 records for these endpoints. Continue numbered pages until an empty page; there is no configurable `pageSize` or `summaryOnly` query.

Use `bankTransactions.get` or `manualJournals.get` with the same tenant and the record UUID as `id` to retrieve full native detail. Bank account references, currency, transaction lines, journal debit/credit amounts and statuses are preserved. Individual responses must match the requested record. Applications own presentation, accounting review and authorization; listing records does not reconcile a bank account or authorize edits.

### Manual journal creation and updates

Select **Read and manage manual journals** (`accounting.manualjournals`) and reconnect. `manualJournals.create` requires `tenantId`, a stable `idempotencyKey`, `Narration`, `Date`, `LineAmountTypes` (`Exclusive`, `Inclusive`, `NoTax`) and 2–100 `JournalLines`. Each line requires `AccountCode` and finite signed `LineAmount`; debits are positive and credits negative. Optional line fields are `Description`, `TaxType` and up to two `Tracking` entries with `Name` and `Option`. Choose organisation-owned accounts, taxes and tracking values from the settings reads.

Creation defaults to `Status: "DRAFT"`; explicitly choose `POSTED` only after accounting review. `manualJournals.update` requires the tenant, request key, `id` and at least one changed field. It supports Xero's DRAFT/POSTED/DELETED/VOIDED/ARCHIVED status choices; Xero determines which transitions and accounts are valid. Optional `ShowOnCashBasisReports` is preserved. When replacing JournalLines, send the entire intended set, not an incremental line patch. Xero validates balance and tax; the adapter does not silently adjust entries.

The project backend owns authorization and retaining the exact intended request/key. Provider validation errors fail the operation. No automatic retries follow an uncertain write; retrieve the journal and review provider history before retrying with the same request key. These are accounting records, not transfers of money.

### Spend and receive bank transaction writes

Select **Read and manage bank transactions** (`accounting.banktransactions`) and reconnect. `bankTransactions.create` requires `tenantId`, a stable `idempotencyKey`, `Type` (`SPEND` or `RECEIVE`), `contactId`, `bankAccountId`, `Date`, `LineAmountTypes` and 1–100 `LineItems`. Each line requires `Description`, positive `Quantity`, finite `UnitAmount` and `AccountCode`; optional `TaxType` and existing `LineItemID` are supported. Choose the contact and bank account using the read operations. Currency belongs to the bank account; optional positive `CurrencyRate` supplies an exchange rate. Optional `Reference` is preserved. Requests use `unitdp=4` to preserve four-decimal unit amounts.

`bankTransactions.update` requires the tenant, request key, `id` and at least one changed field. It also accepts `Status: "AUTHORISED"` or `"DELETED"`; Xero validates allowed changes. Retrieve and review the transaction first; send the complete intended line set if replacing lines. Neither operation moves funds. Transfers, prepayments, overpayments and reconciliation are outside these write operations. Do not retry automatically after uncertain results: inspect the transaction/history and retain the original request key.


### Attachments

Select **Read attachments** (`accounting.attachments.read`) for listing/downloading,
or **Read and manage attachments** (`accounting.attachments`) for uploads and
replacements, then reconnect. Your application chooses `tenantId`, `resource`
(`Contacts`, `Invoices`, `BankTransactions` or `ManualJournals`) and the parent
record UUID as `id`. These files belong to that record in that organisation.

- `attachments.list` returns Xero's attachment metadata. Select an `AttachmentID`
  from it and pass that as `attachmentId` to `attachments.download`.
- Downloads return `contentBase64`, `contentType` and `size` (bytes). The application
  decides how to present the file; do not execute or trust uploaded file content.
- `attachments.upload` and `attachments.replace` require `filename`, canonical
  `contentBase64` and a stable `idempotencyKey`. Upload uses PUT; replace uses POST
  with the existing filename. Filenames cannot contain path separators or control
  characters. The file body is sent as raw bytes, not JSON or multipart data.

The adapter bounds each nonempty upload/download to 3 MiB. Xero also enforces its
own attachment counts and file restrictions. A failed or uncertain upload is not
retried automatically; list the parent's attachments before deciding whether to
retry with the original request key. There is no attachment deletion operation
or automatic public invoice attachment sharing. CLI consumers use the same
base64 input/output contract; other frameworks can use their native byte streams
against these provider endpoints with the same project-owned credentials.

## Closeout scope and remaining work

This provider is being closed against the September 13 existing-capability
milestone, not complete Xero API coverage or exact Lovable parity. The operation
index above is the supported runtime surface. The following work remains outside
that surface:

- Authentication: no secret-free native registration, Custom Connections,
  client-credentials accounting access, or application sign-in. Each project
  supplies its own confidential web registration and Env bindings.
- Connection management: disconnect is local; provider-side token revocation and
  removing individual tenant connections must be done through Xero. The host
  must implement its own organisation selection/authorization and connection UI.
- Contacts: create/update supports basic names, email and contact number, not
  full address, phone, bank-detail, contact-person or group management.
- Invoices/bills: supported line fields and status updates are documented above.
  No invoice email/PDF operations, repeating invoices, credit notes, purchase
  orders, discounts on bills or automatic line merging. Tracking on invoice and
  bank transaction writes is not implemented.
- Payments: invoice payment recording only; no payment deletion, batch payments,
  prepayment/overpayment allocation or actual payment processing.
- Bank transactions: ordinary SPEND/RECEIVE only; no transfer, overpayment,
  prepayment or reconciliation workflows.
- Journals: manual journal reads/writes only, with the bounded field set above;
  no automatic balancing, tax calculation or general ledger journal import.
- Settings: discovery only; no creation or editing of accounts, taxes, currencies
  or tracking categories. Budgets are read-only.
- Reports: only the eight named reports in the index. GST/BAS tax reports and
  general report discovery are not implemented, despite the available tax scope.
- Attachments: four parent types, 3 MiB per file, no deletion or automatic online
  invoice sharing. Larger files and other record types need native integration.
- Native application composition: the framework owns routes, UI, authorization,
  business validations and operation calls. Installing the provider or saving the
  editor form does not generate an accounting application. Editor coding-agent
  tool attachment remains deferred under the shared milestone decision.
- Verification: controlled fixtures establish request/response and local lifecycle
  behavior. Live OAuth, actual Xero organisations, provider tiers, production
  permissions, accounting outcomes and generated-app execution are unverified.

Future work should address these items only when a concrete application requires
them. Do not present an unsupported operation as available merely because its
OAuth scope can be selected.
