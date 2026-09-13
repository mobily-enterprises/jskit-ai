# Microsoft Fabric

This fragment connects one existing **API for GraphQL** in the global Microsoft
Fabric service. It supports a confidential user-consent registration and a service
principal. It does not create a workspace, lakehouse, database, data pipeline or
application login. Both CLI and editor use the configurations below.

## Choose the identity

| Choice | Token request | Permission and ownership |
| --- | --- | --- |
| User consent | Authorization code with PKCE; client secret sent by the backend | `https://analysis.windows.net/powerbi/api/GraphQLApi.Execute.All`, optional `offline_access`; shared, assistant or per-user connection |
| Service account | Client credentials; no browser or refresh token | `https://api.fabric.microsoft.com/.default`; shared or assistant connection |

The two resource scopes are deliberately different. Microsoft documents the
[delegated scope](https://learn.microsoft.com/en-us/fabric/data-engineering/connect-apps-api-graphql)
and [service principal scope](https://learn.microsoft.com/en-us/fabric/data-engineering/api-graphql-service-principal)
separately. Neither is a Microsoft Graph permission. Acquiring a token does not
establish access to the API or its underlying data.

## Register the application

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/) in the
   resource-owning directory. Go to **Entra ID → App registrations → New registration**.
2. Enter an application name. For a customer-owned setup, select accounts in this
   directory only and register it. Copy **Application (client) ID** and
   **Directory (tenant) ID** from its overview. This fragment requires the directory
   GUID; it does not use `common`, personal Microsoft accounts or tenant aliases.
3. Under **Certificates & secrets → Client secrets → New client secret**, supply
   a description and expiry. Copy the secret **Value**, not its identifier, into
   the backend's secret binding. Record when it needs rotation.
4. For **User consent**, open **Authentication → Redirect URI configuration → Add Redirect URI → Web** and enter
   the exact callback implemented by your backend. Add **Power BI Service →
   Delegated permissions → GraphQLApi.Execute.All** under API permissions.
   Complete any consent required by the tenant's policy. Request `offline_access`
   when ongoing access is needed. This server library uses a confidential Web
   client; do not copy the SPA/public-client settings from Microsoft's React demo.
5. For **Service account**, omit the callback and delegated permission. Use the
   app's client ID and secret to authenticate its service principal.

See Microsoft's [registration procedure](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
and [client credentials protocol](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow).
Never bundle a confidential client secret into a distributed editor or frontend.

## Allow access to the existing API

1. Open the Fabric workspace and the existing GraphQL API. In its toolbar select
   **Copy endpoint**, then copy the complete link. Keep the workspace and API IDs.
   The accepted address has this form:
   `https://api.fabric.microsoft.com/v1/workspaces/<workspace-id>/graphqlapis/<api-id>/graphql`.
   It must not contain credentials, an added port, query parameters or a fragment.
   Custom gateways and sovereign clouds need a separate provider contract.
2. For service principals, a tenant administrator opens **Admin portal → Tenant
   settings → Developer settings**, enables **Service principals can use Fabric
   APIs**, and applies the setting for the intended principals or group.
3. From the API item's **… → Manage permissions → Add user**, select the user or
   service principal and grant **Run Queries and Mutations**. Prefer item access
   when it meets the requirement rather than automatically assigning a broad
   workspace role.
4. Confirm access to the source as well. With single sign-on, the calling identity
   needs the applicable source permissions. With a saved connection, its saved
   credential needs them. Permission to an API is not permission to every table.
5. Schema discovery is optional. If needed, a workspace administrator opens the
   API settings, selects **Introspection**, enables it and confirms. It is disabled
   by default. Alternatively, export the SDL schema from the toolbar and give
   that file to the app author or AI.

The [access guide](https://learn.microsoft.com/en-us/fabric/data-engineering/api-graphql-service-principal)
explains the service-principal setup; the
[schema guide](https://learn.microsoft.com/en-us/fabric/data-engineering/api-graphql-introspection-schema-export)
explains introspection and export. The connection check requests only `__typename`;
it does not enable introspection or query a business table. Actual access to each
document still needs verification against the customer's schema and permissions.

## Portable user configuration

Store this as the same integration JSON that the editor reads and writes. Resolve
the `env:` references on the backend. Example IDs are placeholders.

```json
{
  "schemaVersion": 1,
  "registrations": {
    "fabric": {
      "source": "own",
      "grantType": "authorization_code",
      "clientId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "clientSecretRef": "env:FABRIC_SECRET",
      "callbackUrlRef": "env:FABRIC_CALLBACK"
    }
  },
  "integrations": {
    "fabric": {
      "provider": "microsoft-fabric",
      "accountMode": "per-user",
      "settings": {
        "tenantId": "11111111-2222-3333-4444-555555555555",
        "graphqlEndpoint": "https://api.fabric.microsoft.com/v1/workspaces/11111111-2222-3333-4444-555555555555/graphqlapis/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/graphql"
      },
      "scopes": ["https://analysis.windows.net/powerbi/api/GraphQLApi.Execute.All", "offline_access"],
      "authentication": { "method": "oauth2", "registrationRef": "fabric" }
    }
  }
}
```

## Portable service configuration

```json
{
  "schemaVersion": 1,
  "registrations": {
    "fabric": {
      "source": "own",
      "grantType": "client_credentials",
      "clientId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "clientSecretRef": "env:FABRIC_SECRET"
    }
  },
  "integrations": {
    "fabric": {
      "provider": "microsoft-fabric",
      "accountMode": "shared",
      "settings": {
        "tenantId": "11111111-2222-3333-4444-555555555555",
        "graphqlEndpoint": "https://api.fabric.microsoft.com/v1/workspaces/11111111-2222-3333-4444-555555555555/graphqlapis/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/graphql"
      },
      "scopes": ["https://api.fabric.microsoft.com/.default"],
      "authentication": { "method": "oauth2", "registrationRef": "fabric" }
    }
  }
}
```

## Runtime and AI wiring

Import `microsoftFabricProvider` from
`@jskit-ai/connectors-catalog/server/microsoft-fabric`. Compose the normal
`createConnectionService` or `ConnectorsFeature` with trusted application
authorization, reference resolution and the file store. The library already owns
PKCE/state, confidential token exchange, encrypted token persistence, locking,
refresh or service-token renewal, permission checks and disconnect. Do not generate
a second token manager. User consent uses `beginAuthorization` and
`completeAuthorization`; service accounts use `connectClientCredentials` or
`connectors.verifyClientCredentials`.

| Operation | Input | Result |
| --- | --- | --- |
| `connection.check` | None | `data.__typename` from a fixed document |
| `schema.types` | None; introspection must be enabled | Type names/kinds and root query/mutation type names |
| `graphql.execute` | `query`, optional JSON `variables` and `operationName` | One GraphQL response with object `data` |

Documents and encoded variables each have a 65,536-character library bound;
operation names have a 256-character bound. Only JSON variables are accepted.
There is no schema-specific generated client, automatic pagination or subscription
transport. Use fields and cursor arguments defined by the actual API. For example,
an app with an `inventory` field might execute the following *app-owned* document:

```js
const result = await connections.invoke({
  context: authenticatedAppContext,
  integrationId: "fabric",
  operation: "graphql.execute",
  input: {
    query: "query Stock($after: String) { inventory(first: 10, after: $after) { items { id } endCursor hasNextPage } }",
    operationName: "Stock",
    variables: { after: null }
  }
});
```

This is a wiring fragment, not a claim that every API has an inventory table.
`graphql.execute` accepts mutations too. Keep allowed documents in server code,
validate their variables in the app's action, and authorize each invocation.
Do not expose this operation as an unrestricted browser proxy or call it read-only.
GraphQL errors fail the operation even when partial data accompanies them. A
mutation may already have taken effect, so the library never automatically retries
it. Provider error bodies are not exposed. See the
[Fabric query editor](https://learn.microsoft.com/en-us/fabric/data-engineering/api-graphql-editor)
for variables and supported documents.

## What an AI can automate

With explicitly authorized administrative credentials, provisioning can create an
[Entra application](https://learn.microsoft.com/en-us/graph/api/application-post-applications?view=graph-rest-1.0),
configure its Web redirect URIs and delegated resource access, create its
[service principal](https://learn.microsoft.com/en-us/graph/api/serviceprincipal-post-serviceprincipals?view=graph-rest-1.0),
and [generate an application secret](https://learn.microsoft.com/en-us/graph/api/application-addpassword?view=graph-rest-1.0).
The application object ID and client ID are different; return secret values go
directly to the secret store. Check for an existing owned registration first to
avoid duplicates and record the secret expiry.

Fabric also has [GraphQL item management APIs](https://learn.microsoft.com/en-us/rest/api/fabric/graphqlapi/items).
Those are provisioning APIs, not this GraphQL execution adapter. Tenant enablement,
consent policy, resource access, capacity entitlement and data-source configuration
still need an authorized administrator. These setup actions are documented here;
the runtime does not perform them automatically or request admin rights.

## Application ownership, callbacks and capacity

The application owner creates the provider registration and stores its secret
in the application's private Env. Public Vibe64, Vibe64 Online and CLI users use
this same ownership model. The configuration file holds the client ID and Env
references; the editor does not own the application's grants.

Register the exact callback implemented by the application. For a hosted project,
start with its assigned application URL and append the implemented callback path.
Save that same URL through the application's callback Env reference. On a domain
or host change, update both the provider registration and callback Env if the URL
changes. Preserve the application's identity and persistent grant store when
moving it; neither a new editor URL nor a new hosting address creates a new owner.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md) and
[application setup command](../../connectors-core/docs/setup-command.md).

The callback applies to user-consent connections. Service accounts have no OAuth
callback. The application's Entra registration does not by itself grant access to
a customer's Fabric workspace: each directory needs its service principal,
consent where applicable, and Fabric/resource permissions. Multitenant access
still requires the relevant approval and configuration.

Separate registrations support different credentials and policies. They do not
partition a customer's shared Fabric capacity or guarantee separate quotas.

## Verification boundary

Local automated tests use controlled HTTP responses and encrypted temporary files.
They cover both grants, endpoint/tenant binding, variables, partial errors,
renewal, authorization, malformed responses, cancellation and configuration.
They create no Entra applications, service principals, Fabric resources or sample
apps and execute no live documents. Real tenant policy, consent, capacity, API
endpoint reachability, root-type verification and customer schemas remain live
acceptance checks requiring the owner's credentials.

## Editor credential handoff

Save the Application ID, tenant GUID, endpoint and reference fields first. The
screen's **Set credential in Env** link supplies the client secret value; the
default reference is `env:MICROSOFT_FABRIC_CLIENT_SECRET`. For **User consent**,
use **Open Env** to save the exact registered Web callback as
`MICROSOFT_FABRIC_CALLBACK_URL`. Custom reference names remain supported.
**Service account** omits the callback and delegates no user permission.

Once the generated application's runtime is prepared, **Connect account** starts
its configured shared/assistant connection. User consent opens authorization;
service credentials connect without a browser. Per-user mode requires individual
connections inside the application. Saving alone grants neither API nor source
access. Both methods use app-owned credentials and persistent grants.

**LIMITATIONS (acceptance review):** No automatic table browser, schema-specific client, subscriptions, automatic pagination or Vibe64 assistant attachment. Example: the app can execute an inventory query using its real schema; this does not provide an inventory dashboard. Both authentication modes and operation/error handling have fixture proof, not live Fabric resource proof.
