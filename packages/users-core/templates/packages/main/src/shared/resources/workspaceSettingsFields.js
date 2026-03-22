// @jskit-contract users.settings-fields.workspace.v1
// Append-only settings field registrations for workspace settings.

import { Type } from "typebox";
import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  coerceWorkspaceColor,
  coerceWorkspaceSecondaryColor,
  coerceWorkspaceSurfaceColor,
  coerceWorkspaceSurfaceVariantColor
} from "@jskit-ai/users-core/shared/settings";
import {
  defineField,
  resetWorkspaceSettingsFields
} from "@jskit-ai/users-core/shared/resources/workspaceSettingsFields";

function normalizeAvatarUrl(value) {
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

function normalizeHexColor(value) {
  const color = normalizeText(value);
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : null;
}

function resolveThemeBaseColor({ workspace = {}, settings = {} } = {}) {
  return normalizeText(settings.color || workspace.color);
}

resetWorkspaceSettingsFields();

defineField({
  key: "name",
  dbColumn: "name",
  required: true,
  inputSchema: Type.String({
    minLength: 1,
    maxLength: 160,
    messages: {
      required: "Workspace name is required.",
      minLength: "Workspace name is required.",
      maxLength: "Workspace name must be at most 160 characters.",
      default: "Workspace name is required."
    }
  }),
  outputSchema: Type.String({ minLength: 1, maxLength: 160 }),
  normalizeInput: (value) => normalizeText(value),
  normalizeOutput: (value) => normalizeText(value),
  resolveDefault: ({ workspace = {} } = {}) => normalizeText(workspace.name) || "Workspace"
});

defineField({
  key: "avatarUrl",
  dbColumn: "avatar_url",
  required: false,
  inputSchema: Type.String({
    pattern: "^(https?://.+)?$",
    messages: {
      pattern: "Workspace avatar URL must be a valid absolute URL (http:// or https://).",
      default: "Workspace avatar URL must be a valid absolute URL (http:// or https://)."
    }
  }),
  outputSchema: Type.String(),
  normalizeInput: normalizeAvatarUrl,
  normalizeOutput: (value) => normalizeText(value),
  resolveDefault: ({ workspace = {} } = {}) => normalizeText(workspace.avatarUrl)
});

defineField({
  key: "color",
  dbColumn: "color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Workspace color is required.",
      pattern: "Workspace color must be a hex color like #2F5D9E.",
      default: "Workspace color must be a hex color like #2F5D9E."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value) => coerceWorkspaceColor(value),
  resolveDefault: ({ workspace = {} } = {}) => coerceWorkspaceColor(workspace.color)
});

defineField({
  key: "secondaryColor",
  dbColumn: "secondary_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Secondary color is required.",
      pattern: "Secondary color must be a hex color like #224372.",
      default: "Secondary color must be a hex color like #224372."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value, { workspace = {}, settings = {} } = {}) =>
    coerceWorkspaceSecondaryColor(value, {
      color: resolveThemeBaseColor({ workspace, settings })
    }),
  resolveDefault: ({ workspace = {}, settings = {} } = {}) =>
    coerceWorkspaceSecondaryColor(workspace.secondaryColor, {
      color: resolveThemeBaseColor({ workspace, settings })
    })
});

defineField({
  key: "surfaceColor",
  dbColumn: "surface_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Surface color is required.",
      pattern: "Surface color must be a hex color like #F0F4F8.",
      default: "Surface color must be a hex color like #F0F4F8."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value, { workspace = {}, settings = {} } = {}) =>
    coerceWorkspaceSurfaceColor(value, {
      color: resolveThemeBaseColor({ workspace, settings })
    }),
  resolveDefault: ({ workspace = {}, settings = {} } = {}) =>
    coerceWorkspaceSurfaceColor(workspace.surfaceColor, {
      color: resolveThemeBaseColor({ workspace, settings })
    })
});

defineField({
  key: "surfaceVariantColor",
  dbColumn: "surface_variant_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Surface variant color is required.",
      pattern: "Surface variant color must be a hex color like #E2E8F1.",
      default: "Surface variant color must be a hex color like #E2E8F1."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value, { workspace = {}, settings = {} } = {}) =>
    coerceWorkspaceSurfaceVariantColor(value, {
      color: resolveThemeBaseColor({ workspace, settings })
    }),
  resolveDefault: ({ workspace = {}, settings = {} } = {}) =>
    coerceWorkspaceSurfaceVariantColor(workspace.surfaceVariantColor, {
      color: resolveThemeBaseColor({ workspace, settings })
    })
});

defineField({
  key: "invitesEnabled",
  dbColumn: "invites_enabled",
  required: true,
  inputSchema: Type.Boolean({
    messages: {
      required: "invitesEnabled is required.",
      default: "invitesEnabled must be a boolean."
    }
  }),
  outputSchema: Type.Boolean(),
  normalizeInput: (value) => value === true,
  normalizeOutput: (value) => value !== false,
  resolveDefault: ({ defaultInvitesEnabled } = {}) => defaultInvitesEnabled !== false
});
