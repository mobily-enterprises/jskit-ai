# HubSpot

Import `hubspotProvider` from `@jskit-ai/connectors-catalog/server/hubspot`.
The adapter manages contacts, deals and their relationships using a private/static token or a project-owned OAuth
registration. Each-user connections are isolated by application subject identity.

## Configure access through the console

1. As a HubSpot super admin, select the account that owns the CRM data.
2. Open **Development → Legacy apps → Create legacy app → Private**.
3. In **Basic Info**, enter an identifying name and description.
4. Open **Scopes → Add new scope**, find `crm.objects.contacts.read`, select
   it, and click **Update**. For writes add `crm.objects.contacts.write`; for deals/pipelines add
   `crm.objects.deals.read`, and for deal writes/relationships add
   `crm.objects.deals.write`. Match the selected permissions in configuration.
5. Click **Create app**, then **Continue creating**. Open the app's **Auth** tab
   and use **Show token → Copy**. Store the token in backend Env.
6. In `integrations.json`, use provider `hubspot`, mode `shared` or `assistant`,
   `scopes: ["crm.objects.contacts.read"]`, and authentication `{ "method": "api-key", "secretRef":
   "env:HUBSPOT_API_KEY" }`. Verify through `connectApiKey`.
7. Use the Auth tab to rotate/revoke the token and update its Env value.
   [Private-app console guide](https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview).

## Runtime and AI composition

`contacts.list` calls `GET https://api.hubapi.com/crm/objects/2026-09/contacts`
with a Bearer token. Inputs: `limit` (1–100, default 20), optional `after`,
and `archived` (default false). Results include `results` and optional
`paging.next.after`, which the caller passes to the next request. This operation
also verifies the credential. See the [contacts contract](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide).

Compose the [API-key pattern](../patterns/api-key-connection/PATTERN.md) with
this provider. A new-platform static token uses the same authentication mechanism;
OAuth consent and refresh use the existing connection lifecycle.

## Provisioning automation and quota separation

HubSpot's current developer platform supports CLI provisioning after account
authentication. An AI can prepare distinct app UIDs, scopes and configuration,
then use the documented `hs project create` and upload workflow. Choose private
distribution/static authentication for one account, or an appropriate OAuth
distribution for multiple accounts. Operator account authorization and installation
still occur. The legacy console route above is available without requiring this
developer-project workflow.
[CLI app creation](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/create-an-app),
[authentication modes](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview).

Create a private app and credentials for the application owner. Private-app burst
limits may be app-specific while daily limits are account-wide; two private apps
in one account therefore do not fully isolate capacity. Application usage must
respect both boundaries. Tests simulate pagination, file persistence, key rotation,
cross-app isolation, bad credentials and rate limits. No CRM account was contacted.

## OAuth registration and project setup

1. Follow the [developer-project guide](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/create-an-app)
   to authenticate HubSpot CLI and run `hs project create`. Select App and OAuth.
2. Configure `src/app/app-hsmeta.json`: `config.auth.type` is `oauth`,
   `redirectUrls` contains this project's exact Suggested callback URL, and
   `requiredScopes` includes `oauth` and `crm.objects.contacts.read`. Upload with
   `hs project upload`. The callback belongs to the application backend.
3. Run `hs project open`, choose the app under Project Components, and open
   **Auth → Client credentials**. Copy Client ID into the integration form.
   Save configuration, use **Set credential in Env** for the client secret, and
   **Set callback in Env** for the exact registered callback.
4. Keep both permissions selected. Shared access connects from project settings;
   per-user access connects from the application's account screen. Application
   login is separate. Tokens and refresh credentials stay in its private store.
5. Disconnect deletes the local grant. Remove the installation in HubSpot
   separately when provider access must end. No provider-wide revocation is
   implemented here.

Private OAuth distribution is limited to ten allowlisted HubSpot accounts; use
HubSpot's marketplace distribution process for broader distribution. See the
[authentication overview](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview).
The normal installation is account-level: a per-user local grant does not promise
that HubSpot restricts records to that person's ownership. The app must enforce
business authorization. See [app access configuration](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/app-configuration).

The [current token API](https://developers.hubspot.com/docs/api-reference/latest/authentication/manage-oauth-tokens)
uses `https://api.hubspot.com/oauth/2026-09/token` for code and refresh exchanges.
Client credentials are form-body values; the documented confidential flow does
not use PKCE. Authorization opens `https://app.hubspot.com/oauth/authorize`.
The adapter converts the response's `scopes` array into the shared runtime's
permission format and rejects malformed grants. Missing contact permission
prevents contact reads even after refresh. There is no central token gateway.

Three OAuth cases and two API-key cases passed with controlled fixtures. Both
credential screens were rendered and reviewed on 2026-09-12. No live installation,
CRM request or generated-app execution is claimed.

## Lead-to-deal workflow

The current [contact](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide),
[deal](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/deals/guide),
[association](https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associate-records/guide)
and [pipeline](https://developers.hubspot.com/docs/api-reference/latest/crm/pipelines/guide)
contracts were reviewed 2026-09-13. Operations use the documented 2026-09 routes.

`contacts` and `deals` each expose `.list`, `.get`, `.create`, `.update`.
Lists accept limit/after, archived, comma-separated properties and associations;
get takes numeric-string `id` plus those read fields except limit/after. Writes
accept a `properties` object of 1–100 string values, at most 100KB. Empty string
clears a value. Contact creation requires email, firstname or lastname. Deal
creation requires dealname and the internal dealstage ID; set pipeline when the
account has multiple pipelines. `.update` requires `id` and does not replace
unspecified properties. HubSpot validates property types and business rules.

`pipelines.list` returns deal pipeline/stage IDs. `deals.associateContact` takes
numeric-string `dealId` and `contactId`, creating the default unlabeled relation.
It requires both contact and deal write permissions. Object reads/writes require
the corresponding `crm.objects.contacts|deals.read|write` scope. Update provider
permissions and consent as needed; ticking this screen cannot grant provider access.

```js
// `connection`, `context` and integrationId come from the app-owned runtime.
const call = (operation, input = {}) => connection.invoke({ context, integrationId, operation, input });
const pipelines = await call("pipelines.list");
// Select the intended pipeline and stage from returned IDs; never assume a label.
const pipeline = pipelines.results.find(item => item.id === selectedPipelineId);
const contact = await call("contacts.create", { properties: { email: customer.email, firstname: customer.name } });
const deal = await call("deals.create", { properties: {
  dealname: "Grooming booking", pipeline: pipeline.id, dealstage: selectedStageId, amount: "80.00"
} });
await call("deals.associateContact", { contactId: contact.id, dealId: deal.id });
// On the app's authorized booking-confirmed event:
await call("deals.update", { id: deal.id, properties: { dealstage: confirmedStageId } });
```

The application owns triggering events, record access checks and duplicate
prevention. Persist returned IDs; reconcile partial/uncertain writes instead of
blindly retrying creation. The library performs no hidden workflow or sync.
CLI JSKIT apps use the same JSON/Env and exported provider without the editor;
other frameworks use their native HTTP/HubSpot client with the same project
configuration and operation sequence. Keys and tokens stay server-side.

**LIMITATIONS:** No CRM dashboard, workflow designer/engine, webhook receiver,
bulk import/sync, custom association labels, company/ticket API or archive/delete
operations. Example: a booking app can create a linked deal and advance its stage,
but it must supply the trigger and cannot import an entire CRM automatically.
Editor-assistant attachment is deferred. Fixture success does not prove live CRM
installation, property availability, subscription features or generated-app use.
