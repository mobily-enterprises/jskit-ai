# Databricks

The initial fragment reads a workspace's Jobs API through a custom OAuth
application or a service principal. Both use `databricksProvider` from
`@jskit-ai/connectors-catalog/server/databricks` and the ordinary connections
service. Configuration and encrypted runtime state can both use files.

## Choose the owner and credentials

| Use | Registration | Connection method | Callback |
|---|---|---|---|
| Each user's Databricks access | Custom confidential OAuth application | `beginAuthorization`, then `completeAuthorization` | Exact backend callback |
| Shared service principal | Service principal client ID and Databricks OAuth secret | `connectClientCredentials` | None |

The service principal has its own identity. It cannot stand in for a different
Databricks account belonging to each app user. The application policy may let
authorized members use a shared connection or delegate access to an assistant.
It must derive the storage owner from trusted application identity.

## Create a service principal connection

1. Open the intended Databricks workspace. Open the user menu, **Settings**,
   **Identity and access**, then **Service principals → Manage**.
2. Select an existing principal or arrange for the admin to create and assign
   one. Grant workspace access and visibility of the jobs the application needs.
3. Open the principal's **Secrets** tab and select **Generate secret**. Set a
   suitable lifetime and scopes, then generate it. Copy its client ID and the
   one-time secret into your private configuration environment.
4. For this fragment, a secret allowing `jobs` can be narrower than `all-apis`.
   A legacy unrestricted secret can request `all-apis`. Avoid granting token
   administration just to read jobs.
5. Configure **Service account** in the editor, enter the principal's client ID
   and save configuration. Choose **Set credential in Env**, paste the OAuth
   secret under the displayed client-secret reference, and save it there. Select
   `jobs` without `all-apis` when the secret is jobs-scoped. Return and verify the
   first jobs page; this mode needs no callback or browser consent.

