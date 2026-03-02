
  Target End State

  1. @jskit-ai/access-core contains only provider-agnostic auth primitives.
  2. OAuth provider IDs/labels/default are owned by provider packages (starting with auth-provider-supabase-core).
  3. auth-base can run with any provider package; it does not encode google or Supabase specifics.
  4. Framework users can enable providers by config, not by editing framework source.
  5. Optional strict mode: auth-base fails unless one auth.provider is installed.

  Stage 0: Freeze Contract (Hard Cut)

  1. Decide and lock provider ID format: ^[a-z0-9][a-z0-9_-]{1,31}$.
  2. Decide and lock API output shape for provider catalog: { id, label }[] plus defaultProvider.
  3. Decide and lock whether auth-base strictly requires auth.provider now (recommended: yes).
  4. Declare hard break: remove static provider exports from access-core (no back-compat aliases).

  Stage 1: Refactor access-core to be provider-agnostic

  1. Replace static provider list in oauthProviders.js (/home/merc/Development/current/jskit-ai/packages/auth/
     access-core/src/shared/oauthProviders.js) with generic helpers:
     normalizeOAuthProviderId, isValidOAuthProviderId, normalizeOAuthProviderList.
  2. Refactor authMethods.js (/home/merc/Development/current/jskit-ai/packages/auth/access-core/src/shared/
     authMethods.js):
     keep password/otp constants; replace static OAuth method definitions with builder functions that accept
     provider catalog input.
  3. Update index.js (/home/merc/Development/current/jskit-ai/packages/auth/access-core/src/shared/index.js) exports
     to new generic API surface.
  4. Add/adjust access-core tests for provider ID normalization and method-definition builders.

  Stage 2: Move provider vocabulary into auth-provider-supabase-core

  1. Add oauthProviderCatalog module in auth-provider-supabase-core (new file under src/shared/lib).
  2. Parse allowed providers from config/env (for example AUTH_OAUTH_PROVIDERS=google,github,apple).
  3. Define default provider from configured list, not from access-core.
  4. Update authInputParsers.js (/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/
     src/shared/lib/authInputParsers.js) to validate against provider package catalog.
  5. Update authRedirectUrls.js (/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/
     src/shared/lib/authRedirectUrls.js) to use provider package catalog.
  6. Update service.js (/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src/
     shared/service.js) to inject and expose catalog/default provider.
  7. Update oauthFlows.js (/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/src/
     shared/lib/oauthFlows.js) to use dynamic provider list and provider-specific options map.
  8. Update authMethodStatus.js (/home/merc/Development/current/jskit-ai/packages/auth/auth-provider-supabase-core/
     src/shared/lib/authMethodStatus.js) to derive OAuth method entries from supplied catalog, not static global
     list.

  Stage 3: Make auth-fastify-adapter schema generic

  1. Update schema.js (/home/merc/Development/current/jskit-ai/packages/auth/auth-web/src/shared/
     schema.js):
     remove enum import of AUTH_OAUTH_PROVIDERS; validate provider by regex string.
  2. Keep authMethodKind enum static (password|otp|oauth), but make authMethodId generic pattern (password|
     email_otp|oauth:<providerId>).
  3. Keep routes.js (/home/merc/Development/current/jskit-ai/packages/auth/auth-web/src/shared/
     routes.js) and controller.js (/home/merc/Development/current/jskit-ai/packages/auth/auth-web/src/
     shared/controller.js) flow unchanged except for schema contract updates.

  Stage 4: Make provider requirement explicit in capabilities (recommended)

  1. Update auth-fastify-adapter descriptor (/home/merc/Development/current/jskit-ai/packages/auth/auth-fastify-
     adapter/package.descriptor.mjs) or another core auth package to require auth.provider.
  2. Keep provider capability provided by auth-provider-supabase-core descriptor (/home/merc/Development/current/
     jskit-ai/packages/auth/auth-provider-supabase-core/package.descriptor.mjs).
  3. Result: auth-base truly provider-agnostic but cannot run without one provider bundle.

  Stage 5: Bundle model cleanup

  1. Keep auth-base as core-only bundle.
  2. Convert auth-supabase to provider-only bundle (mirror assistant pattern), containing only @jskit-ai/auth-
     provider-supabase-core, and mark it as provider bundle.
  3. Update bundle docs and CLI expectations accordingly.

  Stage 6: App integration contract

  1. Add provider-catalog API response in auth service/session payload so frontend reads active providers
     dynamically.
  2. Remove frontend dependence on AUTH_OAUTH_PROVIDER_METADATA from access-core in apps/jskit-value-app/src/
     modules/auth/oauthProviders.js (/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/modules/auth/
     oauthProviders.js).
  3. Update server module copies in apps/jskit-value-app/server/modules/auth/lib/* to new generic parser/catalog
     contract.
  4. Ensure “homebrew password-only” works with empty OAuth catalog while keeping password/otp intact.

  Stage 7: Tooling and display alignment

  1. Keep bundle marker [supabase] on auth-base only if auth.provider is required.
  2. Keep package marker [supabase] on demanding package lines in --full.
  3. Keep * for actual provider packages.

  Stage 8: Test matrix (must pass before merge)

  1. npm test --workspace @jskit-ai/access-core
  2. npm test --workspace @jskit-ai/auth-web
  3. npm test --workspace @jskit-ai/auth-provider-supabase-core
  4. npm test --workspace @jskit-ai/jskit
  5. apps/jskit-value-app auth unit/integration tests touching OAuth provider parsing, method status, and routes.

  Stage 9: Documentation

  1. Update auth framework docs: provider catalog ownership, env/config format, strict provider capability rule.
  2. Update bundle docs: auth-base vs auth-supabase.
  3. Add “add new auth provider package” playbook with required capabilities and contract tests.

  Stage 10: Definition of Done

  1. No hardcoded OAuth provider list in access-core.
  2. No google default in framework core.
  3. Provider package controls allowed OAuth providers.
  4. auth-base + provider bundle works for any configured provider IDs without framework code edits.
  5. All tests green.

  If you want, next step I can turn this into a commit-by-commit execution sequence (exact commit boundaries and
  file order).

