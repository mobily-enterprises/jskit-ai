import { Type } from "typebox";
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeRecordInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "name")) {
    normalized.name = normalizeText(source.name);
  }

  if (Object.hasOwn(source, "surname")) {
    normalized.surname = normalizeText(source.surname);
  }

  return normalized;
}

function normalizeRecordRecord(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: Number(source.id),
    name: normalizeText(source.name),
    surname: normalizeText(source.surname),
    createdAt: normalizeText(source.createdAt),
    updatedAt: normalizeText(source.updatedAt)
  };
}

const recordRecordSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    surname: Type.String({ minLength: 1, maxLength: 160 }),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const recordBodySchema = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      maxLength: 160,
      messages: {
        required: "Name is required.",
        minLength: "Name is required.",
        maxLength: "Name must be at most 160 characters.",
        default: "Name is required."
      }
    }),
    surname: Type.String({
      minLength: 1,
      maxLength: 160,
      messages: {
        required: "Surname is required.",
        minLength: "Surname is required.",
        maxLength: "Surname must be at most 160 characters.",
        default: "Surname is required."
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

const recordRecordValidator = Object.freeze({
  schema: recordRecordSchema,
  normalize: normalizeRecordRecord
});

const crudResource = {
  resource: "crud",
  messages: {
    validation: "Fix invalid CRUD values and try again.",
    saveSuccess: "Record saved.",
    saveError: "Unable to save record.",
    deleteSuccess: "Record deleted.",
    deleteError: "Unable to delete record."
  },
  operations: {
    list: {
      method: "GET",
      outputValidator: createCursorListValidator(recordRecordValidator)
    },
    view: {
      method: "GET",
      outputValidator: recordRecordValidator
    },
    create: {
      method: "POST",
      bodyValidator: {
        schema: recordBodySchema,
        normalize: normalizeRecordInput
      },
      outputValidator: recordRecordValidator
    },
    patch: {
      method: "PATCH",
      bodyValidator: {
        schema: Type.Partial(recordBodySchema, { additionalProperties: false }),
        normalize: normalizeRecordInput
      },
      outputValidator: recordRecordValidator
    },
    delete: {
      method: "DELETE",
      outputValidator: {
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
      }
    }
  }
};

export { crudResource };