This is Databricks OAuth, including on Azure; a Microsoft Entra secret, personal
access token or login password is not interchangeable. The provider describes
secret management and workspace assignment in its [service principal guide](https://docs.databricks.com/aws/en/dev-tools/auth/oauth-m2m).

```json
{
  "schemaVersion": 1,
  "integrations": {
    "warehouse": {
      "provider": "databricks",
      "displayName": "Operations jobs",
      "accountMode": "shared",
      "settings": { "workspaceUrl": "https://dbc-abc123.cloud.databricks.com" },
      "scopes": ["jobs"],
      "authentication": { "method": "oauth2", "registrationRef": "databricks-service" }
    }
  },
  "registrations": {
    "databricks-service": {
      "source": "own",
      "grantType": "client_credentials",
      "clientId": "11111111-1111-1111-1111-111111111111",
      "clientSecretRef": "env:DATABRICKS_CLIENT_SECRET",
      "tokenEndpointAuthMethod": "client_secret_basic"
    }
  }
}
```

## Create a user consent connection

An account admin opens the **account console → Settings → App connections →
Add connection**. Enter the application's name and the exact redirect URL.
Choose **All APIs** for the Jobs fragment and generate a client secret for a
confidential application. Set access/refresh lifetimes, add the connection and
save the client ID and one-time secret. Activation can take 30 minutes.
See [custom application setup](https://docs.databricks.com/aws/en/integrations/enable-disable-oauth).

In the JSON above, set `accountMode` to `per-user`, select `all-apis` and
`offline_access`, and use a registration containing:

```json
{
  "source": "own",
  "grantType": "authorization_code",
  "clientId": "22222222-2222-2222-2222-222222222222",
  "clientSecretRef": "env:DATABRICKS_OAUTH_CLIENT_SECRET",
  "tokenEndpointAuthMethod": "client_secret_post",
  "callbackUrlRef": "env:DATABRICKS_CALLBACK_URL"
}
```

Set that callback binding to your own active HTTPS route, or an explicitly
registered loopback callback for a CLI. Start consent, open the returned URL,
then pass the returned callback to `completeAuthorization` under the same
authenticated app owner. PKCE/state and one-time completion are library-owned.
Do not borrow `databricks-cli` as a third-party client ID. Databricks documents
the [user authorization flow](https://docs.databricks.com/aws/en/dev-tools/auth/oauth-u2m).

The service uses form-body client authentication for user authorization and
refresh, matching the official SDK; service credentials use HTTP Basic. It
renews tokens 40 seconds early because Azure can reject tokens with 30 seconds
remaining. See the [Databricks OAuth implementation](https://github.com/databricks/databricks-sdk-py/blob/main/databricks/sdk/oauth.py).

## Workspace addresses

Use the exact workspace origin, without an application path, query or hash.
This initial validator accepts `dbc-….cloud.databricks.com` on AWS,
`adb-<digits>.<digits>.azuredatabricks.net` on Azure and
`<digits>.<digits>.gcp.databricks.com` on Google Cloud. A final slash is allowed.
Regional/account console URLs, private proxy aliases and newer unified domain
forms require a separate adapter extension. See the [Azure per-workspace URL](https://learn.microsoft.com/en-us/azure/databricks/workspace/per-workspace-urls)
and [Google Cloud workspace identifiers](https://docs.databricks.com/gcp/en/workspace/workspace-details).

The configured workspace selects both `/oidc/v1/authorize` and `/oidc/v1/token`
as well as the API origin. Neither callback parameters nor operation input can
change that destination.

## Runtime and AI composition

Parse the same JSON with `parseIntegrationConfiguration(text, { providers:
[databricksProvider] })`. Supply the ordinary `authorize`, reference resolver
and private file store to `createConnectionService`. Compose the Feature when
using JSKIT actions; `connectors.verifyClientCredentials` exposes service
verification through the existing action runtime.

```js
await connections.connectClientCredentials({ context, integrationId: "warehouse" });
const jobs = await connections.invoke({
  context, integrationId: "warehouse", operation: "jobs.list",
  input: { limit: 20, expand_tasks: false }
});
```

`jobs.list` accepts `limit` (1–100), `expand_tasks`, exact `name` filtering and an
opaque `page_token`. Empty results may omit `jobs`. `jobs.get` requires numeric
`job_id`, accepts `include_trigger_state` and a continuation token, and returns
one page of job details. Nested task arrays can be paginated. The caller must
decide whether to follow tokens; the library makes one read per invocation.
See the [Jobs API](https://docs.databricks.com/api/jobs/v2/list-jobs).

The fragment bounds tokens to 8192 characters and job IDs to JavaScript's safe
integer range. It rejects writes, SQL, arbitrary URLs, malformed job IDs and
responses identifying a different requested job. An OAuth grant can allow
more than these two operations; neither `jobs` nor `all-apis` is a read-only
provider permission. Configure resource permissions accordingly.

Service credentials renew with their secret rather than a refresh token.
Renewal is serialized per connection and cannot expand the stored grant.
Changing a service connection's scopes or grant type requires reconnecting.
Tokens remain encrypted; source contains references. Disconnect removes the
local connection and attempts without deleting the principal or revoking the
provider application globally.

## Public, Online and automation

Register the real callback implemented by the runtime that owns this connection.
For an application integration, use the application's assigned hosting URL as
the initial origin and its implemented callback path. Store the exact callback
in its Env reference and provider registration. A domain change requires updating
both values if the callback URL changes; retain the application identity and its
persistent grants when moving hosts. Public Vibe64, Online and CLI users supply
their own registrations through this same contract.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md).

Service principals have no callback. Databricks custom applications are created
within a customer account; creating one does not establish a universal third-party
registration across every customer account. The application owner supplies its
account's registration. Separate registrations do not reserve workspace compute
or guarantee separate provider quotas.

An AI can prepare the portable file and registration request, and an authorized
operator can provision custom apps using the account API or
`databricks account custom-app-integration create --confidential --json …`.
The API accepts name, redirect URLs, scopes and token policy and returns client
credentials. Admin authorization and storage of the returned secret remain
operator responsibilities. See [OAuth app integration APIs](https://docs.databricks.com/api/o-auth/v1/get-custom-o-auth-app-integration).
Service principal provisioning and secret generation similarly need account
privileges; this fragment does not implement provisioning endpoints.

Live accounts, consent, private networking, account-level operations, SQL/data
queries, jobs execution and app login are unverified or
unfinished. Local proof uses controlled HTTP responses and encrypted files.
