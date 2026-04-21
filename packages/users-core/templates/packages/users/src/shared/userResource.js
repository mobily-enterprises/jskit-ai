import { Type } from "typebox";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import {
  createCursorListValidator,
  normalizeObjectInput,
  recordIdSchema
} from "@jskit-ai/kernel/shared/validators";
import {
  normalizeIfPresent,
  normalizeRecordId,
  normalizeText
} from "@jskit-ai/kernel/shared/support/normalize";

const recordOutputSchema = Type.Object(
  {
    id: recordIdSchema,
    name: Type.String({ minLength: 1 }),
    email: Type.String(),
    username: Type.String(),
    createdAt: Type.String({ format: "date-time", minLength: 1 })
  },
  { additionalProperties: false }
);

const createBodySchema = Type.Object({}, { additionalProperties: false });

const recordOutputValidator = Object.freeze({
  schema: recordOutputSchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      id: normalizeIfPresent(source.id, normalizeRecordId),
      name: normalizeText(source.name || source.email || source.username || source.id),
      email: normalizeText(source.email),
      username: normalizeText(source.username),
      createdAt: normalizeIfPresent(source.createdAt, toIsoString)
    };
  }
});

const createBodyValidator = Object.freeze({
  schema: createBodySchema,
  normalize: normalizeObjectInput
});

const resource = Object.freeze({
  namespace: "users",
  tableName: "users",
  idColumn: "id",
  operations: Object.freeze({
    list: Object.freeze({
      method: "GET",
      outputValidator: createCursorListValidator(recordOutputValidator)
    }),
    view: Object.freeze({
      method: "GET",
      outputValidator: recordOutputValidator
    }),
    create: Object.freeze({
      method: "POST",
      bodyValidator: createBodyValidator,
      outputValidator: recordOutputValidator
    })
  }),
  fieldMeta: Object.freeze([
    Object.freeze({
      key: "name",
      repository: { column: "display_name" }
    })
  ])
});

export { resource };
