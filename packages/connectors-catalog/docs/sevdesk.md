# Sevdesk

Import `sevdeskProvider` from `@jskit-ai/connectors-catalog/server/sevdesk`.
This fragment verifies an account API token and lists contacts, including people
by default. Vibe64 labels its credential field **API token reference**.

## Provider setup

1. Sign into the intended sevdesk account with permission to view its API token.
   Open **Erweiterungen → Integrationen**.
2. Find **API-Token für Integrationen** near the top. Choose **Einblenden**,
   enter your password, then copy the revealed token. Some plans also expose
   **Erweiterungen → API**, with the same reveal/password step.
3. Store the value as `SEVDESK_API_TOKEN` in the backend environment. Add
   Sevdesk in Vibe64 and enter `env:SEVDESK_API_TOKEN` in **API token reference**.
   The portable file contains that reference, never the revealed token.

This retrieves an existing credential; it is not a new OAuth-app registration.
[Provider token instructions](https://hilfe.sevdesk.de/de/articles/9374740-wo-finde-ich-meinen-api-token-in-sevdesk).

## Configuration and library calls

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "contacts": {
      "provider": "sevdesk",
      "displayName": "Business contacts",
      "accountMode": "shared",
      "scopes": [],
      "authentication": { "method": "api-key", "secretRef": "env:SEVDESK_API_TOKEN" }
    }
  }
}
```

The shared authentication method is named `api-key`; this provider's UI and
documentation call its value a token. Compose `providers: [sevdeskProvider]`
using the [API-key pattern](../patterns/api-key-connection/PATTERN.md), an
application authorization policy and the file connection store. CLI and editor
use the same configuration. Runtime connection records remain text files
outside exported source, with no database requirement.

```js
await connections.connectApiKey({ context, integrationId: "contacts" });
const page = await connections.invoke({
  context, integrationId: "contacts", operation: "contacts.list",
  input: { limit: 100, offset: 0, countAll: true }
});
```

The provider requires the token directly in `Authorization`, without a Bearer
prefix. Requests use `GET https://my.sevdesk.de/api/v1/Contact`.
`limit` accepts 1–1000; `offset` skips records; `countAll: true` asks for a
`total`, which the provider can return as a numeric string. The collection is
in `objects`. With `depth: 1`, contacts include organizations and people;
the provider's normal depth-zero listing includes organizations only.
Its API documentation identifies credentials with administrator users.
[API documentation](https://api.sevdesk.de/).

This fragment defaults to `limit: 100`, `offset: 0`, `countAll: false` and
`depth: 1`. An application can explicitly choose `depth: 0`. Integer pagination
is required and the local offset cap is 1000000. Results preserve provider
fields, accept empty collections and validate `total` when present. Request
subsequent offsets explicitly; no background crawl occurs. Text searches,
embedded related objects and writes are not implemented.

Requests stay on the fixed HTTPS origin and reject redirects. A changed token
is resolved on the next call; invalid credentials require verification again.
Disconnect removes local state and does not revoke the provider token or delete
its owning user. Account/user lifecycle changes belong in the provider console.
The application must authorize access to this shared directory; reading a
contact does not sign that person into the application.

## Automation and application ownership

An AI can write the config, environment reference, library composition and
contact-list code. The reviewed documents describe a password-confirmed token
reveal, not a public API for provisioning accounts or generating these tokens.
Keep that initial step with the account owner; do not fabricate a creation or
rotation endpoint.

The application owns its token and private Env reference. Two
references to one token still access one account. Do not promise separate
provider credentials or quota merely by changing those names, and do not create
provider users solely as an assumed quota workaround. Customer-owned
connections use each customer's authorized token. Provider limits and any
independent-capacity arrangement need confirmation. The application enforces
its own usage limits. No callback URL is
used, so editor VM and app hosting domains do not affect this flow.

## Focused evidence

Tests use simulated HTTP replies and real temporary encrypted JSON storage.
They cover raw authorization, page defaults, explicit organization-only reads,
numeric-string totals, invalid inputs/envelopes, restart, rotation, ownership
and disconnect. Editor automation verifies the token label, reference-only
storage and save/reload. Live provider use, account creation and sample-app
generation are excluded.

## Existing-scope closeout — 13 September 2026

Contact listing only, including people by default (`depth: 1`), explicit organization-only depth, bounded offset pagination and numeric-string totals. The project supplies its existing raw API token through Env. No contact detail/search/create/update/delete, related-object expansion, invoices, orders, vouchers or bookkeeping operations are implemented. There is no OAuth/app registration, application-user login, token-issuance automation, automatic pagination/retry or remote token revocation. Applications still own their UI, authorization and pagination; disconnect removes local connection state. Deferred work is the missing contact/accounting operations and their validation, permissions, setup guidance and tests. No live Sevdesk account, provider-console login or generated-app run was tested.

Three selected source tests and the same three installed-package tests passed on September 13. They cover credential verification, encrypted file restart, rotation, isolation, disconnect, pagination/depth/totals and redacted invalid-input/provider failures. Existing shared business-token UI evidence is retained; no fresh browser run or form change is claimed.
