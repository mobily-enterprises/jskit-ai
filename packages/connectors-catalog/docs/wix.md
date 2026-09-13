# Wix

Import `wixProvider` from `@jskit-ai/connectors-catalog/server/wix`. The
runtime reads account sites and business locations, manages site contacts and
booking-service settings, queries availability, creates/cancels bookings, reads orders
and reads/edits products in both Wix catalogue versions. Vibe64 and CLI consumers
edit the same JSON and use shared validation, authorization and encrypted file
storage. Provider acceptance is still in progress; see Verification status below.

## Provider setup

1. Sign into the intended Wix account as an owner or co-owner. Open account
   settings and its API Keys Manager. Copy the Account ID shown there.
2. Generate a key, name it for this integration and select **Read Site Data**
   for querying sites. Grant only the access the application needs. Complete
   the requested verification and store the issued token securely on the backend.
3. In an Enterprise dashboard, the documented path is API Keys, **Generate API
   Key**, key details/permissions, **Generate Key**, account verification, then
   **Copy Token & Close**. Other account dashboards may present different labels.
4. Put the token in `WIX_API_KEY`; put its reference and the Account ID in the
   JSON below. The account ID is not a site ID. Save the file, then explicitly
   call `connectApiKey` when ready. It checks account site discovery; it does not
   prove permission for every site operation. Verify the intended read operation
   before enabling its feature, and grant write permissions only when needed.

