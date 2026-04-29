# CRUD Schema Flow

This file describes how a CRUD module in `jskit-ai` uses `json-rest-schema` today, from the shared resource contract all the way through routes, actions, services, and the repository runtime.

The key rule is:

- shared CRUD contracts are authored once as schema definition objects
- the same contracts are reused at the HTTP boundary, action boundary, and repository boundary

The standard authored shape is:

```js
{
  schema: createSchema({ ... }),
  mode: "create" | "patch" | "replace"
}
```

## 1. Shared Resource Contract

The root contract for a CRUD module is the shared resource file.

Representative file:

- `packages/crud-server-generator/templates/src/local-package/shared/crudResource.js`

Important shape:

```js
const recordOutputSchema = createSchema({
  // record fields...
});

const createBodySchema = createSchema({
  // create fields...
});

const patchBodySchema = createSchema({
  // patch fields...
});

const recordOutput = deepFreeze({
  schema: recordOutputSchema,
  mode: "replace"
});

const listOutput = createCursorListValidator(recordOutput);

const createBody = deepFreeze({
  schema: createBodySchema,
  mode: "create"
});

const patchBody = deepFreeze({
  schema: patchBodySchema,
  mode: "patch"
});

const resource = deepFreeze({
  namespace: "customers",
  tableName: "customers",
  idColumn: "id",
  operations: {
    list: {
      method: "GET",
      output: listOutput
    },
    view: {
      method: "GET",
      output: recordOutput
    },
    create: {
      method: "POST",
      body: createBody,
      output: recordOutput
    },
    patch: {
      method: "PATCH",
      body: patchBody,
      output: recordOutput
    },
    delete: {
      method: "DELETE",
      output: deleteOutput
    }
  }
});
```

Important points:

- `resource.operations.create.body` is the canonical create-input contract
- `resource.operations.patch.body` is the canonical patch-input contract
- `resource.operations.view.output` is the canonical record-output contract
- `resource.operations.list.output` is derived from the record-output contract

## 2. List Output Wrapper

List output is built from the item schema, not hand-authored separately.

Owner:

- `packages/kernel/shared/validators/createCursorListValidator.js`

Important code:

```js
function createCursorListValidator(itemValidator) {
  const itemDefinition = normalizeSingleSchemaDefinition(itemValidator, {
    context: "cursor list item",
    defaultMode: "replace"
  });

  return deepFreeze({
    schema: createSchema({
      items: {
        type: "array",
        required: true,
        items: itemDefinition.schema
      },
      nextCursor: {
        type: "string",
        required: false,
        nullable: true,
        minLength: 1
      }
    }),
    mode: "replace"
  });
}
```

So list output is:

- `items: <array of record output items>`
- `nextCursor: string | null`

## 3. Provider Wiring

The provider wires repository, service, actions, and routes.

Representative file:

- `packages/crud-server-generator/templates/src/local-package/server/CrudProvider.js`

Important code:

```js
app.singleton("repository.customers", (scope) => {
  const knex = scope.make("jskit.database.knex");
  return createRepository(knex, {
    resolveLookup: createCrudLookupResolver(scope)
  });
});

app.service(
  "crud.customers",
  (scope) => {
    return createService({
      customersRepository: scope.make("repository.customers")
    });
  },
  {
    events: serviceEvents
  }
);

app.actions(
  withActionDefaults(
    createActions({
      surface: crudPolicy.surfaceId
    }),
    {
      domain: "crud",
      dependencies: {
        customersService: "crud.customers"
      }
    }
  )
);
```

The provider does not validate payloads itself. It only wires the runtime graph.

## 4. Route Contracts

Routes consume the shared resource contract directly.

Representative file:

- `packages/crud-server-generator/templates/src/local-package/server/registerRoutes.js`

### Create route

```js
router.register(
  "POST",
  routeBase,
  {
    body: resource.operations.create.body,
    responses: withStandardErrorResponses(
      {
        201: resource.operations.create.output
      },
      { includeValidation400: true }
    )
  },
  async function (request, reply) {
    const response = await request.executeAction({
      actionId: actionIds.create,
      input: {
        ...(request.input.body || {})
      }
    });
    reply.code(201).send(response);
  }
);
```

