import { Type } from "typebox";
import { normalizeText, normalizeLowerText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";
import { coerceWorkspaceColor } from "../settings.js";

function normalizeInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "name")) {
    normalized.name = normalizeText(source.name);
  }
  if (Object.hasOwn(source, "avatarUrl")) {
    const avatarUrl = normalizeText(source.avatarUrl);
    if (!avatarUrl) {
      normalized.avatarUrl = "";
    } else if (!avatarUrl.startsWith("http://") && !avatarUrl.startsWith("https://")) {
      normalized.avatarUrl = null;
    } else {
      try {
        normalized.avatarUrl = new URL(avatarUrl).toString();
      } catch {
        normalized.avatarUrl = null;
      }
    }
  }
  if (Object.hasOwn(source, "color")) {
    const color = normalizeText(source.color);
    normalized.color = /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : null;
  }
  if (Object.hasOwn(source, "invitesEnabled")) {
    normalized.invitesEnabled = source.invitesEnabled;
  }
  return normalized;
}

function normalizeOutput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const workspace = normalizeObjectInput(source.workspace);
  const settings = normalizeObjectInput(source.settings);
  const invitesEnabled = settings.invitesEnabled !== false;
  const invitesAvailable = settings.invitesAvailable !== false;
  const invitesEffective =
    typeof settings.invitesEffective === "boolean" ? settings.invitesEffective : invitesEnabled;
  const normalized = {
    workspace: {
      id: Number(workspace.id),
      slug: normalizeText(workspace.slug),
      name: normalizeText(workspace.name),
      ownerUserId: Number(workspace.ownerUserId),
      avatarUrl: normalizeText(workspace.avatarUrl),
      color: coerceWorkspaceColor(workspace.color)
    },
    settings: {
      invitesEnabled,
      invitesAvailable,
      invitesEffective
    },
    roleCatalog: source.roleCatalog
  };

  return normalized;
}

const responseRecordSchema = Type.Object(
  {
    workspace: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        slug: Type.String({ minLength: 1 }),
        name: Type.String({ minLength: 1, maxLength: 160 }),
        ownerUserId: Type.Integer({ minimum: 1 }),
        avatarUrl: Type.String(),
        color: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" })
      },
      { additionalProperties: false }
    ),
    settings: Type.Object(
      {
        invitesEnabled: Type.Boolean(),
        invitesAvailable: Type.Boolean(),
        invitesEffective: Type.Boolean()
      },
      { additionalProperties: false }
    ),
    roleCatalog: Type.Object(
      {
        collaborationEnabled: Type.Boolean(),
        defaultInviteRole: Type.String({ minLength: 1 }),
        roles: Type.Array(Type.Object({}, { additionalProperties: true })),
        assignableRoleIds: Type.Array(Type.String({ minLength: 1 }))
      },
      { additionalProperties: true }
    )
  },
  { additionalProperties: false }
);

const responseRecordValidator = Object.freeze({
  schema: responseRecordSchema,
  normalize: normalizeOutput
});

const createRequestBodySchema = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      maxLength: 160,
      messages: {
        required: "Workspace name is required.",
        minLength: "Workspace name is required.",
        maxLength: "Workspace name must be at most 160 characters.",
        default: "Workspace name is required."
      }
    }),
    avatarUrl: Type.Optional(
      Type.String({
        pattern: "^(https?://.+)?$",
        messages: {
          pattern: "Workspace avatar URL must be a valid absolute URL (http:// or https://).",
          default: "Workspace avatar URL must be a valid absolute URL (http:// or https://)."
        }
      })
    ),
    color: Type.String({
      minLength: 7,
      maxLength: 7,
      pattern: "^#[0-9A-Fa-f]{6}$",
      messages: {
        required: "Workspace color is required.",
        pattern: "Workspace color must be a hex color like #0F6B54.",
        default: "Workspace color must be a hex color like #0F6B54."
      }
    }),
    invitesEnabled: Type.Boolean({
      messages: {
        required: "invitesEnabled is required.",
        default: "invitesEnabled must be a boolean."
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

const resource = {
  resource: "workspaceSettings",
  messages: {
    validation: "Fix invalid workspace settings values and try again.",
    saveSuccess: "Workspace settings updated.",
    saveError: "Unable to update workspace settings.",
    apiValidation: "Validation failed."
  },
  operations: {
    view: {
      method: "GET",
      outputValidator: responseRecordValidator
    },
    list: {
      method: "GET",
      outputValidator: createCursorListValidator(responseRecordValidator)
    },
    create: {
      method: "POST",
      bodyValidator: {
        schema: createRequestBodySchema,
        normalize: normalizeInput
      },
      outputValidator: responseRecordValidator
    },
    replace: {
      method: "PUT",
      bodyValidator: {
        schema: createRequestBodySchema,
        normalize: normalizeInput
      },
      outputValidator: responseRecordValidator
    },
    patch: {
      method: "PATCH",
      bodyValidator: {
        schema: Type.Partial(createRequestBodySchema, { additionalProperties: false }),
        normalize: normalizeInput
      },
      outputValidator: responseRecordValidator
    }
  }
};

export { resource as workspaceSettingsResource };
