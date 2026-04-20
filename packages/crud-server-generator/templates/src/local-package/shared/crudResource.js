import { Type } from "typebox";
__JSKIT_CRUD_RESOURCE_DATABASE_RUNTIME_IMPORT__
__JSKIT_CRUD_RESOURCE_VALIDATORS_IMPORT__
__JSKIT_CRUD_RESOURCE_NORMALIZE_SUPPORT_IMPORT__
__JSKIT_CRUD_RESOURCE_JSON_IMPORT__

const RESOURCE_LOOKUP_CONTAINER_KEY = "lookups";

const recordOutputSchema = Type.Object(
  {
__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__
    [RESOURCE_LOOKUP_CONTAINER_KEY]: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  { additionalProperties: false }
);

const createBodySchema = Type.Object(
  {
__JSKIT_CRUD_RESOURCE_CREATE_SCHEMA_PROPERTIES__
  },
  {
    additionalProperties: false,
    required: __JSKIT_CRUD_RESOURCE_CREATE_REQUIRED_FIELDS__
  }
);

const patchBodySchema = Type.Partial(createBodySchema, {
  additionalProperties: false
});

const recordOutputValidator = Object.freeze({
  schema: recordOutputSchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const normalized = {
__JSKIT_CRUD_RESOURCE_OUTPUT_NORMALIZATION_LINES__
    };
    if (Object.hasOwn(source, RESOURCE_LOOKUP_CONTAINER_KEY)) {
      normalized[RESOURCE_LOOKUP_CONTAINER_KEY] = source[RESOURCE_LOOKUP_CONTAINER_KEY];
    }

    return normalized;
  }
});

const listOutputValidator = createCursorListValidator(recordOutputValidator);

const createBodyValidator = Object.freeze({
  schema: createBodySchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const normalized = {};

__JSKIT_CRUD_RESOURCE_INPUT_NORMALIZATION_LINES__

    return normalized;
  }
});

const patchBodyValidator = Object.freeze({
  schema: patchBodySchema,
  normalize: createBodyValidator.normalize
});

const deleteOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      id: recordIdSchema,
      deleted: Type.Literal(true)
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      id: normalizeRecordId(source.id, { fallback: "" }),
      deleted: true
    };
  }
});

const RESOURCE_FIELD_META = [];

const resource = {
  namespace: "${option:namespace|snake}",
  tableName: __JSKIT_CRUD_TABLE_NAME__,
  idColumn: __JSKIT_CRUD_ID_COLUMN__,
  messages: {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Record saved.",
    saveError: "Unable to save record.",
    deleteSuccess: "Record deleted.",
    deleteError: "Unable to delete record."
  },
  contract: {
    lookup: {
      containerKey: RESOURCE_LOOKUP_CONTAINER_KEY,
      defaultInclude: "*", // Set "none" to disable lookup hydration unless include=... is passed.
      maxDepth: 3 // Lower this to limit nested lookup hydration depth.
    }
  },
  operations: {
    list: {
      realtime: {
        events: ["${option:namespace|snake}.record.changed"] // Add more events e.g. for lookup records
      },
      method: "GET",
      outputValidator: listOutputValidator
    },
    view: {
      method: "GET",
      outputValidator: recordOutputValidator
    },
    create: {
      method: "POST",
      bodyValidator: createBodyValidator,
      outputValidator: recordOutputValidator
    },
    patch: {
      method: "PATCH",
      bodyValidator: patchBodyValidator,
      outputValidator: recordOutputValidator
    },
    delete: {
      method: "DELETE",
      outputValidator: deleteOutputValidator
    }
  },
  fieldMeta: RESOURCE_FIELD_META
};

export { resource };

// @jskit-contract crud.resource.field-meta.${option:namespace|snake}.v1
void RESOURCE_FIELD_META;

// Example 1:n collection hydration:
// RESOURCE_FIELD_META.push({
//   key: "pets",
//   relation: {
//     kind: "collection",
//     namespace: "pets",
//     foreignKey: "customerId",
//     parentValueKey: "id",
//     hydrateOnList: false, // list: opt-in with include=pets
//     hydrateOnView: true // view: hydrated by default
//   }
// });
//
// To hydrate child lookups too, request nested include paths:
// - include=pets
// - include=pets,pets.breedId

__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__
