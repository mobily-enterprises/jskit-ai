import { Type } from "typebox";
import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { coerceWorkspaceColor } from "@jskit-ai/users-core/shared/settings";
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
  key: "color",
  dbColumn: "color",
  required: true,
  inputSchema: Type.String({
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Workspace color is required.",
      pattern: "Workspace color must be a hex color like #0F6B54.",
      default: "Workspace color must be a hex color like #0F6B54."
    }
  }),
  outputSchema: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
  normalizeInput: normalizeHexColor,
  normalizeOutput: (value) => coerceWorkspaceColor(value),
  resolveDefault: ({ workspace = {} } = {}) => coerceWorkspaceColor(workspace.color)
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
