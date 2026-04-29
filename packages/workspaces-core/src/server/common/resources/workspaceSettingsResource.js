import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { normalizeWorkspaceHexColor, DEFAULT_WORKSPACE_DARK_PALETTE, DEFAULT_WORKSPACE_LIGHT_PALETTE } from "../../../shared/settings.js";

function serializeNullableDateTime(value) {
  if (value == null) {
    return null;
  }

  return toDatabaseDateTimeUtc(value);
}

function normalizeWorkspaceColorInput(value) {
  return normalizeWorkspaceHexColor(value);
}

const workspaceSettingsResource = Object.freeze({
  tableName: "workspace_settings",
  searchSchema: {
    id: { type: "id", actualField: "id" }
  },
  schema: {
    id: {
      type: "id",
      primary: true,
      required: true,
      search: true,
      storage: { column: "workspace_id" }
    },
    lightPrimaryColor: {
      type: "string",
      required: true,
      minLength: 7,
      maxLength: 7,
      defaultTo: DEFAULT_WORKSPACE_LIGHT_PALETTE.color,
      storage: { column: "light_primary_color" },
      setter: (value) => normalizeWorkspaceColorInput(value)
    },
    lightSecondaryColor: {
      type: "string",
      required: true,
      minLength: 7,
      maxLength: 7,
      defaultTo: DEFAULT_WORKSPACE_LIGHT_PALETTE.secondaryColor,
      storage: { column: "light_secondary_color" },
      setter: (value) => normalizeWorkspaceColorInput(value)
    },
    lightSurfaceColor: {
      type: "string",
      required: true,
      minLength: 7,
      maxLength: 7,
      defaultTo: DEFAULT_WORKSPACE_LIGHT_PALETTE.surfaceColor,
      storage: { column: "light_surface_color" },
      setter: (value) => normalizeWorkspaceColorInput(value)
    },
    lightSurfaceVariantColor: {
      type: "string",
      required: true,
      minLength: 7,
      maxLength: 7,
      defaultTo: DEFAULT_WORKSPACE_LIGHT_PALETTE.surfaceVariantColor,
      storage: { column: "light_surface_variant_color" },
      setter: (value) => normalizeWorkspaceColorInput(value)
    },
    darkPrimaryColor: {
      type: "string",
      required: true,
      minLength: 7,
      maxLength: 7,
      defaultTo: DEFAULT_WORKSPACE_DARK_PALETTE.color,
      storage: { column: "dark_primary_color" },
      setter: (value) => normalizeWorkspaceColorInput(value)
    },
    darkSecondaryColor: {
      type: "string",
      required: true,
      minLength: 7,
      maxLength: 7,
      defaultTo: DEFAULT_WORKSPACE_DARK_PALETTE.secondaryColor,
      storage: { column: "dark_secondary_color" },
      setter: (value) => normalizeWorkspaceColorInput(value)
    },
    darkSurfaceColor: {
      type: "string",
      required: true,
      minLength: 7,
      maxLength: 7,
      defaultTo: DEFAULT_WORKSPACE_DARK_PALETTE.surfaceColor,
      storage: { column: "dark_surface_color" },
      setter: (value) => normalizeWorkspaceColorInput(value)
    },
    darkSurfaceVariantColor: {
      type: "string",
      required: true,
      minLength: 7,
      maxLength: 7,
      defaultTo: DEFAULT_WORKSPACE_DARK_PALETTE.surfaceVariantColor,
      storage: { column: "dark_surface_variant_color" },
      setter: (value) => normalizeWorkspaceColorInput(value)
    },
    invitesEnabled: {
      type: "boolean",
      required: true,
      defaultTo: true,
      storage: { column: "invites_enabled" }
    },
    createdAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "created_at",
        serialize: serializeNullableDateTime
      }
    },
    updatedAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "updated_at",
        serialize: serializeNullableDateTime
      }
    }
  }
});

export { workspaceSettingsResource };
