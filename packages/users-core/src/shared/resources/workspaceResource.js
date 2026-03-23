import { Type } from "typebox";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";

function normalizeWorkspaceAvatarUrl(value) {
  const avatarUrl = normalizeText(value);
  if (!avatarUrl) {
    return "";
  }
  if (!avatarUrl.startsWith("http://") && !avatarUrl.startsWith("https://")) {
    return null;
  }
  try {
    return new URL(avatarUrl).toString();
  } catch {
    return null;
  }
}

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
    normalized.avatarUrl = normalizeWorkspaceAvatarUrl(source.avatarUrl);
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
    avatarUrl: normalizeText(source.avatarUrl)
  };
}

function normalizeWorkspaceListItemOutput(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: Number(source.id),
    slug: normalizeLowerText(source.slug),
    name: normalizeText(source.name),
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
    avatarUrl: Type.String()
  },
  { additionalProperties: false }
);

const listItemSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    avatarUrl: Type.String(),
    roleId: Type.String({ minLength: 1 }),
    isAccessible: Type.Boolean()
  },
  { additionalProperties: false }
);

const createRequestBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    slug: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
  },
  { additionalProperties: false }
);

const patchRequestBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    avatarUrl: Type.Optional(
      Type.String({
        pattern: "^(https?://.+)?$",
        messages: {
          pattern: "Workspace avatar URL must be a valid absolute URL (http:// or https://).",
          default: "Workspace avatar URL must be a valid absolute URL (http:// or https://)."
        }
      })
    )
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
      outputValidator: responseRecordValidator
    },
    list: {
      method: "GET",
      outputValidator: createCursorListValidator(workspaceSummaryOutputValidator)
    },
    create: {
      method: "POST",
      bodyValidator: {
        schema: createRequestBodySchema,
        normalize: normalizeWorkspaceInput
      },
      outputValidator: responseRecordValidator
    },
    replace: {
      method: "PUT",
      bodyValidator: {
        schema: createRequestBodySchema,
        normalize: normalizeWorkspaceInput
      },
      outputValidator: responseRecordValidator
    },
    patch: {
      method: "PATCH",
      bodyValidator: {
        schema: patchRequestBodySchema,
        normalize: normalizeWorkspaceInput
      },
      outputValidator: responseRecordValidator
    }
  }
};

export { resource as workspaceResource };
