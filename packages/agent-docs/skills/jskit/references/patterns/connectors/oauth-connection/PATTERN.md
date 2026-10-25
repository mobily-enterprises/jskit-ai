---
id: connectors/oauth-connection
title: OAuth connections with portable files
summary: Compose provider consent, verification and encrypted file persistence from an application server or CLI.
keywords: connectors, integrations, oauth, shopify, assistant permissions, workday, staffing, tiktok, linkedin, google ads, gaql, developer token, salesforce, soql, databricks, fabric, graphql, service principal, client credentials, wordpress, twitch, microsoft, word, powerpoint, xero, wave, zoho, crm, books, accounting, files, cli, consent
requires: @jskit-ai/connectors-core, @jskit-ai/connectors-catalog
---

# OAuth connections with portable files

## Use when

Use an own OAuth web-client registration to connect accounts from an existing
application or operator CLI. The same library owns state, code exchange,
verification and token handling. WordPress.com illustrates composition here;
follow each selected provider's setup guide and scopes.

## Do not use when

This runtime accepts application-owned registrations; managed gateway
assignments are invalid configuration. Native public clients are not covered by
this pattern. A shared provider account is not each user's personal
account. An OAuth data connection does not create the application's login.

## Product decisions

Choose the integration's ownership mode, scopes and callback owner. Shared
connections require membership checks before mapping to a stable shared subject.
Personal connections use the existing authenticated user's stable identity.
The callback must recover that same owner; do not accept owner IDs from a URL.
An operator CLI can use its trusted process-owner policy and a registered local
callback listener. Never copy that identity policy into a public web route.

## Invariants

- The UI and CLI edit the same `integrations.json` and shared validation schema.
- Client secrets, tokens and pending attempts stay outside exported source.
- File runtime state is encrypted with a durable operator-owned key.
- Saving configuration is not consent; provider verification precedes Connected.
- Callbacks must match their registered destination, pending state and owner.
- Failed or cancelled replacement consent preserves an existing grant.
- Reduced permission grants remain reduced; source edits do not grant access.

## Framework APIs

Import configuration validation, `createConnectionService`, environment
resolution and the file storage/protection exports from connectors-core.
The selected catalogue provider supplies the protocol and operation contracts.

## Example files

Use the packaged `docs/wordpress-com.md` guide in `@jskit-ai/connectors-catalog`.
`example/integrations.json` supplies its portable configuration. Replace the
placeholder with the provider's assigned Client ID, then compose the ordinary
package APIs in an application module:

```js
import { readFile } from "node:fs/promises";
import { parseIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { createConnectionService, createEnvironmentReferenceResolver } from "@jskit-ai/connectors-core/server";
import { createFileConnectionStore, createCredentialProtection } from "@jskit-ai/connectors-core/server/file-storage";
import { wordpressComProvider } from "@jskit-ai/connectors-catalog/server/wordpress-com";

const providers = [wordpressComProvider];
const configuration = parseIntegrationConfiguration(await readFile("integrations.json", "utf8"), { providers });
const protection = createCredentialProtection({
  keys: { current: Buffer.from(process.env.CONNECTOR_STORAGE_KEY, "base64") }, activeKeyId: "current"
});
const connections = createConnectionService({
  configuration, providers,
  store: createFileConnectionStore({ directory: process.env.CONNECTOR_STATE_DIRECTORY, protection }),
  resolveReference: createEnvironmentReferenceResolver(), authorize: applicationConnectionPolicy
});
```

`applicationConnectionPolicy` checks the authenticated caller and requested
operation, then returns `{ applicationId, subjectId }`. Keep the state directory
outside source and preserve its encryption key across restarts/backups.

1. Call `beginAuthorization({ context, integrationId })` and open the returned
   `authorizationUrl` in the user's browser. A resource-specific provider may
   also require `verificationInput`, validated before consent starts.
2. At the application's registered callback, recover authenticated `context`
   and call `completeAuthorization({ context, integrationId, callbackUrl })`.
   Route errors through ordinary application error handling.
3. Call `invoke({ context, integrationId, operation, input })` for a named
   provider operation. Provider responses stay subject to application policy.
4. `cancelAuthorization({ context, integrationId, state })` abandons a pending
   attempt. `disconnect({ context, integrationId })` removes local access and
   pending attempts. It does not revoke provider-wide access.

## Variation points

Google, Microsoft, Oura and WordPress.com have different scope and token
contracts. Use their provider exports instead of inferring these from fields.
WordPress.com verifies token ownership/scopes from its profile and requests
comma-separated permissions. Oura handles reduced callback scopes and rotated
refresh tokens. Some providers do not return a refresh token; expired access
then needs consent again. Provider PKCE enforcement needs provider evidence.

## Provider specifics

Each provider's guide holds its OAuth registration, portable configuration and
runtime composition:

- [shopify](../../docs/shopify.md)
- [hubspot](../../docs/hubspot.md)
- [linear](../../docs/linear.md)
- [twitch](../../docs/twitch.md)
- [slack](../../docs/slack.md)
- [microsoft-oauth](../../docs/microsoft-oauth.md)
- [xero](../../docs/xero.md)
- [wave](../../docs/wave.md)
- [zoho-crm](../../docs/zoho-crm.md)
- [zoho-books](../../docs/zoho-books.md)
- [lightspeed](../../docs/lightspeed.md)
- [databricks](../../docs/databricks.md)
- [microsoft-fabric](../../docs/microsoft-fabric.md)
- [salesforce](../../docs/salesforce.md)
- [google-ads](../../docs/google-ads.md)
- [linkedin](../../docs/linkedin.md)
- [tiktok](../../docs/tiktok.md)
- [snowflake](../../docs/snowflake.md)
- [gemini-enterprise](../../docs/gemini-enterprise.md)
- [workday](../../docs/workday.md)

## Shared connection from an Env refresh token

When the application's host already holds a long-lived grant for the shared
account (the owner connected it once with the same OAuth client), skip consent
in the app: add `refreshTokenRef` to a `shared` oauth2 integration whose
registration uses the authorization-code flow.

```json
"authentication": {
  "method": "oauth2",
  "registrationRef": "google",
  "refreshTokenRef": "env:GOOGLE_REFRESH_TOKEN"
}
```

The Env value is a seed. On first use, and whenever the value or the OAuth
client changes, the runtime replaces the shared connection with one built from
that refresh token. From then on it refreshes and stores rotated tokens in the
application's own store as usual. `status()` reports `source: "env"` (show it as
"Connected from Env"). `beginAuthorization()` and `disconnect()` refuse with
`connector_env_managed`: "This connection comes from an Env value; unlink or
replace that value instead." A revoked token fails with "The refresh token in
Env no longer works; replace that Env value." The refresh token must come from
the same client as `registrationRef`; non-JSKIT apps read the variable directly.

## Verification

Focused tests simulate consent and provider responses with real temporary
encrypted text storage. They cover restart, cancellation, scope reduction,
ownership, refresh/reconnect and errors. Editor tests verify JSON fields and
persistence. These checks do not generate or run sample applications or use
real provider credentials.

## Avoid

Do not implement OAuth protocol logic in copied scaffolding, put client secrets
in browser code, assume requested permissions were all granted, or label a
saved registration as a connected account. Do not create a database solely
for connector configuration or runtime state.