### Patch route

```js
router.register(
  "PATCH",
  `${routeBase}/:recordId`,
  {
    params: recordRouteParamsValidator,
    body: resource.operations.patch.body,
    responses: withStandardErrorResponses(
      {
        200: resource.operations.patch.output
      },
      { includeValidation400: true }
    )
  },
  async function (request, reply) {
    const response = await request.executeAction({
      actionId: actionIds.update,
      input: {
        recordId: request.input.params.recordId,
        ...(request.input.body || {})
      }
    });
    reply.code(200).send(response);
  }
);
```

### List route

List query is composed from multiple schema definitions:

```js
const listRouteQueryValidator = composeSchemaDefinitions([
  listCursorPaginationQueryValidator,
  listSearchQueryValidator,
  listParentFilterQueryValidator,
  lookupIncludeQueryValidator
], {
  mode: "patch",
  context: "customers.registerRoutes.listRouteQueryValidator"
});
```

So routes use:

- body schemas from `resource.operations.*.body`
- output schemas from `resource.operations.*.output`
- query/params schemas from shared validators composed into one schema definition

## 5. Route Compilation

Route definitions are compiled into:

- Fastify transport schema
- runtime input transforms that validate and normalize `request.body/query/params`

Owner:

- `packages/kernel/server/http/lib/routeValidator.js`

Important code:

```js
if (normalizedValidator.body) {
  schema.body = resolveSchemaTransportSchemaDefinition(normalizedValidator.body, {
    defaultMode: "patch",
    context: "route validator.body"
  });
  input.body = createJsonRestSchemaInputTransform(normalizedValidator.body, {
    defaultMode: "patch",
    context: "route validator.body"
  });
}
```

The input transform is:

```js
function createJsonRestSchemaInputTransform(definition, { defaultMode = "patch", context = "route validator" } = {}) {
  return (payload) => validateSchemaPayload(definition, payload, {
    phase: defaultMode === "replace" ? "output" : "input",
    context,
    statusCode: 400
  });
}
```

So each route validator produces:

- `schema.body/querystring/params` for Fastify
- `input.body/query/params` for normalized request input

## 6. Request Input Construction

Once a route is registered, `request.input` is built from the compiled transforms.

Owner:

- `packages/kernel/server/http/lib/routeRegistration.js`

Important code:

```js
if (routeInputTransforms) {
  request.input = await buildRequestInput({
    request,
    inputTransforms: routeInputTransforms
  });
}
```

And:

```js
const body = typeof transforms.body === "function" ? await transforms.body(request?.body, request) : request?.body;
const query = typeof transforms.query === "function" ? await transforms.query(request?.query, request) : request?.query;
const params = typeof transforms.params === "function" ? await transforms.params(request?.params, request) : request?.params;
```

After this stage:

- `request.input.body`
- `request.input.query`
- `request.input.params`

are already validated and normalized.

## 7. Route Handler To Action Executor

Route handlers do not call services directly. They call `request.executeAction(...)`.

Owner:

- `packages/kernel/server/http/lib/requestActionExecutor.js`

Representative route code:

```js
const response = await request.executeAction({
  actionId: actionIds.create,
  input: {
    ...(request.input.body || {})
  }
});
```

The request executor is attached by the HTTP runtime and forwards into the action runtime:

```js
const actionExecutor = resolutionScope.make(normalizedActionExecutorToken);

return actionExecutor.execute({
  actionId: source.actionId,
  version: source.version == null ? null : source.version,
  input: normalizedInput,
  context: executionContext,
  deps: normalizedDeps
});
```

So the route layer hands off:

- normalized route input
- execution context
- optional dependency overrides

to the action runtime.

## 8. Shared Schema Execution

The central runtime entrypoint is `validateSchemaPayload(...)`.

Owner:

- `packages/kernel/shared/validators/schemaPayloadValidation.js`

Important code:

```js
const result = executeJsonRestSchemaDefinition(schemaDefinition, payload, {
  defaultMode: phase === "output" ? "replace" : "patch",
  context
});

const fieldErrors = normalizeJsonRestSchemaFieldErrors(result?.errors, schemaDefinition);
if (Object.keys(fieldErrors).length > 0) {
  throw buildSchemaValidationError({
    fieldErrors,
    statusCode
  });
}

return result?.validatedObject ?? payload;
```

