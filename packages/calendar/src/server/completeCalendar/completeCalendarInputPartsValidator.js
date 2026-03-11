import { Type } from "typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const positiveIntegerInputSchema = Type.Union([
  Type.Integer({ minimum: 1 }),
  Type.String({ minLength: 1, pattern: "^[1-9][0-9]*$" })
]);
const workspaceSlugInputSchema = Type.String({ minLength: 1, maxLength: 120 });

function toPositiveInteger(value) {
  const normalized = normalizeText(value);
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

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

const completeCalendarInputPartsValidator = Object.freeze({
  workspaceParams: Object.freeze({
    schema: Type.Object(
      {
        workspaceSlug: Type.Optional(workspaceSlugInputSchema)
      },
      { additionalProperties: false }
    ),
    normalize: normalizeWorkspaceParams
  }),
  routeParams: Object.freeze({
    schema: Type.Object(
      {
        workspaceSlug: Type.Optional(workspaceSlugInputSchema),
        eventId: Type.Optional(positiveIntegerInputSchema)
      },
      { additionalProperties: false }
    ),
    normalize: normalizeRouteParams
  }),
  weekQuery: Object.freeze({
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

export { completeCalendarInputPartsValidator };
