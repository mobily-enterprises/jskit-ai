import { Type } from "typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  positiveIntegerInputSchema,
  toPositiveInteger
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

function normalizeRouteParams(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = normalizeWorkspaceParams(source);

  if (Object.hasOwn(source, "eventId")) {
    normalized.eventId = toPositiveInteger(source.eventId);
  }

  return normalized;
}

function normalizeWeekQuery(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = {};

  if (Object.hasOwn(source, "weekStart")) {
    normalized.weekStart = normalizeText(source.weekStart);
  }

  if (Object.hasOwn(source, "contactId")) {
    normalized.contactId = toPositiveInteger(source.contactId);
  }

  return normalized;
}

const completeCalendarInputValidators = Object.freeze({
  workspaceParamsValidator: Object.freeze({
    schema: Type.Object(
      {
        workspaceSlug: Type.Optional(workspaceSlugInputSchema)
      },
      { additionalProperties: false }
    ),
    normalize: normalizeWorkspaceParams
  }),
  routeParamsValidator: Object.freeze({
    schema: Type.Object(
      {
        workspaceSlug: Type.Optional(workspaceSlugInputSchema),
        eventId: Type.Optional(positiveIntegerInputSchema)
      },
      { additionalProperties: false }
    ),
    normalize: normalizeRouteParams
  }),
  weekQueryValidator: Object.freeze({
    schema: Type.Object(
      {
        weekStart: Type.Optional(Type.String({ minLength: 1 })),
        contactId: Type.Optional(positiveIntegerInputSchema)
      },
      { additionalProperties: false }
    ),
    normalize: normalizeWeekQuery
  })
});

export { completeCalendarInputValidators };
