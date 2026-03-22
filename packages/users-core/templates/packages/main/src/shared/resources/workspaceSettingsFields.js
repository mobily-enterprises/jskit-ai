// @jskit-contract users.settings-fields.workspace.v1
// Append-only settings field registrations for workspace settings.

import { Type } from "typebox";
import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  DEFAULT_WORKSPACE_DARK_PALETTE,
  DEFAULT_WORKSPACE_LIGHT_PALETTE,
  coerceWorkspaceThemeColor
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
  key: "lightPrimaryColor",
  dbColumn: "light_primary_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Light primary color is required.",
      pattern: "Light primary color must be a hex color like #1867C0.",
      default: "Light primary color must be a hex color like #1867C0."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value) => coerceWorkspaceThemeColor(value, DEFAULT_WORKSPACE_LIGHT_PALETTE.color),
  resolveDefault: () => DEFAULT_WORKSPACE_LIGHT_PALETTE.color
});

defineField({
  key: "lightSecondaryColor",
  dbColumn: "light_secondary_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Light secondary color is required.",
      pattern: "Light secondary color must be a hex color like #48A9A6.",
      default: "Light secondary color must be a hex color like #48A9A6."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value) => coerceWorkspaceThemeColor(value, DEFAULT_WORKSPACE_LIGHT_PALETTE.secondaryColor),
  resolveDefault: () => DEFAULT_WORKSPACE_LIGHT_PALETTE.secondaryColor
});

defineField({
  key: "lightSurfaceColor",
  dbColumn: "light_surface_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Light surface color is required.",
      pattern: "Light surface color must be a hex color like #FFFFFF.",
      default: "Light surface color must be a hex color like #FFFFFF."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value) => coerceWorkspaceThemeColor(value, DEFAULT_WORKSPACE_LIGHT_PALETTE.surfaceColor),
  resolveDefault: () => DEFAULT_WORKSPACE_LIGHT_PALETTE.surfaceColor
});

defineField({
  key: "lightSurfaceVariantColor",
  dbColumn: "light_surface_variant_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Light surface variant color is required.",
      pattern: "Light surface variant color must be a hex color like #424242.",
      default: "Light surface variant color must be a hex color like #424242."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value) => coerceWorkspaceThemeColor(value, DEFAULT_WORKSPACE_LIGHT_PALETTE.surfaceVariantColor),
  resolveDefault: () => DEFAULT_WORKSPACE_LIGHT_PALETTE.surfaceVariantColor
});

defineField({
  key: "darkPrimaryColor",
  dbColumn: "dark_primary_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Dark primary color is required.",
      pattern: "Dark primary color must be a hex color like #2196F3.",
      default: "Dark primary color must be a hex color like #2196F3."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value) => coerceWorkspaceThemeColor(value, DEFAULT_WORKSPACE_DARK_PALETTE.color),
  resolveDefault: () => DEFAULT_WORKSPACE_DARK_PALETTE.color
});

defineField({
  key: "darkSecondaryColor",
  dbColumn: "dark_secondary_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Dark secondary color is required.",
      pattern: "Dark secondary color must be a hex color like #54B6B2.",
      default: "Dark secondary color must be a hex color like #54B6B2."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value) => coerceWorkspaceThemeColor(value, DEFAULT_WORKSPACE_DARK_PALETTE.secondaryColor),
  resolveDefault: () => DEFAULT_WORKSPACE_DARK_PALETTE.secondaryColor
});

defineField({
  key: "darkSurfaceColor",
  dbColumn: "dark_surface_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Dark surface color is required.",
      pattern: "Dark surface color must be a hex color like #212121.",
      default: "Dark surface color must be a hex color like #212121."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value) => coerceWorkspaceThemeColor(value, DEFAULT_WORKSPACE_DARK_PALETTE.surfaceColor),
  resolveDefault: () => DEFAULT_WORKSPACE_DARK_PALETTE.surfaceColor
});

defineField({
  key: "darkSurfaceVariantColor",
  dbColumn: "dark_surface_variant_color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Dark surface variant color is required.",
      pattern: "Dark surface variant color must be a hex color like #C8C8C8.",
      default: "Dark surface variant color must be a hex color like #C8C8C8."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value) => coerceWorkspaceThemeColor(value, DEFAULT_WORKSPACE_DARK_PALETTE.surfaceVariantColor),
  resolveDefault: () => DEFAULT_WORKSPACE_DARK_PALETTE.surfaceVariantColor
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