This is the core runtime rule:

1. execute the schema definition
2. map schema errors into field errors
3. throw if invalid
4. return normalized `validatedObject`

## 9. Action Input Contracts

CRUD actions build their input contract from the same shared schemas.

Representative file:

- `packages/crud-server-generator/templates/src/local-package/server/actions.js`

Important code:

```js
const createActionInputValidator = composeSchemaDefinitions([
  resource.operations.create.body,
], {
  mode: "create"
});

const updateActionInputValidator = composeSchemaDefinitions([
  recordIdParamsValidator,
  resource.operations.patch.body,
], {
  mode: "patch"
});
```

And the action definition uses them directly:

```js
{
  id: actionIds.create,
  kind: "command",
  input: createActionInputValidator,
  output: resource.operations.create.output,
  async execute(input, context, deps) {
    return deps.customersService.createRecord(input, {
      context,
      visibilityContext: context?.visibilityContext
    });
  }
}
```

So actions do not invent new schemas. They compose existing ones.

## 10. Action Definition Normalization

Action definitions are normalized up front when registered.

Owner:

- `packages/kernel/shared/actions/actionDefinitions.js`

Important code:

```js
return Object.freeze({
  id,
  version,
  domain,
  kind,
  channels,
  surfaces,
  input: normalizeActionInputDefinition(source.input, "input", {
    required: true
  }),
  output: normalizeActionOutputDefinition(source.output, "output", {
    required: false
  }),
  ...
});
```

So an action’s `input` and `output` must already be valid schema definition objects before the runtime starts using them.

## 11. Action Runtime Validation

Action execution validates input before `execute()`, and validates output after `execute()`.

Owner:

- `packages/kernel/shared/actions/policies.js`
- `packages/kernel/shared/actions/pipeline.js`

Important input validation:

```js
return validateSchemaPayload(definition?.input, input, {
  phase: "input",
  definition,
  context
});
```

Important output validation:

```js
return validateSchemaPayload(definition.output, output, {
  phase: "output",
  definition,
  context
});
```

And in the action pipeline:

```js
const normalizedInput = await normalizeActionInput(definition, input, normalizedContext);
const executionResult = await definition.execute(normalizedInput, normalizedContext, deps);
const normalizedResult = await normalizeActionOutput(definition, executionResult, normalizedContext);
```

So action execution is:

1. validate input
2. run business logic
3. validate output

## 12. Service Layer

The CRUD service layer does not own schema validation. It owns orchestration and field access.

Owner:

- `packages/crud-core/src/server/serviceMethods.js`

Example create flow:

```js
const writablePayload = await runtime.fieldAccessRuntime.enforceWritablePayload(payload, fieldAccess, {
  action: "create",
  payload,
  options,
  context: options?.context
});

const record = await resolvedRepository.create(writablePayload, options);
return runtime.fieldAccessRuntime.filterReadableRecord(record, fieldAccess, {
  action: "create",
  options,
  context: options?.context
});
```

So the service layer does:

- field access enforcement
- orchestration
- repository calls
- record-not-found handling

It does **not** define the CRUD schema.

## 13. Repository Runtime Compilation

The generated repository delegates into `createCrudResourceRuntime(resource, knex, ...)`.

Owner:

- `packages/crud-server-generator/templates/src/local-package/server/repository.js`
- `packages/crud-core/src/server/resourceRuntime/index.js`

Generated repository:

```js
const resourceRuntime = createCrudResourceRuntime(resource, knex, {
  ...options,
  ...REPOSITORY_CONFIG
});
```

The compiled runtime pulls the same shared schemas out of the resource:

```js
return Object.freeze({
  input: Object.freeze({
    create: resolveOperationBodyValidator(resource, "create", { context }),
    patch: resolveOperationBodyValidator(resource, "patch", { context })
  }),
  output,
  mapping: repositoryMapping,
  ...
});
```

## 14. Repository Mapping Derived From Shared Contract

The repository runtime derives DB mapping from the same shared resource contract. That includes:

