# Identity, users, and workspaces

Provides authentication-neutral identity contracts plus local and Supabase
providers, account profiles, authenticated web routes, and workspace tenancy.

## Sources

- Main: `packages/auth-core/src/server/providers/AuthFeature.js`
- `packages/auth-web/src/server/AuthWebFeature.js`
- `packages/users-core/src/server/UsersFeature.js`
- `packages/workspaces-core/src/server/WorkspacesFeature.js`
- `packages/auth-web/src/server/managedPreviewIdentity.js`

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
