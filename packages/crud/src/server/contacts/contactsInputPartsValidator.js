import { Type } from "typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const positiveIntegerInputSchema = Type.Union([
  Type.Integer({ minimum: 1 }),
  Type.String({ minLength: 1, pattern: "^[1-9][0-9]*$" })
]);

function toPositiveInteger(value) {
  const normalized = normalizeText(value);
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeRouteParams(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = {};

  if (Object.hasOwn(source, "contactId")) {
    normalized.contactId = toPositiveInteger(source.contactId);
  }

  return normalized;
}

function normalizeListQuery(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = {};

  if (Object.hasOwn(source, "cursor")) {
    normalized.cursor = toPositiveInteger(source.cursor);
  }

  if (Object.hasOwn(source, "limit")) {
    normalized.limit = toPositiveInteger(source.limit);
  }

  return normalized;
}

const contactsInputPartsValidator = Object.freeze({
  routeParams: Object.freeze({
    schema: Type.Object(
      {
        contactId: Type.Optional(positiveIntegerInputSchema)
      },
      { additionalProperties: false }
    ),
    normalize: normalizeRouteParams
  }),
  listQuery: Object.freeze({
    schema: Type.Object(
      {
        cursor: Type.Optional(positiveIntegerInputSchema),
        limit: Type.Optional(positiveIntegerInputSchema)
      },
      { additionalProperties: false }
    ),
    normalize: normalizeListQuery
  })
});

export { contactsInputPartsValidator };
