import { Type } from "typebox";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/contracts/operationValidation";
import {
  buildResourceRequiredMetadata,
  normalizeObjectInput
} from "../contractUtils.js";
import {
  roleCatalogSchema,
  workspaceAdminSummarySchema
} from "./workspaceSchema.js";

const appSurfaceAccessSchema = Type.Object(
  {
    denyEmails: Type.Array(Type.String({ minLength: 1 })),
    denyUserIds: Type.Array(Type.Integer({ minimum: 1 }))
  },
  { additionalProperties: false }
);

const workspaceSettingsValueSchema = Type.Object(
  {
    invitesEnabled: Type.Boolean(),
    invitesAvailable: Type.Boolean(),
    invitesEffective: Type.Boolean(),
    appDenyEmails: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    appDenyUserIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
    appSurfaceAccess: Type.Optional(appSurfaceAccessSchema)
  },
  { additionalProperties: false }
);

const workspaceSettingsRecordSchema = Type.Object(
  {
    workspace: workspaceAdminSummarySchema,
    settings: workspaceSettingsValueSchema,
    roleCatalog: roleCatalogSchema
  },
  { additionalProperties: false }
);

const workspaceSettingsCreateSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    avatarUrl: Type.Optional(Type.String()),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
    invitesEnabled: Type.Boolean(),
    appDenyEmails: Type.Optional(Type.Array(Type.String({ minLength: 1, format: "email" }))),
    appDenyUserIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 })))
  },
  { additionalProperties: false }
);

const workspaceSettingsReplaceSchema = workspaceSettingsCreateSchema;
const workspaceSettingsPatchSchema = Type.Partial(workspaceSettingsCreateSchema, {
  additionalProperties: false
});

const workspaceSettingsListSchema = Type.Object(
  {
    items: Type.Array(workspaceSettingsRecordSchema),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);

const WORKSPACE_SETTINGS_PATCH_MESSAGES = Object.freeze({
  validation: "Fix invalid workspace settings values and try again.",
  saveSuccess: "Workspace settings updated.",
  saveError: "Unable to update workspace settings.",
  apiValidation: "Validation failed.",
  fields: Object.freeze({
    name: Object.freeze({
      required: "Workspace name is required.",
      minLength: "Workspace name is required.",
      maxLength: "Workspace name must be at most 160 characters.",
      default: "Workspace name is required."
    }),
    avatarUrl: Object.freeze({
      default: "Workspace avatar URL must be a valid absolute URL (http:// or https://)."
    }),
    color: Object.freeze({
      required: "Workspace color is required.",
      pattern: "Workspace color must be a hex color like #0F6B54.",
      default: "Workspace color must be a hex color like #0F6B54."
    }),
    invitesEnabled: Object.freeze({
      required: "invitesEnabled is required.",
      default: "invitesEnabled must be a boolean."
    }),
    appDenyEmails: Object.freeze({
      default: "appDenyEmails must be an array of valid email addresses."
    }),
    appDenyUserIds: Object.freeze({
      default: "appDenyUserIds must be an array of positive integers."
    })
  }),
  keywords: Object.freeze({
    additionalProperties: "Unexpected field."
  }),
  default: "Invalid value."
});

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeEmail(value) {
  return normalizeLowerText(value);
}

function normalizeWorkspaceAvatarUrl(value) {
  const trimmed = normalizeText(value);
  if (!trimmed) {
    return "";
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return null;
  }

  return parsedUrl.toString();
}

function normalizeWorkspaceColor(value) {
  const normalized = normalizeText(value);
  if (/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    return normalized.toUpperCase();
  }

  return null;
}

function normalizeDenyEmails(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value.map((entry) => normalizeEmail(entry));
  return Array.from(new Set(normalized));
}

function normalizeDenyUserIds(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value.map((entry) => Number(normalizeText(entry)));
  return Array.from(new Set(normalized));
}

function normalizeWorkspaceSettingsInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "name")) {
    normalized.name = normalizeText(source.name);
  }
  if (Object.hasOwn(source, "avatarUrl")) {
    normalized.avatarUrl = normalizeText(source.avatarUrl);
  }
  if (Object.hasOwn(source, "color")) {
    normalized.color = normalizeText(source.color);
  }
  if (Object.hasOwn(source, "invitesEnabled")) {
    normalized.invitesEnabled = source.invitesEnabled;
  }
  if (Object.hasOwn(source, "appDenyEmails")) {
    normalized.appDenyEmails = normalizeDenyEmails(source.appDenyEmails);
  }
  if (Object.hasOwn(source, "appDenyUserIds")) {
    normalized.appDenyUserIds = normalizeDenyUserIds(source.appDenyUserIds);
  }

  return normalized;
}

