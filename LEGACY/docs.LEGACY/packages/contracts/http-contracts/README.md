# `@jskit-ai/http-contracts`

Shared TypeBox HTTP contract helpers for server route schemas.

This package centralizes scaffolding-level schema utilities so apps do not duplicate:

1. Standard API error response schemas and wrappers.
2. Enum literal-union schema helper.
3. Pagination query schema helper.
4. Shared TypeBox format registration (`uuid`, `iso-utc-date-time`).

## What This Package Is For

Use this package when multiple apps/adapters need consistent Fastify/TypeBox schema primitives.

Practical value:

1. Keep route contract behavior consistent across apps.
2. Avoid copy-pasting schema helper files in app scaffolding.
3. Make schema fixes once and roll them out incrementally.

## What This Package Is Not For

1. No controllers/routes.
2. No database logic.
3. No app/domain policy logic.
4. No business-specific schema vocabularies.

## Public API

```js
import {
  withStandardErrorResponses,
  enumSchema,
  createPaginationQuerySchema,
  registerTypeBoxFormats
} from "@jskit-ai/http-contracts";
```

Subpath exports:

1. `@jskit-ai/http-contracts/errorResponses`
2. `@jskit-ai/http-contracts/paginationQuery`
3. `@jskit-ai/http-contracts/typeboxFormats`

## Error schema exports (`errorResponses`)

Functions:

1. `withStandardErrorResponses(successResponses, { includeValidation400 })`
2. `enumSchema(values)`

Constants and schemas:

1. `STANDARD_ERROR_STATUS_CODES`
2. `fieldErrorsSchema`
3. `apiErrorDetailsSchema`
4. `apiErrorResponseSchema`
5. `apiValidationErrorResponseSchema`
6. `fastifyDefaultErrorResponseSchema`

Practical real-life examples:

1. Reuse `apiValidationErrorResponseSchema` for endpoints that return field-level form errors.
2. Reuse `fastifyDefaultErrorResponseSchema` so uncaught errors still conform to a documented response shape.
3. Use `STANDARD_ERROR_STATUS_CODES` when generating consistent OpenAPI response maps across many routes.

## Examples

Standard error responses:

```js
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";

const response = withStandardErrorResponses(
  {
    200: MySuccessSchema
  },
  { includeValidation400: true }
);
```

Enum helper:

```js
import { enumSchema } from "@jskit-ai/http-contracts/errorResponses";

const status = enumSchema(["draft", "active", "archived"]);
```

Pagination query schema:

```js
import { createPaginationQuerySchema } from "@jskit-ai/http-contracts/paginationQuery";

const query = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 20,
  maxPageSize: 200
});
```

TypeBox format registration:

```js
import { registerTypeBoxFormats } from "@jskit-ai/http-contracts/typeboxFormats";

registerTypeBoxFormats();
```
