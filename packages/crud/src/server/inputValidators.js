import { Type } from "typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  positiveIntegerValidator,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/contracts/recordIdParamsValidator";

const workspaceSlugInputSchema = Type.String({ minLength: 1, maxLength: 120 });

function normalizeWorkspaceSlug(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeWorkspaceParams(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = {};

  if (Object.hasOwn(source, "workspaceSlug")) {
    normalized.workspaceSlug = normalizeWorkspaceSlug(source.workspaceSlug);
  }

  return normalized;
}

function normalizeListQuery(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = {};

  if (Object.hasOwn(source, "cursor")) {
    normalized.cursor = positiveIntegerValidator.normalize(source.cursor);
  }

  if (Object.hasOwn(source, "limit")) {
    normalized.limit = positiveIntegerValidator.normalize(source.limit);
  }

  return normalized;
}

const inputValidators = Object.freeze({
  workspaceParamsValidator: Object.freeze({
    schema: Type.Object(
      {
        workspaceSlug: Type.Optional(workspaceSlugInputSchema)
      },
      { additionalProperties: false }
    ),
    normalize: normalizeWorkspaceParams
  }),
  recordIdParamsValidator,
  listQueryValidator: Object.freeze({
    schema: Type.Object(
      {
        cursor: Type.Optional(positiveIntegerValidator.schema),
        limit: Type.Optional(positiveIntegerValidator.schema)
      },
      { additionalProperties: false }
    ),
    normalize: normalizeListQuery
  })
});

export { inputValidators };
