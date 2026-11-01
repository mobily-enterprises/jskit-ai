# Application-owned setup command

An application can expose its connection setup to a CLI or an editor using the
same `createConnectionService()` instance as its backend. JSKIT owns connection
logic and optional stores; the application owns the executable, operator
identity, environment, callback route and deployment. Neither the backend nor
this library requires a particular host to run.

The host that runs the command (an editor, a CLI wrapper or an operations tool)
says how the application declares it, for example as `node
scripts/integrations.js`, and owns its request protocol: the protocol id that
requests carry and responses echo, the input and output size bounds and the
time limit.

The script loads the application's existing configuration and server composition.
Resolve administrator references from its existing Env using
`createEnvironmentReferenceResolver()`. Use an application-owned store whose
identity includes the environment. Keep runtime data outside source and release
snapshots. The script's operator context must be established by the application;
never accept applicationId, subjectId or administrator privileges from stdin.
The normal service `authorize` callback still enforces connect/status/disconnect
permissions. A host user's identity is not an application user's identity.

## Dispatch example

The following function belongs in the application's script. It accepts the
already-created service, validated configuration, trusted operator context and
the protocol id of the host that runs the command. It is deliberately a
composition example, not a new JSKIT command runner.

```js
async function dispatchSetup(request, { protocol, connections, configuration, context }) {
  const { requestId, operation, integrationId } = request;
  if (request.protocol !== protocol ||
      typeof requestId !== "string" || !requestId ||
      !["status", "connect", "cancel", "disconnect"].includes(operation) ||
      !Object.hasOwn(configuration.integrations, integrationId)) {
    throw new Error("Invalid integration setup request.");
  }
  const integration = configuration.integrations[integrationId];
  if (integration.accountMode === "per-user") {
    throw new Error("Individual users connect inside the application.");
  }
  const input = { context, integrationId };
  let result;
  try {
    if (operation === "disconnect") result = await connections.disconnect(input);
    else if (operation === "cancel") {
      if (typeof request.attemptId !== "string" || !request.attemptId) {
        throw new Error("Choose the pending attempt to cancel.");
      }
      result = await connections.cancelAuthorization({ ...input, state: request.attemptId });
    } else if (operation === "status") {
      result = await connections.resumeAuthorization(input) || await connections.status(input);
    } else {
      const verification = { ...input, verificationInput: request.verificationInput || {} };
      const method = integration.authentication.method;
      if (method === "api-key") result = await connections.connectApiKey(verification);
      else if (method === "none") result = await connections.connectWithoutCredentials(verification);
      else if (method === "service-account") result = await connections.connectServiceAccount(verification);
      else if (configuration.registrations[integration.authentication.registrationRef].grantType === "client_credentials") {
        result = await connections.connectClientCredentials(verification);
      } else result = await connections.beginAuthorization(verification);
    }
  } catch (error) {
    const setupIssue = {
      connector_binding_missing: "credentials-missing",
      connector_callback_invalid: "callback-invalid"
    }[error.code];
    if (["status", "connect"].includes(operation) && setupIssue) {
      const previous = await connections.status(input);
      if (["connected", "reconnect-required"].includes(previous.status)) {
        return { protocol, requestId, status: "reconnect-required" };
      }
      return { protocol, requestId, status: "unconfigured", setupIssue };
    }
    throw error;
  }
  if (result.authorizationUrl) {
    return { protocol, requestId, status: "pending", authorizationUrl: result.authorizationUrl,
      attemptId: new URL(result.authorizationUrl).searchParams.get("state"),
      expiresAt: new Date(result.expiresAt).toISOString(), callbackUrl: result.callbackUrl };
  }
  return { protocol, requestId, status: result.status,
    ...(result.callbackUrl ? { callbackUrl: result.callbackUrl } : {}),
    ...(result.accountLabel ? { accountLabel: result.accountLabel } : {}),
    ...(result.configurationError ? { setupIssue: {
      connector_binding_missing: "credentials-missing",
      connector_callback_invalid: "callback-invalid"
    }[result.configurationError] } : {}),
    ...(result.grantedScopes ? { grantedScopes: result.grantedScopes } : {}),
    ...(result.verifiedAt !== undefined ? { verifiedAt: new Date(result.verifiedAt).toISOString() } : {}) };
}
```

