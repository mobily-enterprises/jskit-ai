# Fireworks AI

Import `fireworksAiProvider` from
`@jskit-ai/connectors-catalog/server/fireworks-ai`.
The initial operation lists accessible accounts using a Fireworks API key.

## Configure access

1. Sign into the intended Fireworks account and open [API Keys](https://app.fireworks.ai/settings/users/api-keys).
   Choose **Create API key** and copy the generated value. The official
   [quickstart](https://docs.fireworks.ai/getting-started/quickstart) links to this
   page. Follow any required prompts on that page before copying the issued key.
   These steps follow the official guide; they have not been tested with a live
   account. The API's optional expiry field below does not establish a console control.
2. Store it in backend Env as `FIREWORKS_API_KEY`. The owning user or service
   account must be allowed to list accounts; an inference-only role may lack
   that access. This fragment deliberately verifies a management read and does
   not submit an inference request as a connection test.
3. Save provider `fireworks-ai`, mode `shared` or `assistant`, `scopes: []`, and
   authentication `{ "method": "api-key", "secretRef": "env:FIREWORKS_API_KEY" }`.
   Calls use Bearer authentication and JSON content type at
   `https://api.fireworks.ai`. [API authentication](https://docs.fireworks.ai/api-reference/introduction).
4. Call `connectApiKey`. On rotation, replace the Env value. Local disconnect
   removes connection state; delete the obsolete key in Fireworks to revoke it.

## Runtime and AI composition

`accounts.list` reads `GET /v1/accounts`. It accepts `pageSize` (1–200, default
50), `pageToken`, and an optional provider filter expression. Results preserve
`accounts`, `nextPageToken` and `totalSize`. Pass the next token as `pageToken`
while keeping the filter unchanged. The query uses the documented HTTP field
names, not the snake_case names sometimes used in SDK descriptions.
[Account listing](https://docs.fireworks.ai/api-reference/list-accounts).

Use the [API-key pattern](../patterns/api-key-connection/PATTERN.md) and encrypted
file store. An AI can use the returned account names for subsequent app-owned
deployment or billing workflows. Inference, streaming and deployment creation
are not operations in this fragment. Automated tests simulate provider reads,
paging, failures, key rotation and persistence across a new service instance.

## Automation and application ownership

After initial authorized access, key creation can be automated with
`POST /v1/accounts/{account_id}/users/{user_id}/apiKeys`. Its JSON body contains
`apiKey`, with `displayName` and optional `expireTime`; save the returned `key`
directly into secret storage. Fireworks also documents `firectl api-key create`.
These require an existing authorized identity and do not bypass account setup.
[Key creation API](https://docs.fireworks.ai/api-reference/create-api-key).

The application owner supplies the account and keys, and sets capacity/billing
controls with Fireworks. Two key names in one account do not establish independent
quotas. AI can prepare configuration and provision permitted keys after bootstrap;
the editor does not supply or allocate inference capacity. This fragment makes no live requests during its tests.
