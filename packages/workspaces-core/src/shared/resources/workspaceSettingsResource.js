import { createSchema } from "json-rest-schema";
import {
  createCursorListValidator,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { workspaceRoleCatalogSchema } from "./workspaceRoleCatalogSchema.js";

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

const workspaceSettingsOutputValidator = deepFreeze({
  schema: workspaceSettingsOutputSchema,
  mode: "replace"
});

const workspaceSettingsCreateBodyValidator = deepFreeze({
  schema: workspaceSettingsBodySchema,
  mode: "create"
});

const workspaceSettingsReplaceBodyValidator = deepFreeze({
  schema: workspaceSettingsBodySchema,
  mode: "replace"
});

const workspaceSettingsPatchBodyValidator = deepFreeze({
  schema: workspaceSettingsBodySchema,
  mode: "patch"
});

const workspaceSettingsResource = deepFreeze({
  namespace: "workspaceSettings",
  messages: {
    validation: "Fix invalid workspace settings values and try again.",
    saveSuccess: "Workspace settings updated.",
    saveError: "Unable to update workspace settings.",
    apiValidation: "Validation failed."
  },
  operations: {
    view: {
      method: "GET",
      output: workspaceSettingsOutputValidator
    },
    list: {
      method: "GET",
      output: createCursorListValidator(workspaceSettingsOutputValidator)
    },
    create: {
      method: "POST",
      body: workspaceSettingsCreateBodyValidator,
      output: workspaceSettingsOutputValidator
    },
    replace: {
      method: "PUT",
      body: workspaceSettingsReplaceBodyValidator,
      output: workspaceSettingsOutputValidator
    },
    patch: {
      method: "PATCH",
      body: workspaceSettingsPatchBodyValidator,
      output: workspaceSettingsOutputValidator
    }
  }
});

export {
  WORKSPACE_SETTINGS_FIELD_KEYS,
  workspaceSettingsOutputSchema,
  workspaceSettingsResource
};
