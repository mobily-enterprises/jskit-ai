import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { workspaceRoleCatalogSchema } from "./workspaceRoleCatalogSchema.js";
import { normalizeWorkspaceHexColor, DEFAULT_WORKSPACE_DARK_PALETTE, DEFAULT_WORKSPACE_LIGHT_PALETTE } from "../settings.js";

const WORKSPACE_SETTINGS_FIELD_KEYS = deepFreeze([
  "lightPrimaryColor",
  "lightSecondaryColor",
  "lightSurfaceColor",
  "lightSurfaceVariantColor",
  "darkPrimaryColor",
  "darkSecondaryColor",
  "darkSurfaceColor",
  "darkSurfaceVariantColor",
  "invitesEnabled"
]);

const workspaceSettingsBodySchema = createSchema({
  lightPrimaryColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Light primary color is required.",
      pattern: "Light primary color must be a hex color like #1867C0.",
      default: "Light primary color must be a hex color like #1867C0."
    }
  },
  lightSecondaryColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Light secondary color is required.",
      pattern: "Light secondary color must be a hex color like #48A9A6.",
      default: "Light secondary color must be a hex color like #48A9A6."
    }
  },
  lightSurfaceColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Light surface color is required.",
      pattern: "Light surface color must be a hex color like #FFFFFF.",
      default: "Light surface color must be a hex color like #FFFFFF."
    }
  },
  lightSurfaceVariantColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Light surface variant color is required.",
      pattern: "Light surface variant color must be a hex color like #424242.",
      default: "Light surface variant color must be a hex color like #424242."
    }
  },
  darkPrimaryColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Dark primary color is required.",
      pattern: "Dark primary color must be a hex color like #2196F3.",
      default: "Dark primary color must be a hex color like #2196F3."
    }
  },
  darkSecondaryColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Dark secondary color is required.",
      pattern: "Dark secondary color must be a hex color like #54B6B2.",
      default: "Dark secondary color must be a hex color like #54B6B2."
    }
  },
  darkSurfaceColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Dark surface color is required.",
      pattern: "Dark surface color must be a hex color like #212121.",
      default: "Dark surface color must be a hex color like #212121."
    }
  },
  darkSurfaceVariantColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: "Dark surface variant color is required.",
      pattern: "Dark surface variant color must be a hex color like #C8C8C8.",
      default: "Dark surface variant color must be a hex color like #C8C8C8."
    }
  },
  invitesEnabled: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      required: "invitesEnabled is required.",
      default: "invitesEnabled must be a boolean."
    }
  }
});

const workspaceSettingsWorkspaceOutputSchema = createSchema({
  id: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN },
  slug: { type: "string", required: true, minLength: 1, maxLength: 120 },
  ownerUserId: { type: "string", required: true, minLength: 1, pattern: RECORD_ID_PATTERN }
});

const workspaceSettingsViewSchema = createSchema({
  lightPrimaryColor: { type: "string", required: true, minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" },
  lightSecondaryColor: { type: "string", required: true, minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" },
  lightSurfaceColor: { type: "string", required: true, minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" },
  lightSurfaceVariantColor: { type: "string", required: true, minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" },
  darkPrimaryColor: { type: "string", required: true, minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" },
  darkSecondaryColor: { type: "string", required: true, minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" },
  darkSurfaceColor: { type: "string", required: true, minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" },
  darkSurfaceVariantColor: { type: "string", required: true, minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" },
  invitesEnabled: { type: "boolean", required: true },
  invitesAvailable: { type: "boolean", required: true },
  invitesEffective: { type: "boolean", required: true }
});

const workspaceSettingsOutputSchema = createSchema({
  workspace: {
    type: "object",
    required: true,
    schema: workspaceSettingsWorkspaceOutputSchema
  },
  settings: {
    type: "object",
    required: true,
    schema: workspaceSettingsViewSchema
  },
  roleCatalog: {
    type: "object",
    required: true,
    schema: workspaceRoleCatalogSchema
  }
});

function normalizeWorkspaceColorInput(value) {
  return normalizeWorkspaceHexColor(value);
}

const workspaceSettingsResource = defineCrudResource({
  namespace: "workspaceSettings",
  tableName: "workspace_settings",
  idProperty: "workspace_id",
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
        writeSerializer: "datetime-utc"
      }
    },
    updatedAt: {
      type: "dateTime",
      default: "now()",
      storage: {
        column: "updated_at",
        writeSerializer: "datetime-utc"
      }
    }
  },
  messages: {
    validation: "Fix invalid workspace settings values and try again.",
    saveSuccess: "Workspace settings updated.",
    saveError: "Unable to update workspace settings.",
    apiValidation: "Validation failed."
  },
  crudOperations: ["view", "list", "create", "replace", "patch"],
  crud: {
    output: workspaceSettingsOutputSchema,
    body: workspaceSettingsBodySchema
  }
});

export {
  WORKSPACE_SETTINGS_FIELD_KEYS,
  workspaceSettingsOutputSchema,
  workspaceSettingsResource
};
