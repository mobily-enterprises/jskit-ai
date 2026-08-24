# Authentication

JSKIT separates provider-neutral authentication behavior, one selected identity
provider, and the browser authentication surface.

For local authentication:

```bash
npm install @jskit-ai/auth-provider-local-core @jskit-ai/auth-web
```

For Supabase authentication:

```bash
npm install @jskit-ai/auth-provider-supabase-core @jskit-ai/auth-web
```

The dependency graph supplies `@jskit-ai/auth-core`. Do not install two
providers for the same `auth.service` capability.

## Provider ownership

The selected provider owns identity verification and sessions. The application
owns permitted login methods, visible OAuth providers, public routes,
post-login destinations, surface access policy, and secret injection.

Use the `auth/auth-surface` pattern for login, sign-out, reset, guards, profile
placements, and HTTP integration. Use `auth/supabase-auth` for the Supabase
environment and configuration shape.

## Server boundary

`@jskit-ai/auth-core` exposes the policy, actor, extension, and action contracts.
Protected server operations declare an auth policy; they do not trust a hidden
button or a page-local session check. Other packages extend auth through the
public extension capability rather than replacing the auth service.

## Browser boundary

`@jskit-ai/auth-web` owns the normal auth views, guard runtime, sign-out flow,
and auth-aware HTTP integration. Applications may wrap and style those views
while retaining the behavior contract.

Initial load errors stay inside the affected surface. Failed login, reset, and
other transient mutations use the application toast and do not shift the form.
Loading uses skeletons when content geometry is known.

## Verification

Test successful and failed registration/login, sign-out, password reset,
protected direct navigation, return destinations, refresh, expired sessions,
and negative cross-origin behavior. For Supabase, also exercise callback and
refresh flows.

For direct localhost Playwright tests, enable the development auth bypass only
in the server process and use `loginAsExistingUser()` from
`@jskit-ai/auth-web/test/playwright`. The Node-side helper sends the private
`x-jskit-dev-auth-secret`; never pass that secret through browser code, URLs, or
client environment.

A managed host instead supplies authenticated state through
`VIBE64_PLAYWRIGHT_STORAGE_STATE` and the app-owned Playwright config. Treat the
file as a temporary secret, use relative URLs, and do not call the localhost
login helper or start a duplicate server.

Never commit provider secrets, copy auth repositories into the app, or add an
installation questionnaire, mutation record, or setup receipt.
