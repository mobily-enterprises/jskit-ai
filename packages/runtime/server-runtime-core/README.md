# @jskit-ai/server-runtime-core

Shared server-side runtime primitives for request/error/number normalization.

## Scope

- `AppError` and `isAppError`
- `parsePositiveInteger`
- `safeRequestUrl`, `safePathnameFromRequest`, `resolveClientIpAddress`
- `normalizePagination`

## Non-goals

- Framework-specific Fastify plugins/controllers
- App/domain-specific validation and policy logic
- Database-specific primitives
