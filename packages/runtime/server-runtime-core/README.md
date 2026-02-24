# @jskit-ai/server-runtime-core

Shared server-side runtime primitives for request/error/number normalization.

## Purpose

Centralize app-agnostic server runtime helpers used across services, adapters, and controllers.

## Public API

- `@jskit-ai/server-runtime-core/errors`
  - `AppError`
  - `isAppError`
- `@jskit-ai/server-runtime-core/integers`
  - `parsePositiveInteger`
- `@jskit-ai/server-runtime-core/requestUrl`
  - `safeRequestUrl`
  - `safePathnameFromRequest`
  - `resolveClientIpAddress`
- `@jskit-ai/server-runtime-core/pagination`
  - `normalizePagination`

## Examples

```js
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { safePathnameFromRequest } from "@jskit-ai/server-runtime-core/requestUrl";

const workspaceId = parsePositiveInteger(request.params.workspaceId);
if (!workspaceId) {
  throw new AppError(400, "Validation failed.");
}

const pathname = safePathnameFromRequest(request);
```

## Non-goals

- Framework-specific Fastify plugins/controllers
- App/domain-specific validation and policy logic
- Database-specific primitives
