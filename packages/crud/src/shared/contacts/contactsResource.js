import { Type } from "typebox";
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/contracts";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeContactInput(payload = {}) {
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

function normalizeContactRecord(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: Number(source.id),
    name: normalizeText(source.name),
    surname: normalizeText(source.surname),
    createdAt: normalizeText(source.createdAt),
    updatedAt: normalizeText(source.updatedAt)
  };
}

const contactRecordSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    surname: Type.String({ minLength: 1, maxLength: 160 }),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const contactBodySchema = Type.Object(
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

const contactRecordValidator = Object.freeze({
  schema: contactRecordSchema,
  normalize: normalizeContactRecord
});

const contactsResource = {
  resource: "contacts",
  messages: {
    validation: "Fix invalid contact values and try again.",
    saveSuccess: "Contact saved.",
    saveError: "Unable to save contact.",
    deleteSuccess: "Contact deleted.",
    deleteError: "Unable to delete contact."
  },
  operations: {
    list: {
      method: "GET",
      output: createCursorListValidator(contactRecordValidator)
    },
    view: {
      method: "GET",
      output: contactRecordValidator
    },
    create: {
      method: "POST",
      body: {
        schema: contactBodySchema,
        normalize: normalizeContactInput
      },
      output: contactRecordValidator
    },
    patch: {
      method: "PATCH",
      body: {
        schema: Type.Partial(contactBodySchema, { additionalProperties: false }),
        normalize: normalizeContactInput
      },
      output: contactRecordValidator
    },
    delete: {
      method: "DELETE",
      output: {
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

export { contactsResource };
