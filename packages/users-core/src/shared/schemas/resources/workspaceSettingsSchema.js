import { Type } from "typebox";
import {
  normalizeText,
  normalizeLowerText
} from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";

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
  if (Object.hasOwn(source, "appDenyEmails")) {
    normalized.appDenyEmails = Array.isArray(source.appDenyEmails)
      ? Array.from(
          new Set(
            source.appDenyEmails
              .map((entry) => normalizeLowerText(entry))
              .filter(Boolean)
          )
        )
      : null;
  }
  if (Object.hasOwn(source, "appDenyUserIds")) {
    normalized.appDenyUserIds = Array.isArray(source.appDenyUserIds)
      ? Array.from(new Set(source.appDenyUserIds.map((entry) => Number(normalizeText(entry)))))
      : null;
  }

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
        invitesEffective: Type.Boolean(),
        appDenyEmails: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
        appDenyUserIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 })))
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
    }),
    appDenyEmails: Type.Optional(
      Type.Array(Type.String({ minLength: 1, format: "email" }), {
        messages: {
          default: "appDenyEmails must be an array of valid email addresses."
        }
      })
    ),
    appDenyUserIds: Type.Optional(
      Type.Array(Type.Integer({ minimum: 1 }), {
        messages: {
          default: "appDenyUserIds must be an array of positive integers."
        }
      })
    )
  },
  {
    additionalProperties: false,
    messages: {
      additionalProperties: "Unexpected field.",
      default: "Invalid value."
    }
  }
);

const schema = {
  resource: "workspaceSettings",
  operationMessages: {
    validation: "Fix invalid workspace settings values and try again.",
    saveSuccess: "Workspace settings updated.",
    saveError: "Unable to update workspace settings.",
    apiValidation: "Validation failed."
  },
  operations: {
    view: {
      method: "GET",
      output: {
        schema: responseRecordSchema
      }
    },
    list: {
      method: "GET",
      output: {
        schema: Type.Object(
          {
            items: Type.Array(responseRecordSchema),
            nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
          },
          { additionalProperties: false }
        )
      }
    },
    create: {
      method: "POST",
      body: {
        schema: createRequestBodySchema,
        normalize: normalizeInput
      },
      output: {
        schema: responseRecordSchema
      }
    },
    replace: {
      method: "PUT",
      body: {
        schema: createRequestBodySchema,
        normalize: normalizeInput
      },
      output: {
        schema: responseRecordSchema
      }
    },
    patch: {
      method: "PATCH",
      body: {
        schema: Type.Partial(createRequestBodySchema, { additionalProperties: false })
      },
      output: {
        schema: responseRecordSchema
      }
    }
  }
};

export { schema as workspaceSettingsSchema };
