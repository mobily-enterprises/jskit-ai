# Apollo.io

Import `apolloIoProvider` from `@jskit-ai/connectors-catalog/server/apollo-io`.
This adapter searches prospects, enriches selected people/companies and reads or
changes saved contacts, accounts and deals in an Apollo workspace.

## Provider setup

1. Sign into the intended Apollo workspace. Open **Settings → Integrations →
   API Keys**, then **API Keys → Create new key**.
2. Enter a name and description. Enable `api/v1/accounts/search` for this key.
   Keep **Set as master key** off when the selected endpoint permissions suffice.
   Add the endpoint permissions below only for capabilities the app will use.
3. Choose **Create API key**, then **Copy**. Store the value under
   `APOLLO_API_KEY` in the backend environment.
4. Add Apollo.io in Vibe64, give the integration a display name and enter
   `env:APOLLO_API_KEY` in **API key reference**. Save the file configuration,
   use **Set credential in Env** to supply the value, then **Connect account**
   (or **Verify again**). **Check connection** only reads current status.

Key access also depends on the account's provider plan. Apollo's developer
dashboard exposes key regeneration/deletion and a Usage screen for endpoint
limits. A scoped key can receive 403 when an endpoint is not allowed.
[Key creation and management](https://docs.apollo.io/docs/create-api-key).

## Portable configuration and runtime

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "companies": {
      "provider": "apollo-io",
      "displayName": "Saved sales accounts",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "api-key", "secretRef": "env:APOLLO_API_KEY" }
    }
  }
}
```

Use the [API-key composition pattern](../patterns/api-key-connection/PATTERN.md)
with `providers: [apolloIoProvider]`, environment-reference resolution and the
file connection store. CLI and Vibe64 edit this same configuration. Runtime
connection records remain encrypted JSON outside exported source.

```js
await connections.connectApiKey({ context, integrationId: "companies" });
const page = await connections.invoke({
  context, integrationId: "companies", operation: "accounts.search",
  input: { page: 1, per_page: 25, q_organization_name: "Design" }
});
```

The request is `POST https://api.apollo.io/api/v1/accounts/search`, with JSON
search inputs and the credential in `X-Api-Key`. The fragment accepts integer
`page` 1–500, integer `per_page` 1–100 and an optional nonempty name query up to
256 characters. Defaults are page 1 and 25 results; the query-length cap is a
local bound. The endpoint searches saved company accounts and currently
documents zero credit consumption. Searching Apollo's prospect database or
enriching people uses different endpoints.
[Saved-account search](https://docs.apollo.io/reference/search-for-accounts).

The adapter validates the `accounts` collection and preserves the result
envelope. It performs one request, accepts an empty page, and does not assume
that all matching records fit within the provider's display limit. Request
pages explicitly and narrow the name query when needed. Additional operations are listed below. The app explicitly chooses each
page; there is no automatic scan, enrichment or background synchronization.

Verification uses the same saved-account operation, so a public health reply
cannot mark this connection as verified. Keys are resolved per request, sent
only to the fixed HTTPS origin, and never written into portable configuration.
After provider-side regeneration, update the environment value and reverify.
Disconnect removes local state; provider revocation is a separate key action.

## Ownership, automation and application capacity

Apollo API keys represent a workspace. Requests act as its longest-standing
active administrator, so authorize CRM changes against the app owner and intended Apollo workspace.
Partners accessing individual users use OAuth. That partner flow and app login
are not implemented by this API-key fragment.
[Authentication and request identity](https://docs.apollo.io/reference/authentication).

An AI can prepare configuration, library calls and paging logic. The reviewed
key-creation guide provides dashboard steps; an API for issuing initial keys
was not verified. Treat that bootstrap as an owner/admin task. Partner OAuth
would require separate registration work and an adapter rather than replacing
an API key with an OAuth token in this module.

Create an authorized key for the application, with a recognizable name for
revocation and attribution. Customer-owned data
requires keys for the appropriate customer workspace. These are key names,
not universal OAuth app identities, and no callback URL is involved.

Apollo limits are per team and endpoint, across minute/hour/day windows. All
keys and users share those limits; child workspaces also share their parent's
allowance. Separate keys therefore do not create independent capacity.
The application owner must arrange the capacity and usage limits it needs. The runtime surfaces 429 failures and does not
automatically retry requests.
[Rate limits](https://docs.apollo.io/reference/rate-limits).

## Focused evidence

Tests use simulated provider replies and actual temporary encrypted JSON
storage. They verify headers, POST bodies, empty accounts, page/name boundaries,
malformed replies, provider failures, restart, rotation, ownership and
disconnect. The editor case verifies secret references, setup links and reload.
Live API calls, provider signup and sample-app generation are excluded.

## Operations and endpoint permissions

API-key permissions are provider settings, not OAuth scopes in `integrations.json`.
Always keep `api/v1/accounts/search` for the harmless connection check. Add only
rows your app needs. A 403 can mean key permission or plan access; do not silently
switch to a master key. Current endpoint reference tables list scoped-key options,
although some older response-example labels still mention master keys.

| Operation | Endpoint permission | Inputs and behavior |
| --- | --- | --- |
| `people.search` | `api/v1/mixed_people/api_search` | Name/keyword, titles, locations, company IDs/domains; paged prospects without email/phone disclosure. |
| `organizations.search` | `api/v1/mixed_companies/search` | Company name, domains, locations, page; requires `allowCreditConsumption: true`. |
| `people.enrich` | `api/v1/people/match` | Apollo person `id` from search, `allowCreditConsumption: true`; personal email reveal defaults false. |
| `organizations.enrich` | `api/v1/organizations/enrich` | Bare `domain` without scheme/www, `allowCreditConsumption: true`. |
| `contacts.search` | `api/v1/contacts/search` | Keywords, stage/list IDs, page. |
| `contacts.create` / `contacts.update` | `api/v1/contacts/create` / `api/v1/contacts/update` | Names, email, employer, title, account, stage, lists, phone/location; update takes contact `id`. |
| `accounts.create` / `accounts.update` | `api/v1/accounts/create` / `api/v1/accounts/update` | Name/domain, owner, stage, phone/address; update takes saved account `id`. |
| `deals.list` | `deals/api/v1/opportunities/search` | Page and optional amount/is_closed/is_won sort. |
| `deals.create` / `deals.update` | `deals/api/v1/opportunities/create` / `deals/api/v1/opportunities/update` | Name, owner, amount, stage, close date; create can set account; update takes deal `id`. |
| `dealStages.list` | `deals/api/v1/opportunity_stages/index` | Stage identifiers for this workspace. |
| `users.list` | `api/v1/users/search` | Paged owner identifiers for this workspace. |

Search pages use `page` 1–500 and `per_page` 1–100 (default 25). Preserve the raw
provider envelope, including pagination or match information; an empty page is
valid. Narrow filters before reaching the provider's result cap. A connected key
does not prove that every optional endpoint or record is accessible.

Sources: [people search](https://docs.apollo.io/reference/people-api-search),
[company search](https://docs.apollo.io/reference/organization-search),
[people enrichment](https://docs.apollo.io/reference/people-enrichment),
[company enrichment](https://docs.apollo.io/reference/organization-enrichment),
[contact search](https://docs.apollo.io/reference/search-for-contacts),
[contact create](https://docs.apollo.io/reference/create-a-contact),
[contact update](https://docs.apollo.io/reference/update-a-contact),
[account create](https://docs.apollo.io/reference/create-an-account),
[account update](https://docs.apollo.io/reference/update-an-account),
[deal list](https://docs.apollo.io/reference/list-all-deals),
[deal create](https://docs.apollo.io/reference/create-deal),
[deal update](https://docs.apollo.io/reference/update-deal),
[deal stages](https://docs.apollo.io/reference/list-deal-stages),
[workspace users](https://docs.apollo.io/reference/get-a-list-of-users).

## Compose a useful application workflow

1. Search prospects, then let the authorized user choose the person/company.
2. Before company search or enrichment, disclose provider credit usage. The app's
   authorizer must enforce explicit user approval or an administrator-approved
   budget policy; `allowCreditConsumption` is an input acknowledgement, not a
   billing limit or authorization system. The adapter strips it from the request.
3. Enrich only the selected identifier/domain. Preserve `match_confidence` and
   null/no-match replies; a successful HTTP response need not identify a person.
   Phone reveal and waterfall enrichment are disabled because they require a
   separate asynchronous webhook workflow. No emails or phone numbers are
   invented when Apollo does not return them.
4. Let an authorized user save/update the desired CRM record. Contact creation
   requires an explicit `run_dedupe` choice: false can create duplicates; true
   can overwrite fields on an existing matched contact. Updating `label_names`
   replaces its lists; omitted fields remain omitted. Account creation has no
   automatic deduplication: search saved accounts first and retain returned IDs.
5. Create or update a deal using an actual saved account ID and a stage from
   `dealStages.list`. Owner IDs come from `users.list`. Deal amounts are decimal
   strings without currency symbols/commas; currency comes from Apollo settings.
   Close dates must be real `YYYY-MM-DD` dates. Persist the returned deal ID.

```js
const people = await connections.invoke({ context, integrationId: "companies",
  operation: "people.search", input: { person_titles: ["Designer"], per_page: 10 } });
// After application authorization and approval of provider credit use:
const selected = await connections.invoke({ context, integrationId: "companies",
  operation: "people.enrich", input: { id: selectedPersonId, allowCreditConsumption: true } });
```

The HTTP layer makes one request per invocation. After an uncertain create or
enrichment response, inspect Apollo before retrying; retrying can duplicate a
record or spend credits again. Handle 403/422 as permission/input failures and
429 with a bounded app policy. Do not expose the workspace key to browser code.
The same operations work in a CLI-owned Node app without Vibe64; other frameworks
use their own HTTP client against the documented endpoints and read the same Env
reference from project configuration.

## Limitations

Editor coding-assistant attachment is deferred. For example, a generated sales
app can search, enrich approved leads and save deals, but asking Vibe64's coding
assistant to find leads does not grant it this connection. The app owns lead and
CRM screens, authorization and usage budgets. This adapter does not implement
partner OAuth, outreach sequences, bulk jobs, deletion, custom-field discovery,
or phone/waterfall webhooks. Native framework clients can compose those separate
provider APIs when needed. Live accounts, charges and generated apps are untested.