- the output/create/patch schema definitions
- field metadata embedded in those definitions, such as:
  - `actualField`
  - `storage`
  - `relation`
  - `ui`

Owner:

- `packages/crud-core/src/server/repositorySupport.js`
- `packages/kernel/shared/support/crudFieldContract.js`

Important code:

```js
const outputSchema = resolveStructuredSchemaTransportSchema(operations?.view?.output, {
  context: `${context} operations.view.output`,
  defaultMode: "replace"
});
const writeSchema = resolveStructuredSchemaTransportSchema(operations?.create?.body, {
  context: `${context} operations.create.body`,
  defaultMode: "create"
});
const patchSchema = resolveStructuredSchemaTransportSchema(operations?.patch?.body, {
  context: `${context} operations.patch.body`,
  defaultMode: "patch"
});
```

And field contract metadata is extracted from the same shared definitions:

```js
const sections = [
  resolveCrudFieldSchemaProperties(resource?.operations?.view?.output, ...),
  resolveCrudFieldSchemaProperties(resource?.operations?.create?.body, ...),
  resolveCrudFieldSchemaProperties(resource?.operations?.patch?.body, ...)
];

const storage = normalizeCrudFieldStorageConfig(definition, ...);

entries[key] = mergeFieldContractEntry(entries[key], {
  actualField: normalizeText(definition.actualField),
  parentRouteParamKey,
  storage,
  relation,
  ui
}, ...);
```

From the shared contract it derives:

- output keys
- write keys
- list search columns
- parent filter columns
- record-id fields
- datetime serializer hints

So the repository does not need a second field registry, but it is not driven by schema shape alone. It also reads contract metadata carried on the shared field definitions.

## 15. Repository Input Validation

Create and patch payloads are validated again at the repository boundary.

Owner:

- `packages/crud-core/src/server/resourceRuntime/index.js`

Important code:

```js
const nextPayload = validateSchemaPayload(input, normalizedPayload, {
  phase: "input",
  context: `${runtime?.context || "crudRepository"} operations.${operationKey}.body`
});
```

This happens inside:

```js
let sourcePayload = await normalizeRepositoryInputPayload(runtime, payload, {
  operationKey: "create"
});
```

Then the normalized API payload is converted into a DB payload:

```js
let insertPayload = buildWritePayload(
  sourcePayload,
  runtime.mapping.writeKeys,
  runtime.mapping.columnOverrides,
  {
    serializerByKey: runtime.mapping.writeSerializerByKey
  }
);
```

The same pattern is used for patch:

```js
let sourcePatch = await normalizeRepositoryInputPayload(runtime, patch, {
  operationKey: "patch"
});

const dbPatch = buildWritePayload(
  sourcePatch,
  runtime.mapping.writeKeys,
  runtime.mapping.columnOverrides,
  {
    serializerByKey: runtime.mapping.writeSerializerByKey
  }
);
```

So repository writes are protected by the same schemas even if the repository is called outside the HTTP/action path.

## 16. Repository Output Validation

After reading DB rows, the repository maps columns back to API fields and validates the result against the shared output schema.

Important code:

```js
const mappedRecord = mapRecordRow(
  row,
  runtime.mapping.outputKeys,
  runtime.mapping.columnOverrides,
  { recordIdKeys: runtime.mapping.outputRecordIdKeys }
);
```

Then:

```js
return validateSchemaPayload(runtime.output, record, {
  phase: "output",
  context: `${runtime?.context || "crudRepository"} operations.view.output`
});
```

This happens for:

- list
- findById
- listByIds

So the repository validates what it reads back out of storage before returning it upward.

## 17. Full `POST /resource` Flow

Create flow, end to end:

1. Shared resource defines:
   - `resource.operations.create.body`
   - `resource.operations.create.output`

2. Route registers:

```js
body: resource.operations.create.body
responses: { 201: resource.operations.create.output }
```

3. Route validator compiles:
   - Fastify transport schema from the same schema definition
   - runtime `request.input.body` transform from the same schema definition

4. Route handler calls:

```js
request.executeAction({
  actionId: actionIds.create,
  input: {
    ...(request.input.body || {})
  }
})
```

5. Action pipeline validates input against the action input contract.

6. Service enforces field access and calls repository.

