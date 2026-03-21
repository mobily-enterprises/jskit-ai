import { Type } from "typebox";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeNumberField(value, { fieldLabel = "Number field" } = {}) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new TypeError(`${fieldLabel} must be a valid number.`);
  }

  return normalized;
}

function normalizeDateTimeField(value, { fieldLabel = "Date field" } = {}) {
  try {
    return toIsoString(value);
  } catch {
    throw new TypeError(`${fieldLabel} must be a valid date/time.`);
  }
}

function normalizeRecordInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "textField")) {
    normalized.textField = normalizeText(source.textField);
  }

  if (Object.hasOwn(source, "dateField")) {
    normalized.dateField = normalizeDateTimeField(source.dateField, {
      fieldLabel: "Date field"
    });
  }

  if (Object.hasOwn(source, "numberField")) {
    normalized.numberField = normalizeNumberField(source.numberField, {
      fieldLabel: "Number field"
    });
  }

  return normalized;
}

function normalizeRecordOutput(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: Number(source.id),
    textField: normalizeText(source.textField),
    dateField: normalizeDateTimeField(source.dateField, {
      fieldLabel: "Date field"
    }),
    numberField: normalizeNumberField(source.numberField, {
      fieldLabel: "Number field"
    }),
    createdAt: normalizeDateTimeField(source.createdAt, {
      fieldLabel: "Created at"
    }),
    updatedAt: normalizeDateTimeField(source.updatedAt, {
      fieldLabel: "Updated at"
    })
  };
}

const recordOutputSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    textField: Type.String({ minLength: 1, maxLength: 160 }),
    dateField: Type.String({ minLength: 1 }),
    numberField: Type.Number(),
    createdAt: Type.String({ minLength: 1 }),
    updatedAt: Type.String({ minLength: 1 })
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

const recordOutputValidator = Object.freeze({
  schema: recordOutputSchema,
  normalize: normalizeRecordOutput
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
      outputValidator: createCursorListValidator(recordOutputValidator)
    },
    view: {
      method: "GET",
      outputValidator: recordOutputValidator
    },
    create: {
      method: "POST",
      bodyValidator: {
        schema: recordBodySchema,
        normalize: normalizeRecordInput
      },
      outputValidator: recordOutputValidator
    },
    patch: {
      method: "PATCH",
      bodyValidator: {
        schema: Type.Partial(recordBodySchema, { additionalProperties: false }),
        normalize: normalizeRecordInput
      },
      outputValidator: recordOutputValidator
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
