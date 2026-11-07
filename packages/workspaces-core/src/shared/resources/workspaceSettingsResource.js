import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { workspaceRoleCatalogSchema } from "./workspaceRoleCatalogSchema.js";
import {
  normalizeWorkspaceHexColor,
  DEFAULT_WORKSPACE_DARK_PALETTE,
  DEFAULT_WORKSPACE_LIGHT_PALETTE,
  WORKSPACE_SETTINGS_COLOR_FIELDS
} from "../settings.js";
import { OPERATION_MESSAGES } from "../operationMessages.js";

// Each field message: its English and the code a client renders it from in the user's language.
const WORKSPACE_SETTINGS_FIELD_MESSAGES = deepFreeze({
  lightPrimaryColorRequired: {
    code: "workspaces.settings.lightPrimaryColor.required",
    message: "Light primary color is required."
  },
  lightPrimaryColorInvalid: {
    code: "workspaces.settings.lightPrimaryColor.invalid",
    message: "Light primary color must be a hex color like #1867C0."
  },
  lightSecondaryColorRequired: {
    code: "workspaces.settings.lightSecondaryColor.required",
    message: "Light secondary color is required."
  },
  lightSecondaryColorInvalid: {
    code: "workspaces.settings.lightSecondaryColor.invalid",
    message: "Light secondary color must be a hex color like #48A9A6."
  },
  lightSurfaceColorRequired: {
    code: "workspaces.settings.lightSurfaceColor.required",
    message: "Light surface color is required."
  },
  lightSurfaceColorInvalid: {
    code: "workspaces.settings.lightSurfaceColor.invalid",
    message: "Light surface color must be a hex color like #FFFFFF."
  },
  lightSurfaceVariantColorRequired: {
    code: "workspaces.settings.lightSurfaceVariantColor.required",
    message: "Light surface variant color is required."
  },
  lightSurfaceVariantColorInvalid: {
    code: "workspaces.settings.lightSurfaceVariantColor.invalid",
    message: "Light surface variant color must be a hex color like #424242."
  },
  darkPrimaryColorRequired: {
    code: "workspaces.settings.darkPrimaryColor.required",
    message: "Dark primary color is required."
  },
  darkPrimaryColorInvalid: {
    code: "workspaces.settings.darkPrimaryColor.invalid",
    message: "Dark primary color must be a hex color like #2196F3."
  },
  darkSecondaryColorRequired: {
    code: "workspaces.settings.darkSecondaryColor.required",
    message: "Dark secondary color is required."
  },
  darkSecondaryColorInvalid: {
    code: "workspaces.settings.darkSecondaryColor.invalid",
    message: "Dark secondary color must be a hex color like #54B6B2."
  },
  darkSurfaceColorRequired: {
    code: "workspaces.settings.darkSurfaceColor.required",
    message: "Dark surface color is required."
  },
  darkSurfaceColorInvalid: {
    code: "workspaces.settings.darkSurfaceColor.invalid",
    message: "Dark surface color must be a hex color like #212121."
  },
  darkSurfaceVariantColorRequired: {
    code: "workspaces.settings.darkSurfaceVariantColor.required",
    message: "Dark surface variant color is required."
  },
  darkSurfaceVariantColorInvalid: {
    code: "workspaces.settings.darkSurfaceVariantColor.invalid",
    message: "Dark surface variant color must be a hex color like #C8C8C8."
  },
  invitesEnabledRequired: {
    code: "workspaces.settings.invitesEnabled.required",
    message: "invitesEnabled is required."
  },
  invitesEnabledInvalid: {
    code: "workspaces.settings.invitesEnabled.invalid",
    message: "invitesEnabled must be a boolean."
  }
});

const WORKSPACE_SETTINGS_FIELD_KEYS = deepFreeze([...WORKSPACE_SETTINGS_COLOR_FIELDS, "invitesEnabled"]);

const workspaceSettingsBodySchema = createSchema({
  lightPrimaryColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightPrimaryColorRequired,
      pattern: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightPrimaryColorInvalid,
      default: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightPrimaryColorInvalid
    }
  },
  lightSecondaryColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightSecondaryColorRequired,
      pattern: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightSecondaryColorInvalid,
      default: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightSecondaryColorInvalid
    }
  },
  lightSurfaceColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightSurfaceColorRequired,
      pattern: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightSurfaceColorInvalid,
      default: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightSurfaceColorInvalid
    }
  },
  lightSurfaceVariantColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightSurfaceVariantColorRequired,
      pattern: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightSurfaceVariantColorInvalid,
      default: WORKSPACE_SETTINGS_FIELD_MESSAGES.lightSurfaceVariantColorInvalid
    }
  },
  darkPrimaryColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkPrimaryColorRequired,
      pattern: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkPrimaryColorInvalid,
      default: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkPrimaryColorInvalid
    }
  },
  darkSecondaryColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkSecondaryColorRequired,
      pattern: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkSecondaryColorInvalid,
      default: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkSecondaryColorInvalid
    }
  },
  darkSurfaceColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkSurfaceColorRequired,
      pattern: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkSurfaceColorInvalid,
      default: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkSurfaceColorInvalid
    }
  },
  darkSurfaceVariantColor: {
    type: "string",
    required: true,
    minLength: 7,
    maxLength: 7,
    pattern: "^#[0-9A-Fa-f]{6}$",
    messages: {
      required: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkSurfaceVariantColorRequired,
      pattern: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkSurfaceVariantColorInvalid,
      default: WORKSPACE_SETTINGS_FIELD_MESSAGES.darkSurfaceVariantColorInvalid
    }
  },
  invitesEnabled: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      required: WORKSPACE_SETTINGS_FIELD_MESSAGES.invitesEnabledRequired,
      default: WORKSPACE_SETTINGS_FIELD_MESSAGES.invitesEnabledInvalid
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

// The workspace_settings table, one row per workspace.
const workspaceSettingsResource = defineTableResource({
  name: "workspaceSettings",
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
  }
});

// A workspace's settings over HTTP.
const workspaceSettingsCrud = defineCrudContract(workspaceSettingsResource, {
  namespace: "workspaceSettings",
  messages: {
    validation: "jskit.workspaces.feedback.settingsInvalid",
    saveSuccess: "jskit.workspaces.feedback.settingsUpdated",
    saveError: "jskit.workspaces.feedback.settingsUpdateFailed",
    apiValidation: OPERATION_MESSAGES.apiValidation
  },
  operations: ["view", "list", "create", "replace", "patch"],
  output: workspaceSettingsOutputSchema,
  body: workspaceSettingsBodySchema
});

export {
  WORKSPACE_SETTINGS_FIELD_KEYS,
  workspaceSettingsCrud,
  workspaceSettingsOutputSchema,
  workspaceSettingsResource
};