const workspaceSettingsSchema = Object.freeze({
  resource: "workspaceSettings",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: WORKSPACE_SETTINGS_PATCH_MESSAGES,
      response: Object.freeze({
        schema: workspaceSettingsRecordSchema
      })
    }),
    list: Object.freeze({
      method: "GET",
      messages: WORKSPACE_SETTINGS_PATCH_MESSAGES,
      response: Object.freeze({
        schema: workspaceSettingsListSchema
      })
    }),
    create: Object.freeze({
      method: "POST",
      body: Object.freeze({
        schema: workspaceSettingsCreateSchema,
        normalize: normalizeWorkspaceSettingsInput,
        messages: WORKSPACE_SETTINGS_PATCH_MESSAGES
      }),
      response: Object.freeze({
        schema: workspaceSettingsRecordSchema
      }),
      messages: WORKSPACE_SETTINGS_PATCH_MESSAGES
    }),
    replace: Object.freeze({
      method: "PUT",
      body: Object.freeze({
        schema: workspaceSettingsReplaceSchema,
        normalize: normalizeWorkspaceSettingsInput,
        messages: WORKSPACE_SETTINGS_PATCH_MESSAGES
      }),
      response: Object.freeze({
        schema: workspaceSettingsRecordSchema
      }),
      messages: WORKSPACE_SETTINGS_PATCH_MESSAGES
    }),
    patch: Object.freeze({
      method: "PATCH",
      body: Object.freeze({
        schema: workspaceSettingsPatchSchema,
        normalize: normalizeWorkspaceSettingsInput,
        messages: WORKSPACE_SETTINGS_PATCH_MESSAGES
      }),
      response: Object.freeze({
        schema: workspaceSettingsRecordSchema
      }),
      messages: WORKSPACE_SETTINGS_PATCH_MESSAGES
    })
  }),
  required: buildResourceRequiredMetadata({
    create: workspaceSettingsCreateSchema,
    replace: workspaceSettingsReplaceSchema,
    patch: workspaceSettingsPatchSchema
  })
});

function parseWorkspaceSettingsOperation(operation, payload = {}) {
  const parsed = validateOperationSection({
    operation,
    section: "body",
    value: payload
  });

  const normalized = normalizeObjectInput(parsed.normalized);
  const fieldErrors = {
    ...(parsed.fieldErrors || {})
  };
  const workspacePatch = {};
  const settingsPatch = {};

  if (Object.hasOwn(normalized, "avatarUrl")) {
    const avatarUrl = normalizeWorkspaceAvatarUrl(normalized.avatarUrl);
    if (avatarUrl === null) {
      fieldErrors.avatarUrl = "Workspace avatar URL must be a valid absolute URL (http:// or https://).";
    } else {
      workspacePatch.avatarUrl = avatarUrl;
    }
  }

  if (Object.hasOwn(normalized, "color")) {
    const color = normalizeWorkspaceColor(normalized.color);
    if (!color) {
      fieldErrors.color = "Workspace color must be a hex color like #0F6B54.";
    } else {
      workspacePatch.color = color;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      workspacePatch: {},
      settingsPatch: {},
      fieldErrors
    };
  }

  if (Object.hasOwn(normalized, "name")) {
    workspacePatch.name = normalized.name;
  }
  if (Object.hasOwn(normalized, "invitesEnabled")) {
    settingsPatch.invitesEnabled = normalized.invitesEnabled;
  }
  if (Object.hasOwn(normalized, "appDenyEmails")) {
    settingsPatch.appDenyEmails = [...normalized.appDenyEmails];
  }
  if (Object.hasOwn(normalized, "appDenyUserIds")) {
    settingsPatch.appDenyUserIds = [...normalized.appDenyUserIds];
  }

  return {
    workspacePatch,
    settingsPatch,
    fieldErrors: {}
  };
}

function parseWorkspaceSettingsCreate(payload = {}) {
  return parseWorkspaceSettingsOperation(workspaceSettingsSchema.operations.create, payload);
}

function parseWorkspaceSettingsReplace(payload = {}) {
  return parseWorkspaceSettingsOperation(workspaceSettingsSchema.operations.replace, payload);
}

function parseWorkspaceSettingsPatch(payload = {}) {
  return parseWorkspaceSettingsOperation(workspaceSettingsSchema.operations.patch, payload);
}

export {
  appSurfaceAccessSchema,
  workspaceSettingsValueSchema,
  workspaceSettingsRecordSchema,
  workspaceSettingsCreateSchema,
  workspaceSettingsReplaceSchema,
  workspaceSettingsPatchSchema,
  workspaceSettingsListSchema,
  WORKSPACE_SETTINGS_PATCH_MESSAGES,
  normalizeWorkspaceAvatarUrl,
  normalizeWorkspaceColor,
  normalizeDenyEmails,
  normalizeDenyUserIds,
  normalizeWorkspaceSettingsInput,
  parseWorkspaceSettingsCreate,
  parseWorkspaceSettingsReplace,
  parseWorkspaceSettingsPatch,
  workspaceSettingsSchema
};
