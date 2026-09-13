# Lexware Office

Import `lexwareProvider` from `@jskit-ai/connectors-catalog/server/lexware`.
This adapter verifies an API key, reads accounting resources and creates draft invoices. The provider calls this
its Public API; its bearer key is still a private backend credential.

## Provider setup

1. Sign into the intended Lexware Office account. Public API access requires
   the XL plan. Open **Erweiterungen → Weitere Apps → Public API**, or
   [the Public API settings](https://app.lexware.de/addons/public-api).
2. Select **API-Schlüssel erstellen**. In **Neuen API-Schlüssel erstellen**,
   select individual permissions and enable contact reading. Add article/document
   read access and invoice creation only for the operations needed. Choose **WEITER**,
   give the key a name, then choose **API-Schlüssel erstellen**.
3. Copy the key before closing the dialog; it is not displayed again. Store it
   as `LEXWARE_API_KEY` in the backend environment. Add Lexware in Vibe64 and
   enter `env:LEXWARE_API_KEY` in **API key reference**.
4. Record the expiry for operations: keys may be valid for up to 24 months.
   Use the provider's renewal controls before expiry. Changed permissions
   require a new key; update the environment binding and verify it before
   retiring the previous key.

[Provider key setup and lifecycle](https://help.lexware.de/de-form/articles/548863-alles-rund-um-public-api).

## Configuration and library calls

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "contacts": {
      "provider": "lexware",
      "displayName": "Accounting contacts",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "api-key", "secretRef": "env:LEXWARE_API_KEY" }
    }
  }
}
```

Compose `providers: [lexwareProvider]` with the
[API-key pattern](../patterns/api-key-connection/PATTERN.md), environment
references, an authorized application context and the file connection store.
Both CLI and editor use this schema. Runtime state uses encrypted JSON outside
application source; a database is not required.

```js
await connections.connectApiKey({ context, integrationId: "contacts" });
const page = await connections.invoke({
  context, integrationId: "contacts", operation: "contacts.list",
  input: { page: 0, size: 25, customer: true }
});
```

The runtime uses bearer authentication and
`GET https://api.lexware.io/v1/contacts`. The current origin replaces the old
Lexoffice API origin. Pages are zero-based; size defaults to 25 with a maximum
of 250 for contacts. Optional `customer` and `vendor` booleans filter contact
roles. Results include `content` and page metadata (`first`, `last`, `number`,
`size`, `totalPages`, `totalElements`, `numberOfElements`).
[API documentation](https://developers.lexware.io/docs/).

The fragment requires positive integer size and caps the page number at 100000.
It validates the envelope while preserving contact fields and empty pages.
Request the next numbered page explicitly until `last` is true. It performs no
background scan. Name/email searches, sorting and partner OAuth
are outside this fragment; unsupported input fields are rejected rather than
forwarded. Provider-specific escaping for text searches therefore needs an
explicit implementation before those filters can be added.

The key is sent only to the fixed HTTPS API origin; redirects are rejected.
Changing the environment key takes effect on the next request. A rejected key
requires verification again. Disconnect deletes the local connection record,
not the provider key. A contact's email address is not proof of an app user's
identity; the application owns login and authorization.

## Automation and application ownership

An AI can prepare JSON, secret references, JSKIT composition and contact-reading
code. The reviewed setup guide describes dashboard key creation, without a
self-service API for creating customer accounts or their API keys. Treat those
as manual owner/admin steps. A partner authorization flow would need its own
documented adapter and agreement; this fragment does not activate one.

The application's key is a credential, not an OAuth app registration. Customer-owned accounting connections require
customer-owned keys. There is no callback URL, so VM subdomains and deployed
app domains do not affect this key flow.

Lexware documents a client rate limit of two requests per second across API
endpoints. The reviewed material does not establish that issuing another key
provides an independent allowance. Apply usage limits in the application and
confirm provider capacity before claiming quota isolation.
[API rate limits](https://developers.lexware.io/docs/).

## Focused evidence

Simulated replies and real temporary file state verify authentication, restart,
rotation, ownership, disconnect, empty/full contact pages, role filters,
fractional/oversized input rejection and malformed/provider failures. The
editor check verifies reference-only storage and persistence after reload.
Live provider accounts, billing changes and sample-app generation are excluded.

## Accounting operations

`contacts.get`, `articles.get`, `invoices.get`, `vouchers.get` take a resource UUID.
`articles.list` accepts page/size plus articleNumber, gtin and PRODUCT/SERVICE type.
`vouchers.list` reads `/v1/voucherlist`: choose voucherType and voucherStatus
explicitly, optionally contactId/archived/page/size. The invoice type must be
retrieved with invoices.get; bookkeeping purchase/sales vouchers use vouchers.get.
Other voucher types require their native endpoint.

`invoices.createDraft` deliberately creates only net-EUR invoices for an existing
contact, with 1–100 custom lines. It takes contactId, voucherDate, shippingDate,
shippingType (service/delivery), lineItems and optional title/introduction/remark.
Each line supplies name, quantity, unitName, netAmount and taxRatePercentage.
No tax rate is inferred. Review accounting values and authorization in app code.
Review/finalize the resulting draft in Lexware; there is no send/payment action.

```js
await connections.invoke({ context, integrationId: "contacts",
  operation: "invoices.createDraft", input: {
    contactId: approvedCustomer.lexwareId,
    voucherDate: approvedInvoice.date, shippingDate: approvedInvoice.serviceDate,
    shippingType: "service", lineItems: approvedInvoice.lines
  }
});
```

`approvedCustomer` and `approvedInvoice` are app-owned, authorized business data.
A Laravel or other native backend can use its own HTTP client with the same
private key/configuration and the documented Lexware endpoint. JSKIT adds no
accounting database, tax engine or scheduler. A CLI uses the same library call.

**LIMITATIONS:** No contact/article/voucher writes, receipt uploads, PDF downloads,
quotation workflows, gross/tax-free invoice creation, finalization or event
subscription receiver. Example: a booking can prepare a draft for an existing
customer, but cannot ingest an expense receipt or deliver an invoice PDF with
this adapter. Native app code must cover those features separately. Editor
assistant attachment is deferred. No live financial action or generated app was
executed. Failed/uncertain creation is never automatically repeated: inspect
vouchers first. Provider validation remains authoritative.
