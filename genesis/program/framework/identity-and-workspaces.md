# Identity, users, and workspaces

Provides authentication-neutral identity contracts plus local and Supabase
providers, account profiles, authenticated web routes, and workspace tenancy.

## Sources

- Main: `packages/auth-core/src/server/providers/AuthFeature.js`
- `packages/auth-web/src/server/AuthWebFeature.js`
- `packages/users-core/src/server/UsersFeature.js`
- `packages/workspaces-core/src/server/WorkspacesFeature.js`
- `packages/auth-web/src/server/managedPreviewIdentity.js`
- `packages/auth-provider-local-core/src/server/lib/oauth.js`

## Public contract

Applications choose and configure an authentication provider, associate its
verified identity with existing application users, and authorize account and
workspace operations through explicit features and routes. Personal tenancy
always provisions each user's workspace on profile synchronization; multi-workspace
tenancy does so only when the application opts in with `autoProvision`. New
workspaces start from the application's configured colours. Managed Preview can
exchange a host-authorized selector for an existing development user's normal
application session; it neither creates users nor grants roles, and does not run
profile synchronization.

Local auth also signs people in through Google, Microsoft, and GitHub when the
application sets that provider's client id and secret. The authorization-code
flow uses PKCE, state, and nonce, with each attempt stored server-side, bound to
the starting browser, used once, and expiring after ten minutes. ID tokens are
verified against the provider's keys, and only a verified email signs in. A
sign-in matches the provider subject, then an existing account's email, and
otherwise creates the user the way registration does, so profile
synchronization provisions it. Signed-in people link and unlink providers from
account settings, but cannot remove their last sign-in method.
