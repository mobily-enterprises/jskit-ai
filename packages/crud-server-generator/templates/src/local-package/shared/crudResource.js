import { Type } from "typebox";
__JSKIT_CRUD_RESOURCE_DATABASE_RUNTIME_IMPORT__
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";
__JSKIT_CRUD_RESOURCE_NORMALIZE_SUPPORT_IMPORT__
__JSKIT_CRUD_RESOURCE_JSON_IMPORT__

const recordOutputSchema = Type.Object(
  {
__JSKIT_CRUD_RESOURCE_OUTPUT_SCHEMA_PROPERTIES__
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

    return {
__JSKIT_CRUD_RESOURCE_OUTPUT_NORMALIZATION_LINES__
    };
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
      id: Type.Integer({ minimum: 1 }),
      deleted: Type.Literal(true)
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      id: Number(source.id),
      deleted: true
    };
  }
});

const RESOURCE_FIELD_META = [];

const ${option:namespace|singular|camel}Resource = {
  resource: "${option:namespace|snake}",
  messages: {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Record saved.",
    saveError: "Unable to save record.",
    deleteSuccess: "Record deleted.",
    deleteError: "Unable to delete record."
  },
  operations: {
    list: {
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

export { ${option:namespace|singular|camel}Resource };

// @jskit-contract crud.resource.field-meta.${option:namespace|snake}.v1
void RESOURCE_FIELD_META;

__JSKIT_CRUD_RESOURCE_FIELD_META_PUSH_LINES__
