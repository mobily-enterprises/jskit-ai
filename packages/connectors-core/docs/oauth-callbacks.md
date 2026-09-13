# Application-owned OAuth callbacks

Each application supplies its own provider registration and callback route.
The editor's hosting domain does not supply a callback or a shared registration.
The application must keep working when exported or when the editor stops.

## Configuration and ownership

Set registration `source` to `own`. Put the public client ID in `clientId`,
the client secret reference in `clientSecretRef`, and the full callback URL
reference in `callbackUrlRef`. For example, `env:GOOGLE_CALLBACK_URL` resolves
to an application-controlled URL such as
`https://example.com/integrations/google/callback`. That example is not a
provisioned endpoint: application code must implement it before connection.

Register the resolved callback with the provider using its required redirect
rules. Development and production use their own environment bindings and runtime
state. Never use an editor dashboard URL as an application callback. Providers
may require separate registrations or allow several explicit redirect URLs;
follow the provider guide rather than assuming wildcard support.

## Application flow

1. Authenticate the initiating user or authorized setup operator in the app.
2. Call `beginAuthorization` with the app-derived owner and integration ID.
3. Open the returned authorization URL. Keep the pending attempt in the app's
   durable connection store; closing an editor panel must not delete it.
4. The app callback passes the complete callback URL to `completeAuthorization`
   under the same authenticated owner. The runtime validates the pending attempt,
   exchanges the code, verifies access and stores the grant.
5. Render safe connection status. Tokens and provider callback parameters do
   not belong in editor messages or source configuration.

Application code owns HTTP routes and identity recovery on the callback. A
browser message is not proof of a successful connection. A CLI can use these
same library operations with the application's callback and storage.
`cancelAuthorization` cancels a pending attempt while preserving an existing
connection. `disconnect` removes local access and invalidates pending consent;
it does not promise provider-wide revocation.

The application authorization callback must distinguish shared-account setup
from individual app-user connection. Connecting an administrator's mailbox does
not grant every user access to their own mailbox, nor grant other projects access.
Application login remains separate from permission to read provider data.

## Changing domains or moving the application

Before changing domains, configure the new callback at the provider and in the
application environment. A changed callback invalidates pending authorization;
start a fresh attempt instead of reusing one begun with the old callback.
Existing grants can remain usable when the provider does not bind refresh to
the old redirect URI. Providers whose refresh operation requires that URI report
reconnection when it changes. Changing the registration's client identity also
requires reconnection. Users may need to sign into the app again on the new
domain, independently of whether their provider grant remains usable.

Moving source alone does not move grants. Supply the app's environment, durable
connection storage and encryption keys at the new installation. Preserve its
application and subject identities. No editor service is needed to refresh tokens.

## Verification limits

Protocol fixtures cover callback binding, ownership, denial, replay, cancellation
and registration changes. They do not prove provider approval, a deployed route,
a real browser consent flow or a complete generated application.
