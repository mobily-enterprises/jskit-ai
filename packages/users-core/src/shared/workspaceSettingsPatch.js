import { Type } from "typebox";
import { Check, Errors } from "typebox/value";

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
const workspaceSettingsPatchSchema = Type.Partial(workspaceSettingsCreateSchema, { additionalProperties: false });

const SCHEMA_FIELD_MESSAGES = Object.freeze({
  name: {
    required: "Workspace name is required.",
    default: "Workspace name is required.",
    maxLength: "Workspace name must be at most 160 characters."
  },
  avatarUrl: {
    default: "Workspace avatar URL must be a valid absolute URL (http:// or https://)."
  },
  color: {
    required: "Workspace color is required.",
    default: "Workspace color must be a hex color like #0F6B54."
  },
  invitesEnabled: {
    required: "invitesEnabled is required.",
    default: "invitesEnabled must be a boolean."
  },
  appDenyEmails: {
    default: "appDenyEmails must be an array of valid email addresses."
  },
  appDenyUserIds: {
    default: "appDenyUserIds must be an array of positive integers."
  }
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

function normalizeWorkspaceSettingsPatchInput(payload = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
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

function resolveTopLevelField(issue = {}) {
  const instancePath = normalizeText(issue.instancePath || issue.path);
  if (instancePath) {
    const segments = instancePath
      .replace(/^\//, "")
      .split("/")
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
    if (segments.length > 0) {
      return segments[0];
    }
  }

  const missingProperty = normalizeText(issue?.params?.missingProperty);
  if (missingProperty) {
    return missingProperty;
  }

  const requiredProperties = Array.isArray(issue?.params?.requiredProperties)
    ? issue.params.requiredProperties
    : [];
  if (requiredProperties.length > 0) {
    return normalizeText(requiredProperties[0]);
  }

  const additionalProperty = normalizeText(issue?.params?.additionalProperty);
  if (additionalProperty) {
    return additionalProperty;
  }

  return "";
}

function resolveMissingRequiredFields(issue = {}) {
  const requiredProperties = Array.isArray(issue?.params?.requiredProperties)
    ? issue.params.requiredProperties
    : [];

  return requiredProperties
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function resolveSchemaFieldMessage(field, issue = {}) {
  const fieldMessages = SCHEMA_FIELD_MESSAGES[field];
  if (!fieldMessages) {
    return "Invalid value.";
  }

  const keyword = normalizeText(issue.keyword);
  if (keyword === "required" && fieldMessages.required) {
    return fieldMessages.required;
  }
  if (keyword === "maxLength" && fieldMessages.maxLength) {
    return fieldMessages.maxLength;
  }

  return fieldMessages.default || "Invalid value.";
}

function collectSchemaFieldErrors(value, schema) {
  if (Check(schema, value)) {
    return {};
  }

  const issues = [...Errors(schema, value)];
  const fieldErrors = {};

  for (const issue of issues) {
    const missingRequiredFields = resolveMissingRequiredFields(issue);
    if (missingRequiredFields.length > 0) {
      for (const field of missingRequiredFields) {
        if (Object.hasOwn(fieldErrors, field)) {
          continue;
        }
        fieldErrors[field] = resolveSchemaFieldMessage(field, issue);
      }
      continue;
    }

    const field = resolveTopLevelField(issue);
    if (!field || Object.hasOwn(fieldErrors, field)) {
      continue;
    }
    fieldErrors[field] = resolveSchemaFieldMessage(field, issue);
  }

  return fieldErrors;
}

function parseWorkspaceSettingsInput(payload = {}, schema) {
  const normalizedInput = normalizeWorkspaceSettingsPatchInput(payload);
  const fieldErrors = collectSchemaFieldErrors(normalizedInput, schema);
  const workspacePatch = {};
  const settingsPatch = {};

  if (Object.hasOwn(normalizedInput, "avatarUrl")) {
    const avatarUrl = normalizeWorkspaceAvatarUrl(normalizedInput.avatarUrl);
    if (avatarUrl === null) {
      fieldErrors.avatarUrl = "Workspace avatar URL must be a valid absolute URL (http:// or https://).";
    } else {
      workspacePatch.avatarUrl = avatarUrl;
    }
  }

  if (Object.hasOwn(normalizedInput, "color")) {
    const color = normalizeWorkspaceColor(normalizedInput.color);
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

  if (Object.hasOwn(normalizedInput, "name")) {
    workspacePatch.name = normalizedInput.name;
  }
  if (Object.hasOwn(normalizedInput, "invitesEnabled")) {
    settingsPatch.invitesEnabled = normalizedInput.invitesEnabled;
  }
  if (Object.hasOwn(normalizedInput, "appDenyEmails")) {
    settingsPatch.appDenyEmails = [...normalizedInput.appDenyEmails];
  }
  if (Object.hasOwn(normalizedInput, "appDenyUserIds")) {
    settingsPatch.appDenyUserIds = [...normalizedInput.appDenyUserIds];
  }

  return {
    workspacePatch,
    settingsPatch,
    fieldErrors: {}
  };
}

function parseWorkspaceSettingsCreate(payload = {}) {
  return parseWorkspaceSettingsInput(payload, workspaceSettingsCreateSchema);
}

function parseWorkspaceSettingsReplace(payload = {}) {
  return parseWorkspaceSettingsInput(payload, workspaceSettingsReplaceSchema);
}

function parseWorkspaceSettingsPatch(payload = {}) {
  return parseWorkspaceSettingsInput(payload, workspaceSettingsPatchSchema);
}

export {
  workspaceSettingsCreateSchema,
  workspaceSettingsReplaceSchema,
  workspaceSettingsPatchSchema,
  parseWorkspaceSettingsCreate,
  parseWorkspaceSettingsReplace,
  parseWorkspaceSettingsPatch,
  normalizeWorkspaceAvatarUrl,
  normalizeWorkspaceColor,
  normalizeDenyEmails,
  normalizeDenyUserIds
};
