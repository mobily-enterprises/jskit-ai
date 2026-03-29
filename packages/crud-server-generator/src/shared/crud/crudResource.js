import { Type } from "typebox";
import {
  toIsoString,
  toDatabaseDateTimeUtc
} from "@jskit-ai/database-runtime/shared";
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";
import {
  normalizeText,
  normalizeFiniteNumber,
  normalizeIfPresent
} from "@jskit-ai/kernel/shared/support/normalize";

const RESOURCE_LOOKUP_CONTAINER_KEY = "lookups";

const recordOutputSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    textField: Type.String({ minLength: 1, maxLength: 160 }),
    dateField: Type.String({ minLength: 1 }),
    numberField: Type.Number(),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 }),
    [RESOURCE_LOOKUP_CONTAINER_KEY]: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
  },
  { additionalProperties: false }
);

const recordBodySchema = Type.Object(
  {
    textField: Type.String({
      minLength: 1,
      maxLength: 160,
      messages: {
        required: "Text field is required.",
        minLength: "Text field is required.",
        maxLength: "Text field must be at most 160 characters.",
        default: "Text field is required."
      }
    }),
    dateField: Type.String({
      minLength: 1,
      messages: {
        required: "Date field is required.",
        minLength: "Date field is required.",
        default: "Date field is required."
      }
    }),
    numberField: Type.Number({
      messages: {
        required: "Number field is required.",
        default: "Number field must be a valid number."
      }
    })
  },
  {
    additionalProperties: false,
    messages: {
      additionalProperties: "Unexpected field.",
      default: "Invalid value."
    }
  }
);

const patchBodySchema = Type.Partial(recordBodySchema, { additionalProperties: false });

const recordOutputValidator = Object.freeze({
  schema: recordOutputSchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const normalized = {
      id: Number(source.id),
      textField: normalizeText(source.textField),
      dateField: toIsoString(source.dateField),
      numberField: normalizeFiniteNumber(source.numberField),
      createdAt: normalizeIfPresent(source.createdAt, toIsoString),
      updatedAt: normalizeIfPresent(source.updatedAt, toIsoString)
    };
    const sourceLookupContainer = source[RESOURCE_LOOKUP_CONTAINER_KEY];
    if (sourceLookupContainer && typeof sourceLookupContainer === "object" && !Array.isArray(sourceLookupContainer)) {
      normalized[RESOURCE_LOOKUP_CONTAINER_KEY] = sourceLookupContainer;
    }

    return normalized;
  }
});

const listOutputValidator = createCursorListValidator(recordOutputValidator);

const createBodyValidator = Object.freeze({
  schema: recordBodySchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const normalized = {};

    if (Object.hasOwn(source, "textField")) {
      normalized.textField = normalizeText(source.textField);
    }
    if (Object.hasOwn(source, "dateField")) {
      normalized.dateField = toDatabaseDateTimeUtc(source.dateField);
    }
    if (Object.hasOwn(source, "numberField")) {
      normalized.numberField = normalizeFiniteNumber(source.numberField);
    }

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

const CRUD_RESOURCE_FIELD_META = [];

const crudResource = {
  resource: "crud",
  tableName: "crud",
  idColumn: "id",
  messages: {
    validation: "Fix invalid CRUD values and try again.",
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
  fieldMeta: CRUD_RESOURCE_FIELD_META
};

void CRUD_RESOURCE_FIELD_META;

export { crudResource };
