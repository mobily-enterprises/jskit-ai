import { Type } from "typebox";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";

function normalizeWorkspaceInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "slug")) {
    normalized.slug = normalizeLowerText(source.slug);
  }
  if (Object.hasOwn(source, "name")) {
    normalized.name = normalizeText(source.name);
  }
  if (Object.hasOwn(source, "ownerUserId")) {
    normalized.ownerUserId = Number(source.ownerUserId);
  }
  if (Object.hasOwn(source, "avatarUrl")) {
    normalized.avatarUrl = normalizeText(source.avatarUrl);
  }
  if (Object.hasOwn(source, "color")) {
    const color = normalizeText(source.color);
    normalized.color = /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : null;
  }
  if (Object.hasOwn(source, "isPersonal")) {
    normalized.isPersonal = source.isPersonal === true;
  }

  return normalized;
}

function normalizeWorkspaceOutput(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: Number(source.id),
    slug: normalizeLowerText(source.slug),
    name: normalizeText(source.name),
    ownerUserId: Number(source.ownerUserId),
    avatarUrl: normalizeText(source.avatarUrl),
    color: normalizeText(source.color).toUpperCase()
  };
}

function normalizeWorkspaceListItemOutput(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: Number(source.id),
    slug: normalizeLowerText(source.slug),
    name: normalizeText(source.name),
    color: normalizeText(source.color).toUpperCase(),
    avatarUrl: normalizeText(source.avatarUrl),
    roleId: normalizeLowerText(source.roleId || "member") || "member",
    isAccessible: source.isAccessible !== false
  };
}

const responseRecordSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    ownerUserId: Type.Integer({ minimum: 1 }),
    avatarUrl: Type.String(),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" })
  },
  { additionalProperties: false }
);

const listItemSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
    avatarUrl: Type.String(),
    roleId: Type.String({ minLength: 1 }),
    isAccessible: Type.Boolean()
  },
  { additionalProperties: false }
);

const createRequestBodySchema = Type.Object(
  {
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    ownerUserId: Type.Integer({ minimum: 1 }),
    avatarUrl: Type.String(),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
    isPersonal: Type.Boolean()
  },
  { additionalProperties: false }
);

const responseRecordValidator = Object.freeze({
  schema: responseRecordSchema,
  normalize: normalizeWorkspaceOutput
});

const workspaceSummaryOutputValidator = Object.freeze({
  schema: listItemSchema,
  normalize: normalizeWorkspaceListItemOutput
});

const resource = {
  resource: "workspace",
  messages: {
    validation: "Fix invalid workspace values and try again.",
    saveSuccess: "Workspace updated.",
    saveError: "Unable to update workspace.",
    apiValidation: "Validation failed."
  },
  operations: {
    view: {
      method: "GET",
      output: responseRecordValidator
    },
    list: {
      method: "GET",
      output: createCursorListValidator(workspaceSummaryOutputValidator)
    },
    create: {
      method: "POST",
      body: {
        schema: createRequestBodySchema,
        normalize: normalizeWorkspaceInput
      },
      output: responseRecordValidator
    },
    replace: {
      method: "PUT",
      body: {
        schema: createRequestBodySchema,
        normalize: normalizeWorkspaceInput
      },
      output: responseRecordValidator
    },
    patch: {
      method: "PATCH",
      body: {
        schema: Type.Partial(createRequestBodySchema, { additionalProperties: false }),
        normalize: normalizeWorkspaceInput
      },
      output: responseRecordValidator
    }
  }
};

export { resource as workspaceResource };