7. Repository validates the payload again against `resource.operations.create.body`.

8. Repository maps API keys to DB columns and inserts the row.

9. Repository reloads the row and validates it against `resource.operations.view.output`.

10. Action pipeline validates the returned result against `resource.operations.create.output`.

11. Route sends the response, and the response transport schema is also derived from that same output contract.

## 18. Full `PATCH /resource/:recordId` Flow

Patch flow is the same structure, with one extra piece: params are merged with body for the action input.

1. Route validates:
   - `params`
   - `body`

2. Route handler builds action input:

```js
input: {
  recordId: request.input.params.recordId,
  ...(request.input.body || {})
}
```

3. Action input is validated against:

```js
composeSchemaDefinitions([
  recordIdParamsValidator,
  resource.operations.patch.body,
], {
  mode: "patch"
})
```

4. Repository validates patch payload again against `resource.operations.patch.body`

5. Repository updates row and reloads normalized output

6. Action output is validated against `resource.operations.patch.output`

## 19. Full `GET /resource` List Flow

List flow is query-shaped rather than body-shaped.

1. Route query schema is composed from:
   - cursor pagination
   - text search
   - parent filters
   - include lookup options

2. Route validates and normalizes `request.input.query`

3. Action validates list input again through the same composed schema definition

4. Repository applies:
   - generic list search/cursor filters
   - parent filters
   - optional configured query stages

5. Repository maps each row to API fields

6. Repository validates each mapped record against the record output schema

7. Repository hydrates lookups

8. Action validates final `{ items, nextCursor }` against `resource.operations.list.output`

## 20. Important Boundary Summary

### Shared resource owns

- canonical CRUD input/output schemas
- lookup contract metadata
- transport-visible field contract

### Route layer owns

- Fastify transport schema generation
- request section validation at the HTTP boundary
- construction of `request.input`
- dispatch into `request.executeAction(...)`

### Action layer owns

- validation of action input/output
- permissions, channels, surfaces
- execution orchestration

### Service layer owns

- business orchestration
- field access rules
- repository invocation

### Repository layer owns

- DB column mapping derived from shared contract
- validation before writes
- validation after reads
- list filtering/query application

## 21. Current Exception

The one notable exception to the neat schema-first flow is CRUD list filters.

Owner:

- `packages/crud-core/src/server/listFilters.js`

At route/action boundaries, structured filter params should now still be authored explicitly:

```js
const listRouteQueryValidator = {
  schema: createCrudListFilterQuerySchema({
    status: createCrudListFilterQueryField(CONTACTS_LIST_FILTER_DEFINITIONS.status, {
      invalidValues: "reject"
    }),
    arrivalDate: createCrudListFilterQueryField(CONTACTS_LIST_FILTER_DEFINITIONS.arrivalDate, {
      invalidValues: "reject"
    })
  }),
  mode: "patch"
};
```

The custom schema type does own parsing of each filter field:

```js
const parsedValue = parseCrudListFilterQueryValue(filter, context.value, {
  invalidValues
});

return parsedValue;
```

But the server runtime still reprojects those parsed query-field values through filter keys and repository semantics:

```js
function parseFilterPayload(payload = {}) {
  const result = discardValidator.schema.patch(normalizeObjectInput(payload));
  return projectNormalizedFilterValues(filterEntries, result.validatedObject, result.errors);
}

function applyQuery(queryBuilder, payload = {}) {
  const normalized = parseFilterPayload(payload);
  ...
}
```

So list filters are still the main place where:

- schema validation
- repository-facing semantic normalization / query application

are split instead of being fully unified in one schema pass.

That split is intentional for now:

- route/action query params stay explicit in app code
- shared filter definitions still own filter metadata and parsing rules
- repository runtime still owns the last step that maps parsed filter values to filter keys and SQL semantics

## 22. Bottom Line

For normal CRUD create/view/update/delete and cursor-list flows, the architecture is now:

- one shared CRUD contract
- reused by routes
- reused by actions
- reused by repository runtime

The same schemas are used for:

- HTTP input validation
- action input validation
- repository input validation
- repository output validation
- action output validation
- Fastify transport schema generation

That is the current schema flow the CRUD stack is built around.