[Key generation](https://dev.wix.com/docs/go-headless/authentication/admin/generate-an-api-key),
[Enterprise console steps](https://support.wix.com/en/article/wix-enterprise-using-wix-api-keys),
[account and site identifiers](https://dev.wix.com/docs/develop-websites-sdk/code-your-site/authorization/make-rest-api-calls-with-an-api-key).

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "website-account": {
      "provider": "wix",
      "displayName": "Wix sites",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "api-key", "secretRef": "env:WIX_API_KEY" },
      "settings": {
        "accountId": "01234567-89ab-cdef-0123-456789abcdef",
        "siteId": "12345678-9abc-def0-1234-56789abcdef0"
      }
    }
  }
}
```

Replace both illustrative IDs with your own account and intended site. Site ID
is required for every operation except `sites.list`; omit it only while discovering
the site. Copy it from the Wix dashboard URL after `/dashboard/`, or from an
authorized `sites.list` result. Save and verify again after changing either binding. Assistant ownership is available with the host's access policy. Per-user
OAuth and Wix member/application login are separate flows, outside this fragment.
An account key grants administrative access without a user session; it must stay
on the server. [Authentication boundary](https://dev.wix.com/docs/overview/auth-permissions/authentication-methods).

## CLI and runtime

Compose `createConnectionService` with `wixProvider`, the parsed file, encrypted
file storage and the host's trusted owner/operation policy, following the
packaged API-key connection pattern. Pass this provider to configuration
validation as well. No application template or editor database is needed.

```js
await connections.connectApiKey({
  context: authenticatedOwner, integrationId: "website-account"
});
const page = await connections.invoke({
  context: authenticatedOwner, integrationId: "website-account",
  operation: "sites.list", input: { limit: 20 }
});
const next = page.metadata?.cursors?.next;
// Pass next as input.cursor only for an explicit subsequent page request.
```

`sites.list` POSTs to `https://www.wixapis.com/site-list/v2/sites/query` with a
`query.cursorPaging` object. `limit` is 1–100 (library default 20); `cursor` is
an opaque returned string. There is no arbitrary filter, URL, account override
or site-write operation on `sites.list`. Empty site lists are successful. Results use REST `id`, not
the SDK's `_id`, and preserve original site fields plus optional metadata.
Wix documents a maximum of 1,000 retrievable sites for this endpoint; this
fragment does not promise a complete unlimited account export.
[Query Sites](https://dev.wix.com/docs/api-reference/account-level/sites/sites/query-sites),
[endpoint limitations](https://dev.wix.com/docs/api-reference/account-level/sites/sites/introduction).

`sites.list` sends the key itself in `Authorization` and the configured account
in `wix-account-id`. Site operations instead send only `wix-site-id`. No Bearer
prefix is added to the key.
Keep cursors with the same account and query. Consumers must authorize returned
site data and treat returned URLs as data, not privileged runtime destinations.
[REST headers](https://dev.wix.com/docs/develop-websites-sdk/code-your-site/authorization/make-rest-api-calls-with-an-api-key).

The runtime verifies before saving and resolves the key reference again for
later operations, allowing operator rotation. Status reports reconnect-required
after a key change until verification or a successful operation verifies it.
Changing the account or site setting requires
verification again. Local disconnect deletes local access without revoking the
provider key. API failures are sanitized; 401 requires reconnect, 403 indicates
missing access, and 429 reports a rate limit without retrying. Malformed result
fields and input values fail explicitly. Cancellation preserves a verified grant.

## Public, Online and automation

For this account-key flow, the universal OAuth callback is **not applicable**.
Customer VPS and custom-domain URLs do not enter the provider authentication
request. Each connected customer account requires its own authorized account
binding. A single Vibe64-owned account key cannot grant access to unrelated
customers' Wix accounts.

The application owner supplies the authorized key and its matching Wix account
binding through private Env and configuration. The backend enforces access to
that account and keeps the key off browsers. Separate keys do not establish
independent quota pools; provider limits and permitted use still apply. CLI and
Vibe64 users configure the same application-owned key flow.

| Task | Automation assessment |
|---|---|
| Create an application-owned provider registration | This captured mode uses account keys, with no OAuth app registration. Other Wix app flows require a separate implementation. |
| Issue account keys | Reviewed documentation establishes the console and account verification process. No unattended key-issuance API was established for this workflow. |
| Prepare configuration and runtime wiring | AI can write/validate the portable file, compose existing library APIs and supply the operation policy. |
| Read accessible sites | The library performs explicit pages after verification. It does not create, publish or modify sites. |

## Capability and permission map

Permissions below are granted to the key in Wix. The JSON `scopes` remains empty;
selecting a capability in an application cannot grant a missing provider permission.

| Workflow | Operations | Required access |
|---|---|---|
| Find account sites | `sites.list` | Read Site Data |
| Select business locations | `locations.list/get` | Read Locations |
| Read contacts | `contacts.list/get` | Read Contacts |
| Create/edit contacts | `contacts.create/update` | Manage Contacts |
| Read booking offerings | `bookingServices.list/get` | Read Bookings - Public Data |
| Create/edit services; create/cancel bookings | `bookingServices.create/update`, `bookings.create/cancel` | Manage Bookings |
| Inspect bookings | `bookings.list` | Read Bookings or applicable Manage Bookings access |
| Check appointment/class availability | `availability.list/get`, `classAvailability.list/get` | Time Slots read permission |
| Discover booking form fields | `forms.summary` | Get Form Summary |
| Read orders | `orders.list/get` | Read Orders |
| Discover catalogue version | `catalog.version` | Read v3 catalog (PII) |
| Read V1/V3 products | `productsV1.list/get`, `productsV3.list/get` | Read Products / Read products in v3 catalog |
| Edit V1/V3 products | `productsV1.update`, `productsV3.update` | Manage Products / Product write in v3 catalog |

The runtime's trusted host policy must authorize the actual operation and its
business object. A shared site key is not proof that an app user owns a booking,
contact or order. Authorize that relationship before returning data or writing.
The generated app owns its customer screens, checkout and domain-specific rules.
Public Vibe64 owns editing this project configuration; Online adds no Wix gateway.

## Verification status

The controlled provider suite currently passes **40/40**, including identity
headers, input validation, pagination, exact revisions, write bodies, ownership,
key rotation and failure handling. These use fixtures, not a live Wix account.
The expanded and compact editor cases each pass with the current Site ID,
Selectable Site IDs and setup guidance: invalid input, text configuration save and
reload, missing credentials, connect, reconnect and local disconnect. These browser
cases use controlled connection responses. A freshly packed catalog installed
offline in a standalone consumer passed the same 29 controlled cases through
public package exports, including this guide’s configuration. This proves the
implemented operations and configuration/lifecycle UI, not the missing workflows
below or live provider behavior.
No generated application, payment, real booking or release has been exercised.

The following remain outside the implemented operations and need explicit scope
reconciliation before acceptance: scheduled session management,
variable-duration and service-variant/add-on booking choices, product creation,
variant/inventory edits, checkout/fulfilment/refunds.
Do not infer support for them from a successful connection check.

## Site CRM queries

Set `settings.siteId` to the intended site's ID, copied from the Wix dashboard URL
after `/dashboard/`, or selected from `sites.list`. Grant the key **Read Contacts**
and restrict its site access to the intended sites. Save configuration and verify
again after changing this binding. By default the caller cannot override this site. Explicit selection is allowed
only through the configured Selectable Site IDs described below. The app's authorization policy controls which user may read its contacts.

`contacts.list` accepts `limit` (1–100, default 20), `offset` (0–100000, default 0)
and optional `search` (1–100 characters). It calls the documented Contacts v4 query
with `query.paging` and top-level search. The backend sends the API key and only
`wix-site-id`; `sites.list` continues to send only `wix-account-id`. These two
identity headers must not be combined. Contact fields and paging metadata remain
provider data; no personal details are exposed to unauthenticated callers by the
library. Native frameworks use the same endpoint and header selection.

[Contacts query](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/query-contacts).

Rotating the Env key changes status to reconnect-required until a successful
verification or authorized operation verifies the new key. No OAuth callback or
application login is introduced by this administrative credential.

## Contact creation and updates

Grant **Manage Contacts** for `contacts.create` and `contacts.update`, and
**Read Contacts** for `contacts.get` and `contacts.list`. These are permissions
on the provider key, rather than OAuth scopes chosen in the application file.
The same configured Site ID and private Env key are used by CLI and editor hosts.

- `contacts.create`: `{ info, allowDuplicates?: false }`. Supply a name, an email
  or a phone; company alone is insufficient. Supported info fields are
  `name: { first, last }`, `company`, `jobTitle`,
  `emails: { items: [{ email, primary?, tag? }] }`, and
  `phones: { items: [{ phone, countryCode?, primary? }] }`. Email and phone lists
  are bounded to 50 entries. Duplicate creation remains disabled by default.
- `contacts.get`: `{ contactId }`. Use its returned `contact.revision` when editing.
- `contacts.update`: `{ contactId, revision, info, allowDuplicates?: false }`.
  Submit the intended changed fields. Revision is required and Wix rejects stale
  changes; reload and reconcile with the user rather than automatically replaying.

Native frameworks POST to `/contacts/v4/contacts`, GET a contact by ID, or PATCH
`/contacts/v4/contacts/{contactId}` with revision and info. Returned contact IDs
are checked against the requested target. The app owns authorization, validation
of business intent and handling of uncertain writes. A successful transport is
not proof of a live provider connection in this milestone.

Member login emails use Wix's separate Members API; do not use contact updates
to change them. Contact merging, deletion, addresses, labels and custom fields
are outside these operations.

[Create Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/create-contact),
[Update Contact](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/update-contact).

## Booking service catalog

Enable Wix Bookings on the intended site. Grant **Read Bookings - Public Data**
for `bookingServices.list/get`, and **Manage Bookings** for updates. The configured
Site ID controls every request; account discovery remains separately account-bound.

`bookingServices.list` accepts `limit` (1–100, default 20) and `offset`
(0–100000, default 0), returning services and provider paging metadata.
`bookingServices.get` accepts `{ serviceId }`. `bookingServices.update` accepts
`{ serviceId, revision, name?, description?, tagLine? }`, with at least one changed
field. Copy the returned revision **as a string**, including values beyond
JavaScript's safe integer range. Wix checks that it is current; the adapter does
not automatically replay conflicts or network failures.

Native frameworks use POST `/_api/bookings/v2/services/query` with `query.paging`,
GET `/_api/bookings/v2/services/{id}`, and PATCH that path with
`{ service: { id, revision, ...changedFields } }`. Returned service IDs are checked
against the requested target. Service IDs refer to offerings, not appointments.
The app owns editing screens, authorization and reconciliation. Service creation
and updates to pricing, staff and appointment constraints are documented below.
Scheduled sessions, service locations and add-ons use separate native operations.

[Query Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services),
[Update Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/update-service).


### Cancel an existing booking

`bookings.cancel` accepts `bookingId`, the current `revision` as an exact decimal
string, optional `notifyParticipants` and `message`, and optional `waiveCharges`.
Both booleans default to false. A message requires notification to be enabled.
The project backend must authorize access to that booking before invoking it.
The configured Site ID determines the Wix site unless the caller selects a
project-approved site through Selectable Site IDs.

This uses [Cancel Booking](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/cancel-booking)
and requires Manage Bookings. It preserves normal provider cancellation policies,
rejects an unexpected booking/status response, and never retries a conflict or
ambiguous write automatically. Read the current booking state before deciding
whether another attempt is appropriate. `waiveCharges` can also cancel an eligible
outstanding Wix eCommerce order under Wix's documented conditions; it does not
issue a refund. Applications own their cancellation confirmation and notification UI.
The same operation/configuration is available to CLI-created JSKIT apps; other
frameworks can use that documented endpoint with their own HTTP/runtime code.

Booking creation and appointment availability are described below.
Do not substitute [Confirm Booking](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/confirm-booking)
for a normal availability check: that method explicitly confirms without checking
availability and is restricted to custom checkout flows. Wix eCommerce checkout
owns confirmation in its own flow.


### Read bookings before acting

`bookings.list` uses [Query Extended Bookings](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-reader-v2/query-extended-bookings).
Pass optional `bookingId` for an exact ID lookup, or `limit` (1–100) and `offset`
for a page. It returns native `extendedBookings` and `pagingMetadata`, including
current booking revision/status and requested `allowedActions`. Empty results are
valid, including an ID that no longer exists. A filtered response containing a
different booking is rejected. Do not assume an allowed action is still available
later; cancellation can fail if policy or revision changed in the meantime.

Grant the corresponding Read Bookings permission (or Manage Bookings for the
administrative write workflow). This is a backend site-wide credential, not each
customer's authorization. The generated app must check booking ownership before
returning private details or invoking actions. Frameworks other than JSKIT use the
same configured site and Env credential with their native HTTP client. No editor
or Vibe64 server is required by the deployed app.


### Appointment availability

`availability.list` accepts an appointment `serviceId`, explicit IANA `timeZone`,
`fromLocalDate` and `toLocalDate` in `YYYY-MM-DDThh:mm:ss` without an offset, and
optional `limit` (1–1000, default 100). It requests bookable slots using
[List Availability Time Slots](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots).
For the next page pass only the returned `cursor` and the same `limit`. Responses
retain native resources/location details and `cursorPagingMetadata`.

After selection, call `availability.get` with `serviceId`, `timeZone`, and the
returned `localStartDate`/`localEndDate`. This uses
[Get Availability Time Slot](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/get-availability-time-slot).
Check `timeSlot.bookable` again; false is a valid changed-availability result.
The operation does not reserve capacity. Creation can still fail due to a race.
These calls require the Time Slots read permission
(`BOOKINGS.AVAILABILITY_READ_TIME_SLOTS`) on the project's Wix key.

The generated app owns the date picker, customer authorization and stale-slot
message. CLI-created JSKIT apps invoke the same operations; other frameworks use
these native endpoints with the same site/Env configuration. Current operations
cover appointment defaults. Class/event slots are described below. Duration-range choices still need implementation; resource/location filters are
described below.



### Create a booking

`bookings.create` uses [Create Booking](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking)
with Manage Bookings permission. Required common input: `serviceId`, `kind`,
`timeZone`, and `formSubmission` (JSON object, at most 100 KB). For fixed-price
services, `totalParticipants` defaults to 1. Optional `notifyParticipants` and
`sendSmsReminder` both default to false in this adapter; opt in deliberately.

- `APPOINTMENT`: supply increasing local `startDate`/`endDate`, selected
  `resourceId`, and `location` (`locationType`, business `id` where applicable,
  optional name/formattedAddress). Recheck availability first.
- `CLASS`: supply the selected `eventId`; Wix derives slot details. Do not mix
  appointment fields into this input.
- `COURSE`: supply the selected `scheduleId`; verify remaining capacity first.

Fetch the service's `form.id` and use
[Get Form Summary](https://dev.wix.com/docs/rest/crm/forms/form-schemas/get-form-summary)
to build the form. Use each returned field's exact `target` as its
`formSubmission` key, not its display label. Wix stores standard contact fields
on the booking contact and other fields in its form submission. The app owns the
form rendering, validation, customer authorization and any checkout. Use `forms.summary` with `formId` for that discovery; the native GET endpoint is
`https://www.wixapis.com/form-schema-service/v4/forms/{formId}/summary`.

The response is the native booking, including its real status. Creation does not
mean payment or confirmation. No payment status or policy override can be supplied
through this operation. An unavailable/full slot or missing required form value
can fail at Wix; surface a useful application error and do not retry the create
blindly. JSKIT CLI apps use this same operation with project config/Env; other
frameworks use the documented POST body with their own HTTP library. Custom/duration variants and add-ons are supported as described below;
custom-checkout confirmation is explicit as described below; Wix-hosted checkout uses Cart V2 below.


### Booking form discovery

`forms.summary` reads the selected service's `form.id`. It returns the native
`formSummary`: field `target`, `label`, `type`, `options`, `deleted` and nested
field data where provided. Skip deleted fields, escape labels when rendering, and
map submitted values to exact targets. The summary intentionally omits complex
validation/layout details; it is not a complete form-validation engine. Applications
must still handle Wix validation failures, and complex custom forms may need the
full native Forms API. Grant Get Form Summary (`forms:v4:form:get_form_summary`)
as required for the intended site's forms. API-key authorization stays server-side.

The operation uses a fixed site and validates the returned form identity and
basic field structure. No field data becomes executable markup. CLI callers use
`connections.invoke({ context, integrationId, operation: "forms.summary", input:
{ formId } })`; other frameworks call the same GET with their own HTTP client.



### Class availability

`classAvailability.list` takes the same service/local-date/time-zone range as
appointment availability, plus optional `minBookableCapacity` for party size.
It uses [List Event Time Slots](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-event-time-slots),
filters to the selected service, and excludes non-bookable slots. Continue with
only `cursor`/`limit`; class responses use `pagingMetadata`, while appointment
responses use `cursorPagingMetadata`.

Call `classAvailability.get` with the selected `timeSlot.eventInfo.eventId` as `eventId` and `timeZone` to use
[Get Event Time Slot](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/get-event-time-slot).
Check current bookability/capacity before submitting `bookings.create` with
`kind: "CLASS"`. The generated app owns party-size selection and lost-capacity
feedback. This does not reserve seats. A mismatched event/service/time-zone
response is rejected. CLI/native framework users follow the same native flow and
project-owned credentials; no Vibe64 service participates in the booking.


### Select a resource and location

Appointment `availability.list` accepts up to five `locations` and up to 100
`includeResourceTypeIds`. These type IDs request resource detail in the response;
they do not themselves select a particular staff member. Wix normally leaves
`availableResources` empty on list responses unless resource details are requested.
`availability.get` returns candidate resources by default and accepts `location`
and up to eight `resourceTypes` entries, each with `resourceTypeId` and 1–135
`resourceIds`, to recheck a chosen resource. Use resource IDs, not staff contact IDs.

Availability location types differ from Bookings Writer types. Follow Wix's
[location mapping](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/get-availability-time-slot):
`BUSINESS` becomes `OWNER_BUSINESS`, and `CUSTOM` becomes `OWNER_CUSTOM` when
passing a selected location to `bookings.create`. Business locations require their
ID. For a customer-chosen address, collect the address and use the writer's
`CUSTOM` location explicitly. Do not copy availability's `CUSTOMER` enum into the
writer request. CLI/native framework code must perform the same mapping.

The native class slot nests its event ID at `eventInfo.eventId`; there is no
top-level slot `eventId`.

### eCommerce order reads

Grant **Read Orders** on the intended site's API key. `orders.list` uses
[Search Orders](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/search-orders)
with optional `status`, buyer `contactId`, and `limit` (1–100, default 20).
Continue with only the returned `cursor` and `limit`. The result preserves native
orders and `metadata`, including decimal money strings and payment status.
A contact filter is a query convenience; the app must separately enforce who can
read each order. Never expose site-wide order data to an unauthenticated caller.

Wix excludes PENDING and REJECTED orders by default; request those statuses
explicitly when needed. Search never returns INITIALIZED orders. Use `orders.get`
with a known `orderId` for the individual
[Get Order](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/get-order)
endpoint. Missing orders produce the provider error; a response for a different
order is rejected. Neither operation collects payment or changes an order.
Detailed transaction/refund history requires the native transactions API.

CLI-created JSKIT apps invoke these operations through the same connection
service; other frameworks use the same site-scoped endpoints and Env key with
their own HTTP client. The generated app owns commerce screens, authorization,
fulfilment and payment reconciliation. No Vibe64 gateway or managed key is used.



### Determine the store catalogue version

Call `catalog.version` with no input, after setting the project's Site ID. It uses
[Get Catalog Version](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-versioning/get-catalog-version)
and returns `V1_CATALOG`, `V3_CATALOG` or `STORES_NOT_INSTALLED`. The latter is a
valid prerequisite result: install Wix Stores in the intended site before trying
to use product operations. Grant the documented **Read v3 catalog (PII)** permission
for version discovery, along with the permissions needed for actual product access.

Wix's [catalogue-version guidance](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-versioning/introduction?apiView=SDK)
requires using the site's actual version. V1 and V3 are incompatible, including
product/variant data and paging. Product support must cover both; do not assume
new-site V3 behavior applies to existing stores. The same check is available to
CLI apps and native frameworks, using only the site-owned key and configuration.
No automatic store installation, catalogue migration or account provisioning occurs.


### Read products from either catalogue

Start with `catalog.version`, then select `productsV1.list`/`productsV1.get` or
`productsV3.list`/`productsV3.get`. A site without Wix Stores needs installation
before these operations. Both get operations accept `productId`; list limits are
1–100, default 20. All operations use the project's configured Site ID.

- V1 uses `offset` (default 0) and optional `includeVariants` (default false).
  It preserves `metadata` and `totalResults` from
  [Query Products V1](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/query-products).
- V3 uses the returned `cursor` and preserves `pagingMetadata` from
  [Query Products V3](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products).
  V3 product queries omit variants. Use the individual
  [Get Product V3](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product)
  operation for product/variant details.

Grant Read Products for V1 or Read products in v3 catalog for V3. Hidden products
require additional provider administrative permissions; these list operations do
not request hidden products or merchant-specific financial data. A provider denial
is surfaced without retrying another catalogue version. Recheck the actual version
if a site was migrated; never reuse an old cursor across versions.

The library preserves native prices, variants and product data, including the
structural differences between V1 and V3. Applications own the product UI and
version-specific interpretation. CLI-created JSKIT apps use these same names and
configuration; other frameworks dispatch to the documented native endpoints after
version discovery. No compatibility shim converts money or variants between APIs.



### V3 product name and visibility edits

After `catalog.version` returns `V3_CATALOG`, use `productsV3.get` to read the
current revision, then `productsV3.update` with `productId`, the exact string
`revision`, and `name` (1–80 characters), `visible`, or both. Requires **Product
write in v3 catalog** on the configured site. The runtime sends only those
changed scalar fields; omitted fields remain unchanged. Wix also changes the
default variant's visibility for a product without options. For products with
options, variant visibility is independent.

A conflict requires a fresh read and a deliberate decision about the proposed
change. Failed writes are not automatically replayed. This operation does not
edit variant arrays, prices or inventory; their separate contracts remain work
in progress. Applications and CLI consumers use the same project-owned runtime
and Env key, with their own administrator authorization.

Contract: [Wix Update Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/update-product).


### V1 product edits

For `V1_CATALOG`, `productsV1.update` accepts `productId` and at least one of
`name` (1–80 characters), `visible`, or numeric `price` (0–999999999.99).
Grant **Manage Products** to the site API key. Prices are base prices in the
site's currency, not minor units or converted visitor prices. Zero is valid.
The adapter uses `PATCH /stores/v1/products/{id}`; reads use the separate
`stores-reader` endpoint. Omitted fields are preserved. V1 does not offer the
V3 revision guard: the app must manage concurrent administrator edits and
reconcile uncertain writes before trying again. This operation does not edit
variant prices, discounts or inventory.

Contract: [Wix V1 Update Product](https://dev.wix.com/docs/rest/business-solutions/stores/catalog/update-product).


### Business locations for booking selection

Grant **Read Locations** for `locations.list` and `locations.get`. Both use the
configured project Site ID. List accepts `limit` (1–100), `offset` and `archived`
(default false), and requests only authorized locations. The response preserves
Wix addresses, business schedules and time zones; the app chooses which details
to expose. Get accepts `locationId` and checks the returned identity. Use these
IDs for business-location availability filters and booking creation, with each
API's documented location-type mapping. Location discovery does not reserve a
slot or change business hours. CLI consumers invoke the same operations.

[Wix Query Locations](https://dev.wix.com/docs/api-reference/business-management/locations/query-locations).


### CMS collection browser

`cmsCollections.list` reads collections for the configured site. Grant **Manage
Data Collections**, even though these operations only read. Pass `limit` (1–100),
`offset` and optional `consistentRead` (default false). Responses preserve
`collections` and `pagingMetadata`, including field metadata. Use
`cmsCollections.get` with the returned `collectionId` to inspect a collection.
App collection IDs such as `AppName/CollectionName` retain their namespace.
Both operations are site-bound; another Site ID is accepted only when explicitly
approved through Selectable Site IDs.

Consistent reads request primary-database data at a performance cost. The app owns
collection selection, escaping metadata labels and authorization. This is schema
browsing, not content-item querying, collection replacement or field deletion.
CLI apps use these operations and the same Env key; native frameworks use the
GET collection endpoints with their own client.

[Wix List Data Collections](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/list-data-collections).


`cmsItems.list` completes content browsing after collection selection. Grant
**Read Data Items**, then pass `collectionId`, `limit` (1–100), `offset` and
optional `consistentRead`. It calls `POST /wix-data/v2/items/query` and preserves
native `dataItems` and `pagingMetadata`, including Wix date objects. Cross-collection
results are rejected. The app must authorize collection and record access before
exposing content, and safely render field values. Field editing is available through cmsItems.patch below; draft/publication workflows remain unimplemented.

[Wix Query Data Items](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-data-items).


### Select an authorized site inside the app

For multi-site operations, the project owner may set `settings.selectableSiteIds`
to a comma-separated list of up to 100 distinct Wix Site IDs. Discover IDs with
`sites.list`, then explicitly approve the sites in project configuration. This is
not an account-wide wildcard. Save and verify the changed configuration again.

All site operations accept optional `siteId` when it occurs in that configured
list. Omission uses `settings.siteId` as before; an explicit unlisted ID is rejected
before network access. `sites.list` stays account-scoped and rejects this override.
Each request gets its own site header without changing configuration or another
request's binding. The host authorization callback receives the original input,
including siteId, and must authorize that user's access to the requested site and
business object. Hide unauthorized sites in the app's picker as well.

This is the same text configuration and operation interface for CLI projects.
Other frameworks must enforce the configured allowed IDs and user authorization
before choosing the site header. No new Vibe64 server or gateway is involved.


### Filtered CMS content and references

`cmsItems.list` also accepts native `filter`, `sort`, `fields`,
`returnTotalCount` and `includeReferences` options. They use the same Read Data
Items permission and project-owned site connection as unfiltered queries:

```js
const page = await connections.invoke({
  ...owner,
  integrationId: "wix",
  operation: "cmsItems.list",
  input: {
    collectionId: "Articles",
    filter: { published: true },
    sort: [{ fieldName: "title", order: "ASC" }],
    fields: ["title", "author"],
    includeReferences: [{ field: "author", limit: 1 }],
    returnTotalCount: true,
    limit: 20,
    offset: 0
  }
});
```

Use field keys from the collection schema, not display labels. Wix evaluates
its query-language operators; JSKIT validates the request shape without rewriting
those operators. Filters must be serializable JSON objects within 100KB. Sorts
accept up to 100 fields with ASC/DESC order; projection accepts up to 1000 fields.
An empty projection requests all fields. Reference expansion accepts up to 100
configurations with a reference/multi-reference field and optional limit of 1–1000.
Wix defaults that limit to 50; an expanded reference may therefore be incomplete.
Use `includeReferences`, not the deprecated `includeReferencedItems` parameter.

`returnTotalCount: true` requests offset-page totals, but `tooManyToCount` can
mean no total is available. Preserve that distinction instead of showing zero.
Returned items, related content and paging metadata retain Wix's native shape.
The app must authorize access to the collection and its related data before
invoking the operation; a filter is not an authorization policy. Never accept
arbitrary browser-provided queries as an access-control mechanism.

Other frameworks send these same documented request fields using their native
Wix/HTTP library and backend Env credentials. No editor service or JSKIT runtime
is required for that implementation.

Source: [Wix Query Data Items](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/query-data-items).
The filtered-query case passes in both the source and installed-package suites.


### Read and edit one CMS item

`cmsItems.get` reads a specific `itemId` in a `collectionId`. Set
`consistentRead: true` when current content is needed immediately after a write.
The site remains the configured site or an explicitly allowed runtime selection.

To edit content, grant the API key the permission identified by Wix as
`WIX_DATA.PATCH` in [Patch Data Item](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/patch-data-item).
Keep read-only applications on Read Data Items; enable patch permission only for
apps that need editing. The app must authorize the requested collection, item and
fields before invoking the write.

```js
await connections.invoke({
  ...owner,
  integrationId: "wix",
  operation: "cmsItems.patch",
  input: {
    collectionId: "Articles",
    itemId: "article-one",
    conditionFilter: { title: "Original title" },
    fieldModifications: [
      { fieldPath: "title", action: "SET_FIELD", setFieldOptions: { value: "New title" } }
    ]
  }
});
```

This uses native PATCH, leaving unspecified fields untouched. Field paths use
Wix's dot notation. Supply 1–100 modifications, within 100KB of JSON. Supported
actions are SET_FIELD, REMOVE_FIELD, INCREMENT_FIELD, APPEND_TO_ARRAY and
REMOVE_FROM_ARRAY. Each action uses its corresponding native options object;
REMOVE_FIELD has none. False, zero and null values are preserved. Removing an
array value removes its first matching occurrence according to Wix's semantics.

`conditionFilter` maps to Wix's server-side conditional update. Use expected
field values when concurrent changes should prevent your edit. Omitting it
performs an unconditional patch; the library does not invent a revision token or
perform a read-modify-write replacement. On a conflict, reload and let the user
resolve it. On a timeout or service failure, check the current item before any
explicit retry, particularly for increments and array appends. JSKIT never
replays these writes automatically.

Responses are checked against the requested item and collection. The same
backend Env key and project authorization apply in CLI apps and other frameworks;
use native Wix GET/PATCH calls there. This is not a content-editor UI, schema
migration or draft/publication system.

Controlled source proof: **28/28**, including conditional request shape, wrong
item/collection rejection, explicit field operations and no write replay. The
installed-package suite also passes **28/28** through public exports. The added
permission instruction has expanded rendered proof; compact refresh is pending.


### Create and replace business locations

Grant **Manage Locations** (`LOCATIONS.MANAGE`) in the Wix API key permissions
for writes. `locations.create` accepts name, IANA timeZone and address, plus
optional description, contact details, status, locationTypes, businessSchedule
and extendedFields. `locations.update` additionally requires locationId and the
current exact revision string from `locations.get`. IDs and revisions are never
converted to numbers. Both operations require the project-owned site binding.

**Update replaces the complete writable location.** Read it first and send every
writable field you want retained. Do not treat this operation as a patch. Remove
read-only id/default/archived from the returned object, pass id as locationId,
keep revision, and preserve optional fields such as phone, businessSchedule and
extendedFields. Change only the intended values in that complete object. A stale
revision must be resolved by re-reading the location; there is no automatic retry.
An archived location cannot be updated.

```js
const { location } = await connections.invoke({
  ...owner, integrationId: "wix", operation: "locations.get",
  input: { locationId: "01234567-89ab-cdef-0123-456789abcdef" }
});
const { id, default: isDefault, archived, locationType, ...writable } = location;
await connections.invoke({
  ...owner, integrationId: "wix", operation: "locations.update",
  input: { ...writable, locationId: id, name: "Updated studio name" }
});
```

The deprecated locationType field is omitted. The supported locationTypes list
is retained. Wix currently supports ACTIVE status; changing that is not an
archive operation. BusinessSchedule is passed in Wix's native structure, with
up to 100 regular periods and 100 special-hour periods. Wix validates its time
and schedule semantics. These location hours do not configure Wix Bookings.
The adapter checks address shape, coordinates and timezone and preserves native
extension data. New properties not represented by the adapter must be handled
explicitly before using full replacement; do not silently strip unknown data.

If creation times out, inspect the locations before explicitly retrying to avoid
a duplicate. Native create/update responses preserve the location and revision;
update responses must match the requested location ID. The framework owns app
user authorization, and the same calls work from a CLI-owned Node backend or
through another framework's native Wix client.

Sources: [Create Location](https://dev.wix.com/docs/api-reference/business-management/locations/create-location),
[Update Location](https://dev.wix.com/docs/api-reference/business-management/locations/update-location).
Source suite **29/29** covers native create/PUT bodies, preserved optional fields,
exact revisions, invalid coordinates/timezones, response identity and no retries.
The installed-package suite passes29/29 through public exports; these latest
instructions have expanded rendered proof; compact refresh remains pending. Archive/default-location controls are described below.


### Archive or select the default location

`locations.archive` and `locations.setDefault` each accept only `locationId`
(and an explicitly allowed siteId where configured). Both require Manage Locations.
They make one native POST request and verify the returned location ID and resulting
archived/default flag. The application must authorize these administrative changes.
For example:

```js
await connections.invoke({
  ...owner, integrationId: "wix", operation: "locations.setDefault",
  input: { locationId: "01234567-89ab-cdef-0123-456789abcdef" }
});
```

Only one location can be default for a site. Wix prevents archiving that location;
select another default deliberately before trying to archive it. Archiving sets
archived=true, does not change status, and prevents further location updates.
These controls do not delete bookings or reconfigure their schedules. No supported
public restore endpoint was established from the reviewed API documentation, so
this adapter does not offer a guessed unarchive operation. Do not promise undo.
After an uncertain result, read the location before a deliberate retry.

Sources: [Archive Location](https://dev.wix.com/docs/api-reference/business-management/locations/archive-location),
[Set Default Location](https://dev.wix.com/docs/api-reference/business-management/locations/set-default-location).
Controlled source suite **30/30** passes; installed-package proof remains29/29
until the next refresh. Tests include request placement, resulting state, identity,
provider refusal and host-denied writes. No live site has been modified.


### Create a booking service

`bookingServices.create` accepts a native `service` object within 100KB of JSON,
using Manage Bookings on the configured site. It creates appointment, class or
course services with explicit name, type, defaultCapacity, onlineBooking and
payment settings. The adapter checks required relationships and preserves the
native remaining fields; Wix validates those fields and referenced resources.

```js
await connections.invoke({
  ...owner, integrationId: "wix", operation: "bookingServices.create",
  input: { service: {
    type: "APPOINTMENT", name: "Consultation", defaultCapacity: 1,
    onlineBooking: { enabled: true, requireManualApproval: false },
    payment: { rateType: "FIXED", fixed: { price: { value: "50.25", currency: "AUD" } },
      options: { inPerson: true, online: false } },
    staffMemberIds: [staffResourceId],
    schedule: { availabilityConstraints: { sessionDurations: [30] } },
    category: { id: categoryId }
  } }
});
```

Obtain the staff resource and category IDs with bookingStaff.list and
bookingCategories.list on the selected site, as shown below. Despite its name, staffMemberIds takes resource IDs,
not staff member IDs. Appointments need at least one staff resource and positive
session durations in minutes, with capacity1. Classes and courses take capacity
1–1000; create their sessions separately and do not send appointment durations.
Services without category assignment are not visible on the live Wix site.
The connector does not auto-create staff, categories or scheduled sessions.

Choose FIXED, VARIED, CUSTOM or NO_FEE. Fixed/varied amounts are positive decimal
strings with up to two decimal places and an ISO currency. Even free services
must select an in-person or online payment option. Online payment requires fixed
or varied pricing and online booking enabled. Deposits additionally require a
deposit amount and in-person payment disabled. Manual approval cannot be combined
with pricing-plan payment. Subscription-priced courses are not implemented here.

Do not supply generated service IDs/revisions or existing add-on groups during
creation. For varied appointment durations, the supplied sessionDurations remain
mandatory, but Wix actually uses the service variants for pricing/availability;
creating the service does not configure those variants. Add-ons also require their
own creation workflow. Those workflows remain open rather than implied by success.

Authorization stays with the application, and no provider write is retried.
If a request times out, inspect existing services before an explicit retry to
avoid duplicates. A successful response returns the native service ID and
revision. This configures how the service may be paid for; it does not charge a
customer or establish an online payment provider. CLI and other frameworks can
send the same service object to the native Wix endpoint.

Source: [Wix Create Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/create-service).
Source proof **31/31** includes all three service types, required payment/staff/
duration checks, native price preservation and no replay. Latest installed-package
proof remains29/29 and the added inline setup sentence requires rendered refresh.


### Select service categories and staff

With **Read Bookings - Public Data**, use `bookingCategories.list` and
`bookingStaff.list` to fill your application's service-creation selectors.
Both accept limit1–100 (default20) and a returned cursor. Results retain native
`pagingMetadata`; fetch the next page explicitly until exhausted.

```js
const categories = await connections.invoke({
  ...owner, integrationId: "wix", operation: "bookingCategories.list"
});
const staff = await connections.invoke({
  ...owner, integrationId: "wix", operation: "bookingStaff.list"
});
// Let the authorized administrator choose a category.id and staffMember.resourceId.
```

Category discovery uses Categories V2. Staff discovery uses the documented V1
query, explicitly filters serviceProvider=true and requests RESOURCE_DETAILS at
the request's top level. This returns bookable staff, not the whole company
staff directory. Native staff IDs are preserved, but **service creation uses
resourceId**, not id. The adapter rejects a staff result missing that required
resource identity rather than offering an unusable selection. Resource/schedule
information is preserved for the framework; these queries do not create or
change staff working hours. An empty response means no choices are available,
not a successful automatic service setup.

The app owns the selectors and their authorization. Both operations also work
with explicit allowlisted site selection and the same portable project settings.
Read results can contain staff details; expose only what the user's role needs.
The remaining runtime and CLI guidance applies without an editor dependency.

Sources: [Query Categories](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/categories-v2/query-categories),
[Query Staff Members](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/query-staff-members).
Source suite **32/32** covers cursor and native-body placement, resource identity,
empty choices and rejection of an unsupported staff filter. Installed-package and
latest inline setup rendering still need refresh after these additions.


### Update pricing and booking settings

`bookingServices.update` also accepts payment, onlineBooking, defaultCapacity,
staffMemberIds and schedule.availabilityConstraints. The same serviceId, exact
revision string and Manage Bookings permission apply. Read the service first,
retain the current nested settings and change only the intended values:

```js
const { service } = await connections.invoke({
  ...owner, integrationId: "wix", operation: "bookingServices.get",
  input: { serviceId }
});
await connections.invoke({
  ...owner, integrationId: "wix", operation: "bookingServices.update",
  input: { serviceId, revision: service.revision,
    payment: { ...service.payment,
      fixed: { ...service.payment.fixed, price: { value: "75.10", currency: "AUD" } }
    }
  }
});
```

The example assumes an existing FIXED-price service. Deliberately changing rate
type also requires compatible rate and payment-option fields; Wix checks those
relationships against the existing service. Remove provider-computed read-only
payment data before writing it. The adapter bounds native JSON and request shape,
while Wix validates service-specific rules. False online-booking settings and
zero buffer time are preserved. Staff selections use resource IDs from the staff
lookup; the connector accepts1–100 IDs.

Appointment availability constraints can set sessionDurations and
 timeBetweenSessions. Change sessionDurations only for appointments without varied
pricing based on session length. For varied-duration appointments, configure the
variants instead. Classes/courses get their durations from scheduled sessions.
The library does not fetch the service implicitly to infer its type; the app
must choose appropriate settings from its preceding read.

This operation rejects locations and addOnGroups: Wix requires dedicated
Set Service Locations and add-on operations. It does not create calendar events,
change staff working-hour schedules or resolve revision conflicts automatically.
Source: [Update Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/update-service).
Source suite **33/33** passes, including native nested values, exact revision,
empty settings, invalid JSON and stale writes. Installed-package proof remains
29/29 until refreshed for these additions.


### Replace a service's locations

`bookingServices.setLocations` uses Manage Bookings and takes the full replacement
locations list. Omitting an existing location removes it from the service. The app
must show that effect to its authorized administrator before invoking the operation.

```js
await connections.invoke({
  ...owner, integrationId: "wix", operation: "bookingServices.setLocations",
  input: { serviceId,
    locations: [{ type: "BUSINESS", business: { id: businessLocationId } }],
    removedLocationAction: "KEEP_AT_CURRENT_LOCATION"
  }
});
```

Use BUSINESS with business.id from locations.list; CUSTOM with a complete native
custom.address object; or CUSTOMER with no business/custom details. The connector
accepts up to100 entries. It requires removedLocationAction explicitly, even when
adding locations, so removing one later cannot silently choose a session policy.
KEEP_AT_CURRENT_LOCATION preserves future sessions at their old venue: the business
must still be able to provide access there. MOVE_TO_LOCATION requires moveToLocation
in the same location format and moves future affected sessions to that destination.
Wix does not support mixing these choices per session in this operation. Past
sessions and sessions at customer-defined locations are not relocated.

Participant notifications default off. To notify affected participants, explicitly
set notifyParticipants=true and optionally notificationMessage (up to2000 characters).
A message without that opt-in is rejected. This can notify real people when called
against a live site; the application owns the user confirmation for that action.
There is no automatic retry or invented revision field for this endpoint. After an
uncertain response, inspect the service and affected sessions before deciding what
to do next. Returned service identity is checked against serviceId.

Source: [Set Service Locations](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/set-service-locations).
Source suite **34/34** includes both session decisions, explicit notification,
location details, wrong service results and one-attempt provider failure. All use
fixtures. Package/rendered proof still requires the next refresh.


### Service choices before booking

`bookingServices.getVariants({ serviceId })` retrieves native options and variants
for the selected service through the project-owned site connection. The response
field is `serviceVariants`, not `serviceOptionsAndVariants`. Preserve its option
IDs, choices, revision and decimal price strings. The generated application's
own form displays the choices and collects participants per choice; Vibe64 does
not maintain a separate catalogue or expose the API key to that form.

Use the selected service ID from `bookingServices.list` or `.get`. The API key
needs the service-options read permission (`BOOKINGS.SERVICE_OPTIONS_AND_VARIANTS_READ`);
the standard options lookup is documented under Read Bookings - Public Data.
If permission is missing, edit the key's permissions in Wix Account Settings >
API Keys, update the project's Env value if Wix issues a replacement, and verify
again. A failed lookup is not silently converted to “no variants”: surface the
provider error and check service configuration before offering a booking.

CLI callers use the same invocation and existing Env-backed connection as the
other site operations. Other frameworks call Wix's native endpoint with their
project-owned key and site header. No additional Vibe64 service is required.

The lookup feeds the explicit availability and booking selections below.
The generated app owns the form and authorization. Confirmation is an explicit operation described below; creation does not
automatically confirm or charge a booking.

References: [lookup by service ID](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/service-options-and-variants/get-service-options-and-variants-by-service-id),
[single-service booking flow](https://dev.wix.com/docs/api-reference/business-solutions/bookings/flow-single-service-booking).
Source suite **35/35** passed with controlled transport, including exact endpoint,
site header, preserved choices/prices, mismatched service rejection, malformed
responses, host denial and an unretried 404. Installed-package proof was refreshed: **35/35** passed (719ms) using an
offline-installed tarball in the isolated consumer, including this new operation.
Tarball SHA1: `529b9da1227db1489b359161d2393414948d75ac`. No generated app or live provider was used.


### Apply service choices and add-ons

`bookingServices.listAddOnGroups({ serviceId })` returns all service groups under
`addOnGroupsDetails`, with the native display order, prompts, labels, prices and
selection limits. An empty list is valid. This uses Read Bookings - Public Data.
Render each group's `groupName`/`prompt` and enforce `maxNumberOfAddOns`; enforce
`maxQuantity` for quantity add-ons. Preserve `groupId` and each `addOnId`.

For appointment `availability.list` and `.get`, pass `customerChoices`:

```json
{ "customerChoices": { "addOnIds": ["12345678-9abc-def0-1234-56789abcdef0"] } }
```

A duration variant can use `durationInMinutes`. With add-ons, prefer supplying
only their IDs so Wix calculates duration. If both are supplied, the duration
must include all selected add-on durations. Repeat the same choices when
revalidating the selected slot. Duration-range services do not support this
object; omit it and use their native configured range. Class event availability
continues to use capacity and event IDs, not appointment customerChoices.

For `bookings.create`, use either fixed `totalParticipants` (defaults to 1 when
neither field is supplied) or variant groups:

```json
{
  "participantsChoices": {
    "serviceChoices": [
      { "numberOfParticipants": 2, "choices": [
        { "optionId": "12345678-9abc-def0-1234-56789abcdef0", "custom": "Child" }
      ] }
    ]
  }
}
```

Use `duration: { "minutes": 90 }` instead of `custom` for a duration choice.
Copy these values from the selected service's variants. Do not send both a
custom and duration value, repeat an option within a group, or supply a fixed
total alongside variant groups. The adapter supports up to 20 participant groups,
5 choices each, and 1000 participants in total. Preview choice-ID/date-time/
participant-range variants are not yet exposed by this operation. Wix validates
whether the choices actually exist for the selected service; an invalid-choice
failure is surfaced without retrying the create.

Optional `bookedAddOns` is an array of `{ id, groupId?, quantity? }`, mapping the
lookup's `addOnId` to `id`. Omit quantity for duration add-ons. Use quantity only
for quantity-based add-ons within their returned limit. Do not send calculated
prices, duration or read-only labels in this object. This records selected
add-ons; it does not create or edit the add-on catalogue.

The same JSON inputs work from the JSKIT CLI/runtime. For another framework,
use its native HTTP client: `customerChoices` is top-level in the availability
body; `participantsChoices` and `bookedAddOns` belong inside `booking`. Never
forward the fixed total too. Keep credentials in the project's Env and validate
the app user's choices on the backend before making the request.

References: [add-on lookup](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/list-add-on-groups-by-service-id),
[availability](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots),
[booking](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking).
Source **37/37** passed (790ms), including native availability/booking bodies,
mutually exclusive totals, invalid groups/selections, preserved add-on discovery
and single-attempt provider errors. Installed proof remains the previous
35-case snapshot; the new two cases and newest inline copy need their final
package/rendering refresh. No live booking, customer notification or payment was
performed.


### Custom-checkout booking decisions

Use these operations only for the generated application's **custom checkout**.
For Wix eCommerce checkout, let Wix's order flow update booking confirmation.
The app backend owns payment evidence, the administrator's authorization and the
checkout decision; do not accept payment status directly from a browser.

- `bookings.confirmOrDecline({ bookingId, paymentStatus })` asks Wix to evaluate
  payment, availability and business approval. Supply the actual payment status:
  UNDEFINED, NOT_PAID, PAID, PARTIALLY_PAID, REFUNDED or EXEMPT. Preserve the returned
  CONFIRMED, PENDING or DECLINED result and any doubleBooked flag. There is no
  revision or notification input on this native endpoint. It is not a force-confirm
  operation and does not collect or refund money.
- `bookings.confirm({ bookingId, revision, notifyParticipants?, message? })` is an
  explicit administrator decision. **It does not validate availability**, so it
  can confirm a conflicting booking. Recheck availability and present the conflict
  before the administrator acts. Eligible original statuses are PENDING, CREATED
  and WAITING_LIST. Use the exact revision from the current booking.
- `bookings.decline` takes the same inputs and explicitly declines an eligible
  booking. Notification defaults to false; a message requires notifyParticipants
  true. Declining does not refund a payment.

These require Manage Bookings. Enable that permission on the project's Wix key
only when the app needs booking management. The public editor's configuration
instructions identify the permission; the generated app supplies the booking
review/decision UI. CLI users call the same operations. Other frameworks POST to
Wix's native endpoints with their own HTTP library, project key and site header.

Read the exact booking before acting and reconcile uncertain failures before a
retry. The adapter sends one request and rejects a mismatched booking response.
It never starts checkout, marks an unrelated order paid or silently overrides
booking policies. Existing Wix flow-control settings on externally created
bookings may still affect Wix's automatic decision.

References: [automatic decision](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/confirm-or-decline-booking),
[explicit confirm](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/confirm-booking),
[explicit decline](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/decline-booking).
Controlled source **38/38** passed (786ms), covering all three endpoints, precise
revision strings, notification opt-in, all automatic result states, mismatched
identity, invalid input, host denial and single-attempt failure. Package evidence
still covers the prior35-case snapshot; final refresh remains pending.


### Reschedule appointments and classes

`bookings.reschedule({ bookingId, revision, slot, notifyParticipants?, message? })`
moves an existing appointment or class booking. Query the exact booking first,
check `allowedActions.reschedule`, authorize its owner and recheck the chosen
availability. Use the exact current revision. Manage Bookings is required.

For an appointment, supply the full selected slot with `serviceId`, `scheduleId`,
local `startDate` and `endDate` (`YYYY-MM-DDThh:mm:ss`), IANA `timezone` and the
selected resource/location details. Keep the original service/schedule identity
when moving the booking. V2 time-slot results use `localStartDate`/`localEndDate`;
map these to the writer's `startDate`/`endDate`, using the service's schedule ID.
For a class, pass only `{ "eventId": "the-selected-event-id" }` as slot; it must
belong to the same class. Wix does not support moving course bookings this way.

Notifications default to false and a message requires explicit notification.
The adapter does not forward policy/availability overrides or change add-ons
while rescheduling. Wix validates the move; surface unavailable-slot or stale
revision errors and reload the booking before retrying. Keep the returned status:
a custom-checkout booking may still need the explicit confirmation step.

CLI and other-framework users use the same portable inputs and project Env
credentials; the native request body is `{ revision, slot, participantNotification }`.
The generated app owns the slot picker, confirmation and error handling.

[Wix rescheduling reference](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/reschedule-booking).
Source **39/39** passed (808ms), including full appointment/event requests,
notifications, rejected overrides, invalid timing, mismatched booking identity and
single-attempt provider failure. Final installed and rendered refresh remains
pending; no live changes were made.


### Send a customer to Wix-hosted checkout

Use Cart V2 for new integrations. Wix's Cart V1/Checkout V1 retirement is scheduled
for 1 February 2027. This adapter does not add the deprecated checkout entity.

In Wix Account Settings > API Keys, edit the project's key and select **Write
Carts V2 (PII)** for creation and **Read Carts V2 (PII)** for checkout URLs. The
Create Cart reference also lists **Manage eCommerce - Admin Permissions** as an
alternative permission. Keep the selected site's ID in project configuration.
Publish the Wix site and configure its checkout/payment methods before expecting
a working payment page. SITE_NOT_PUBLISHED or CHECKOUT_PAGE_NOT_FOUND requires
fixing the Wix site, not adding an OAuth app or a Vibe64 gateway.

The app backend calls `carts.create` with a nonempty `catalogItems` array and an
optional `note`. Each item has `quantity` and `catalogReference`:

```json
{
  "catalogItems": [{
    "quantity": 1,
    "catalogReference": {
      "appId": "13d21c63-b5ec-5912-8397-c3a5ddb27a97",
      "catalogItemId": "01234567-89ab-cdef-0123-456789abcdef"
    }
  }]
}
```

For Wix Bookings, use the **created booking ID** as catalogItemId and the Bookings
app ID shown above. For Wix Stores, use app ID `215238eb-22a5-4c36-9e7b-e7c08025e04e`,
the product ID and the appropriate catalogue version's `options`. Native options
are preserved; do not convert V1/V3 variant selections into each other. The adapter
sets the web sales channel and lets Wix resolve catalogue prices. It does not
accept caller price overrides, custom-price items, coupons or membership payment
in this operation. These remain separate capability gaps if the app needs them.

Store `response.cart.id` against the authorized customer in the generated app.
Call `carts.getCheckoutUrl({ cartId })`, then redirect the customer to the returned
`checkoutUrl`. Wix may return its site's custom checkout domain; the adapter
accepts HTTPS URLs without embedded credentials. The app must authorize access to
the cart before requesting or exposing its URL. A cart ID is not a permission.

Cart creation and URL retrieval do not prove payment. Use the order's actual
payment status through the order operations before granting paid access. For
Wix-hosted booking checkout, Wix updates booking confirmation; do not call the
custom-checkout confirmation methods as a second step. Inventory/catalogue
errors must be shown to the customer; the adapter does not silently remove items
or retry creation.

JSKIT CLI/runtime consumers use the same calls with text/Env configuration. Other
frameworks POST `{ cart: { source: { channelType: "WEB" }, note? }, catalogItems }`
to `/ecom/v2/carts`, then POST `{}` to `/ecom/v2/carts/{cartId}/get-checkout-url`
with the project-owned key and `wix-site-id` header. They can use their framework's
normal redirect response. No card details, provider credentials or Vibe64 billing
service are passed through the browser.

References: [Create Cart](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart),
[Get Checkout URL](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/get-checkout-url),
[Cart V2 migration guide](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/migration-guide).
Controlled source **40/40 passed** (823ms), including exact V2 bodies/paths, native
options and money preservation, key/site ownership, invalid URLs/inputs, host
denial and unretried inventory failure. The installed snapshot is still35/35;
newest runtime and inline-copy package/browser proof remains pending. No real
checkout or payment was created.

Installed-package refresh: **40/40 passed** (802ms) in the isolated offline consumer.
Tarball SHA1: `8523ad1db0917879df986d91c5800994dc233291`. This supersedes the earlier35-case
installed snapshot for all current runtime operations. Latest browser proof is
recorded separately.

Latest public-editor verification: fresh-build expanded form/lifecycle **1/1**
passed (27.4s). It explicitly asserts Cart V2 permission labels, add-on guidance
and direct confirmation's availability warning, plus configuration save/reload
and connect/reconnect/disconnect. Compact latest-copy refresh remains pending.


### Read recorded order fulfillments

Grant **Read Orders** to the site's API key. Call
`orderFulfillments.list` with `{ orderId }` through the existing connection service.
The native GET `/ecom/v1/fulfillments/orders/{orderId}` returns
`orderWithFulfillments`, containing the order ID and its `fulfillments` array.
An empty array is valid. Native tracking, custom fulfillment information, status
and completion fields are preserved alongside line-item IDs and quantities.

Your app must authorize the customer's access to the order before invocation.
Keep the selected site bound to the same project connection. Handling status is
not evidence of payment or a substitute for the order's fulfillment quantities.
This reader does not create shipments or send shipping notifications. Use the
separate create/update operations documented below to record shipments or change
tracking. Those writes can trigger Wix shipping notifications.
CLI and other frameworks use the same project Env key, site header and native
endpoint; there is no Vibe64 service dependency.

Reference: [Wix List Fulfillments For Single Order](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/order-fulfillments/list-fulfillments-for-single-order).


### Record shipments and update tracking

In Wix account API-key permissions, add **Manage Orders** for the selected site
and update the same private Env reference if replacing the key. No callback is
needed. Your application authorizes the order and confirms the intended shipment.

`orderFulfillments.create({ orderId, lineItems: [{ id, quantity }], trackingInfo })`
posts `{ fulfillment: { lineItems, trackingInfo } }` to
`/ecom/v1/fulfillments/orders/{orderId}/create-fulfillment`. Obtain line-item IDs
from `orders.get`; this adapter requires explicit quantities. Wix requires an
APPROVED order and checks unfulfilled quantities. It assigns the fulfillment ID.
If supplying tracking, include `trackingNumber` and `shippingProvider`. Custom
carriers also need `trackingLink`; Wix generates links for its predefined carriers.

`orderFulfillments.update({ orderId, fulfillmentId, trackingInfo, status, completed })`
PATCHes `/ecom/v1/fulfillments/{fulfillmentId}/orders/{orderId}`. Pass only changed
fields. Tracking number/provider cannot be removed. Optional `lineItems` replaces
the shipment items with explicit quantities; Wix disallows this once completed.
Status values are Pending, Accepted, Ready, In_Delivery and Fulfilled; these are
handling labels, not payment evidence. The adapter also preserves explicit false
for `completed`. Custom fulfillment fields and deletion are not supplied yet.

Creation or changed tracking can send buyer emails according to Wix site settings.
There is no invented suppress-email option. Order fulfillment totals update
asynchronously; read the order again when the app needs the latest totals. Never
retry an uncertain write automatically: list existing fulfillments and reconcile
before a deliberate retry. A 409 can indicate an existing tracking number.
Other frameworks use these same native requests and project Env credentials.

References: [Create](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/order-fulfillments/create-fulfillment),
[Update](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/order-fulfillments/update-fulfillment).