Read exactly one JSON request from stdin within the host's input bound. Write
only the returned JSON object plus a newline to stdout. On failure exit nonzero;
do not print credentials, provider responses or raw exceptions. Close the
application's database pool/resources in `finally`. The host bounds the
command's time; return pending immediately instead of waiting for browser
consent.

`verificationInput` supplies provider-specific check inputs such as a resource
ID. It is not a credential entry channel. Keys and client secrets belong in Env.
A configuration save does not verify credentials or produce a connected state.

Status validates required local bindings without calling the provider. Before a
first connection, missing credentials or an invalid callback produce
`unconfigured` with a safe `configurationError` code; the dispatcher maps that
code to the host's setup guidance. A previous grant remains available for
disconnect and reports `reconnect-required` when its bindings are incomplete.
For a valid authorization-code registration, status and pending authorization
report `callbackUrl` resolved from the application's Env. This is the URL to
register with the provider, not one the host suggests. Invalid or incomplete
bindings do not expose an unvalidated callback or private Env values.

Providers may expose `accountLabel` from their verified account response. Gmail
uses the mailbox address returned by its existing profile check; no additional
permission or request is needed. The runtime persists this display label with
the grant and status returns it after restart. Labels must be nonblank strings
of at most 256 characters without control or formatting characters. They are
display metadata, never an authentication identity or authorization input.
Providers without a reliable account label omit it. Disconnect removes it with
the grant; cancelled replacement consent retains the previous grant's label.

## Callback and recovery

### Individual application accounts

For `accountMode: "per-user"`, the host configures the OAuth client but does
not run this shared-operator dispatcher. The application implements its own
connection screen using its existing UI and authenticated routes:

| App action | Existing runtime operation | Ownership input |
|---|---|---|
| Show connection | `status()` and, when needed, `resumeAuthorization()` | Current authenticated app user |
| Connect or reconnect | `beginAuthorization()` | Current app user after the app's mutation/CSRF checks |
| Receive provider callback | `completeAuthorization()` | Authenticated initiating user, recovered by the app's session system |
| Cancel pending consent | `cancelAuthorization()` followed by `status()` | Current user and the exact pending state |
| Disconnect | `disconnect()` | Current user after the app's mutation/CSRF checks |

Supply `{ context, integrationId }` to each operation. Derive `context` from
trusted application authentication and membership, never a form field, callback
query or host identity. The service's `authorize` function must enforce the
application and user boundary. Keep registration credentials in backend Env;
each user's grant lives separately in the existing connection store. The browser
receives only safe status/consent metadata. OAuth callback state does not replace
the application's own authentication. This account-linking flow does not create
a Google login feature.

### Shared callback requirements

Implement the HTTP callback in the application using its own routing and
session/authentication system. Bind the browser's authorization flow to the
application identity that initiated it. Call `completeAuthorization()` with that
trusted context, integration ID and the received absolute callback URL. Do not
trust a query-string user ID. Its saved state/PKCE checks and one-time consumption
remain mandatory. Redirect back to an application-owned result page after
completion; never put tokens in that redirect.

The callback Env value must match both this real route and the provider's
registered redirect URI. For a hosted project use its assigned application URL
as the starting origin, then append the implemented callback path. Custom domains
or explicit overrides require updating that Env value and provider registration;
changing the host's hostname cannot change application identity.

Status can recover a still-valid pending attempt after the process restarts.
Cancellation consumes its state and preserves an earlier working connection.
After cancel, check status again. Disconnect removes this app connection and its
pending attempts. It makes no provider revocation request and does not delete
configuration or Env credentials. Revoke consent or keys separately through the
provider's account settings; that may affect other apps sharing the registration
or key. Do not present local removal as provider-wide revocation.
No raw PKCE verifier, access token or refresh token belongs in setup output.

This example documents the command boundary. It does not install an application's
callback, create users, configure its store, register an OAuth client, or prove
that its deployed environment has been wired correctly.
