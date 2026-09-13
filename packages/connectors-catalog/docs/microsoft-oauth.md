# Microsoft Graph registration and connection wiring

Registration, tenant selection and document APIs checked: 9 September 2026. These fragments use delegated OAuth
authorization codes with PKCE and a confidential backend registration. Provider
HTTP is simulated in automated tests; no live Microsoft account is used.

## Manual registration

1. Sign in to Microsoft Entra admin center and select the directory that will
   own the registration. Open **Entra ID → App registrations → New registration**.
2. Name the app. For Outlook, OneDrive, Excel, OneNote, Word and PowerPoint select **Any Entra ID
   Tenant + Personal Microsoft accounts**. For Teams and SharePoint select
   **Multiple Entra ID tenants**. These correspond to the implemented `common`
   and `organizations` defaults. For one directory choose **Single tenant only**
   and copy its **Directory (tenant) ID** from the registration Overview. For a
   personal-only registration choose **Personal accounts only** and configure
   `consumers` (not supported by Teams/SharePoint). Select **Register** and
   record **Application (client) ID**. [Registration instructions](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).
3. Open **Authentication → Redirect URI configuration → Add Redirect URI**.
   Choose **Web**, enter the exact backend callback address, then **Configure**.
   For local development use a registered localhost callback served by the
   operator's backend. Hosted and installed editors use the same application-owned callback;
   neither provides a central redirect service.
   [Redirect configuration](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri).
4. Open **API permissions → Add a permission → Microsoft Graph → Delegated
   permissions**. Add the permission in the provider guide plus `offline_access`.
   Consent remains subject to directory policy. The fragment does not need
   `openid`, profile login or an application-permission service account.
   [Delegated authorization flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
5. Open **Certificates & secrets → Client secrets → New client secret**. Add a
   description and expiration, then **Add**. Store **Value**, not Secret ID, in
   private Env. Copy it before leaving the page. Microsoft recommends certificate
   or federated credentials for production; this initial library implements
   client-secret POST authentication only. [Credentials](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials).
6. In the CLI JSON or shared editor form set Client ID, **Directory (tenant) ID**,
   the secret reference and callback reference. The tenant setting accepts the
   applicable audience keyword above or a directory GUID. It is not a URL or
   the Application ID. Tenant domain names and sovereign clouds are not supported. Save the configuration; run the separate OAuth flow
   below to establish a connection. After saving, use **Set credential in Env** for the client secret and
   **Open Env** for the exact registered callback. Shared/assistant connections
   can use **Connect account** once the application runtime is prepared. For
   per-user mode, each user authorizes inside that application.

## AI automation and application registrations

Classification: **API-capable after operator authorization**. An authorized
provisioner can create application objects through `POST /v1.0/applications`,
setting `displayName`, `signInAudience`, `web.redirectUris` and the required
resource permissions. Current create permissions include `AppRegistration.Create`;
tenant policy and caller roles still apply. [Create application](https://learn.microsoft.com/en-us/graph/api/application-post-applications?view=graph-rest-1.0).

It can create/rotate a secret with `POST /v1.0/applications/{object-id}/addPassword`.
That operation requires separate authorization: delegated `Application.ReadWrite.All`
or an appropriate application permission such as `Application.ReadWrite.OwnedBy`.
Capture the one-time `secretText` directly into private storage. Creating an
object does not bypass customer consent, tenant restrictions or publisher review.
[Add password](https://learn.microsoft.com/en-us/graph/api/application-addpassword?view=graph-rest-1.0).

Create the registration for the application being configured. Its backend owns
its callback route and resolves its secret from the application environment.
Keep development and production bindings explicit. When the callback domain
changes, update its Web redirect URI and environment binding before reconnecting.
See the [callback guide](../../connectors-core/docs/oauth-callbacks.md).

The selected tenant and audience remain provider requirements. Editor hosting
does not change them or grant a shared registration. App IDs do not isolate all
user, tenant and service limits; see [Graph throttling](https://learn.microsoft.com/en-us/graph/throttling-limits).
The automation guidance above requires operator authorization and does not
claim a provisioning script or live registration has been tested.

## CLI and application composition

Use the imports and file-store composition from the
[connection pattern](../patterns/api-key-connection/PATTERN.md), replacing the
provider and authentication configuration. For an Outlook slot:

```json
{
  "schemaVersion": 1,
  "integrations": {
    "inbox": {
      "provider": "microsoft-outlook",
      "accountMode": "per-user",
      "scopes": ["Mail.Read", "offline_access"],
      "settings": { "tenantId": "common" },
      "authentication": { "method": "oauth2", "registrationRef": "microsoft" }
    }
  },
  "registrations": {
    "microsoft": {
      "source": "own",
      "clientId": "YOUR_APPLICATION_CLIENT_ID",
      "clientSecretRef": "env:MICROSOFT_CLIENT_SECRET",
      "callbackUrlRef": "env:MICROSOFT_CALLBACK_URL"
    }
  }
}
```

Import `microsoftOutlookProvider` from
`@jskit-ai/connectors-catalog/server/microsoft-outlook`. Pass it to
`createConnectionService` along with parsed configuration, the environment
resolver, a private encrypted file store and the application's authorization
policy. The policy establishes a trusted application/subject; request body
IDs do not establish ownership. Use a stable shared subject only after checking
membership for a shared connection.

Call `beginAuthorization({ context, integrationId, verificationInput })`. Present
its authorization URL to that user in their browser. The existing application
serves the configured callback and invokes
`completeAuthorization({ context, integrationId, callbackUrl })`. It returns
Connected only after the provider's verification read succeeds. The CLI can
compose the same calls through an operator-owned callback server. No application
generator or copied OAuth implementation is needed.

Use `invoke` with the provider's named operation and validated inputs. Store
returned tokens only through the private runtime store, outside application
source. Reuse its stable encryption key across restarts. Keep bare Graph scope
names in configuration; `offline_access` requests refresh capability and is not
a permission to read Graph resources. These connectors do not establish an
application login session. The selected tenant controls authorization, code
exchange and refresh endpoints. Changing it invalidates pending attempts and
requires reconnecting existing grants before further API access; editing the
configuration cannot move a grant between tenants. Registrations must support
the selected audience; schema validation cannot establish a remote client's
registration policy.

## Paging, failures and recovery

List results retain `@odata.nextLink`. Supply it as `nextLink` with the original
resource input on the next call. The fragment sends its opaque query intact
and rejects other origins, paths, users, credentials or URL fragments. It does
not fetch every page automatically. Endpoint path rewrites in provider paging
URLs are currently rejected and would need separately verified support.
[Graph paging contract](https://learn.microsoft.com/en-us/graph/paging).

Cancel a pending attempt with `cancelAuthorization`; disconnect removes local
tokens and pending attempts. It does not revoke provider-wide consent. Provider
401/invalid grants require reconnection; 403 and 429 are controlled errors.
Rotate expiring registration secrets in Env before removing old credentials.
Do not log token exchange bodies. Tests cover code/state consumption, PKCE,
permission failures, request boundaries, encrypted file restart and refresh
rotation for all eight providers.
