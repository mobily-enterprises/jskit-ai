import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createSchemaDefinition
} from "@jskit-ai/resource-core/shared/resource";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { createOperationMessages } from "../operationMessages.js";
import { DEFAULT_USER_SETTINGS } from "../settings.js";
import {
  accountSecurityStatusSchema,
  userProfileOutputSchema
} from "./accountSettingsSchemas.js";

const USER_SETTINGS_PREFERENCE_KEYS = deepFreeze([
  "theme",
  "locale",
  "timeZone",
  "dateFormat",
  "numberFormat",
  "currencyCode",
  "avatarSize"
]);

const USER_SETTINGS_NOTIFICATION_KEYS = deepFreeze([
  "productUpdates",
  "accountActivity",
  "securityAlerts"
]);

const USER_SETTINGS_ALL_KEYS = deepFreeze([
  ...USER_SETTINGS_PREFERENCE_KEYS,
  ...USER_SETTINGS_NOTIFICATION_KEYS
]);

const USER_SETTINGS_BOOTSTRAP_KEYS = USER_SETTINGS_ALL_KEYS;

function normalizePositiveInteger(value) {
  return Number(value);
}

const userSettingsBodySchema = createSchema({
  theme: { type: "string", required: true, minLength: 1, maxLength: 32 },
  locale: { type: "string", required: true, minLength: 1, maxLength: 24, lowercase: true },
  timeZone: { type: "string", required: true, minLength: 1, maxLength: 64 },
  dateFormat: { type: "string", required: true, minLength: 1, maxLength: 32 },
  numberFormat: { type: "string", required: true, minLength: 1, maxLength: 32 },
  currencyCode: {
    type: "string",
    required: true,
    minLength: 3,
    maxLength: 3,
    uppercase: true,
    pattern: "^[A-Z]{3}$"
  },
  avatarSize: { type: "number", required: true, min: 1 },
  productUpdates: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      default: "productUpdates must be a boolean."
    }
  },
  accountActivity: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      default: "accountActivity must be a boolean."
    }
  },
  securityAlerts: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      default: "securityAlerts must be a boolean."
    }
  }
});

const userSettingsPreferencesSchema = createSchema({
  theme: { type: "string", required: true, minLength: 1, maxLength: 32 },
  locale: { type: "string", required: true, minLength: 1, maxLength: 24, lowercase: true },
  timeZone: { type: "string", required: true, minLength: 1, maxLength: 64 },
  dateFormat: { type: "string", required: true, minLength: 1, maxLength: 32 },
  numberFormat: { type: "string", required: true, minLength: 1, maxLength: 32 },
  currencyCode: {
    type: "string",
    required: true,
    minLength: 3,
    maxLength: 3,
    uppercase: true,
    pattern: "^[A-Z]{3}$"
  },
  avatarSize: { type: "number", required: true, min: 1 }
});

const userSettingsNotificationsSchema = createSchema({
  productUpdates: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      default: "productUpdates must be a boolean."
    }
  },
  accountActivity: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      default: "accountActivity must be a boolean."
    }
  },
  securityAlerts: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      default: "securityAlerts must be a boolean."
    }
  }
});

const userSettingsOutputSchema = createSchema({
  profile: {
    type: "object",
    required: true,
    schema: userProfileOutputSchema
  },
  security: {
    type: "object",
    required: true,
    schema: accountSecurityStatusSchema
  },
  preferences: {
    type: "object",
    required: true,
    schema: userSettingsPreferencesSchema
  },
  notifications: {
    type: "object",
    required: true,
    schema: userSettingsNotificationsSchema
  }
});

const userSettingsOutputValidator = createSchemaDefinition(userSettingsOutputSchema, "replace");

const passwordMethodToggleOutputSchema = createSchema({
  securityStatus: {
    type: "object",
    required: true,
    schema: accountSecurityStatusSchema
  },
  settings: {
    type: "object",
    required: true,
    schema: userSettingsOutputSchema
  }
});

const oauthUnlinkOutputSchema = createSchema({
  securityStatus: {
    type: "object",
    required: true,
    schema: accountSecurityStatusSchema
  }
});

const passwordChangeBodySchema = createSchema({
  currentPassword: {
    type: "string",
    required: false,
    minLength: 1,
    messages: {
      default: "Current password is invalid."
    }
  },
  newPassword: {
    type: "string",
    required: true,
    minLength: 8,
    messages: {
      required: "New password is required.",
      minLength: "New password must be at least 8 characters.",
      default: "New password must be at least 8 characters."
    }
  },
  confirmPassword: {
    type: "string",
    required: true,
    minLength: 1,
    messages: {
      required: "Confirm password is required.",
      minLength: "Confirm password is required.",
      default: "Confirm password is required."
    }
  }
});

const passwordChangeOutputSchema = createSchema({
  ok: { type: "boolean", required: true },
  message: { type: "string", required: true, minLength: 1 }
});

const passwordMethodToggleBodySchema = createSchema({
  enabled: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      required: "enabled is required.",
      default: "enabled must be a boolean."
    }
  }
});

const oauthProviderParamsSchema = createSchema({
  provider: {
    type: "string",
    required: true,
    minLength: 2,
    maxLength: 64,
    messages: {
      required: "OAuth provider is required.",
      default: "OAuth provider is invalid."
    }
  }
});

const oauthProviderQuerySchema = createSchema({
  returnTo: {
    type: "string",
    required: false,
    minLength: 1,
    messages: {
      default: "Return path is invalid."
    }
  }
});

const oauthLinkStartOutputSchema = createSchema({
  provider: { type: "string", required: true, minLength: 2, maxLength: 64 },
  returnTo: { type: "string", required: true, minLength: 1 },
  url: { type: "string", required: true, minLength: 1 }
});

const logoutOtherSessionsOutputSchema = createSchema({
  ok: { type: "boolean", required: true }
});

const USER_SETTINGS_OPERATION_MESSAGES = createOperationMessages();

const userSettingsResource = defineCrudResource({
  namespace: "userSettings",
  tableName: "user_settings",
  idProperty: "user_id",
  searchSchema: {
    id: { type: "id", actualField: "id" }
  },
  schema: {
    id: {
      type: "id",
      primary: true,
      required: true,
      search: true,
      storage: { column: "user_id" }
    },
    theme: {
      type: "string",
      required: true,
      max: 32,
      defaultTo: DEFAULT_USER_SETTINGS.theme,
      setter: (value) => normalizeText(value)
    },
    locale: {
      type: "string",
      required: true,
      max: 24,
      defaultTo: DEFAULT_USER_SETTINGS.locale,
      setter: (value) => normalizeLowerText(value)
    },
    timeZone: {
      type: "string",
      required: true,
      max: 64,
      defaultTo: DEFAULT_USER_SETTINGS.timeZone,
      storage: { column: "time_zone" },
      setter: (value) => normalizeText(value)
    },
    dateFormat: {
      type: "string",
      required: true,
      max: 32,
      defaultTo: DEFAULT_USER_SETTINGS.dateFormat,
      storage: { column: "date_format" },
      setter: (value) => normalizeText(value)
    },
    numberFormat: {
      type: "string",
      required: true,
      max: 32,
      defaultTo: DEFAULT_USER_SETTINGS.numberFormat,
      storage: { column: "number_format" },
      setter: (value) => normalizeText(value)
    },
    currencyCode: {
      type: "string",
      required: true,
      minLength: 3,
      maxLength: 3,
      defaultTo: DEFAULT_USER_SETTINGS.currencyCode,
      storage: { column: "currency_code" },
      setter: (value) => normalizeText(value).toUpperCase()
    },
    avatarSize: {
      type: "number",
      required: true,
      min: 1,
      defaultTo: DEFAULT_USER_SETTINGS.avatarSize,
      storage: { column: "avatar_size" },
      setter: (value) => normalizePositiveInteger(value)
    },
    passwordSignInEnabled: {
      type: "boolean",
      required: true,
      defaultTo: DEFAULT_USER_SETTINGS.passwordSignInEnabled,
      storage: { column: "password_sign_in_enabled" }
    },
    passwordSetupRequired: {
      type: "boolean",
      required: true,
      defaultTo: DEFAULT_USER_SETTINGS.passwordSetupRequired,
      storage: { column: "password_setup_required" }
    },
    productUpdates: {
      type: "boolean",
      required: true,
      defaultTo: DEFAULT_USER_SETTINGS.productUpdates,
      storage: { column: "notify_product_updates" }
    },
    accountActivity: {
      type: "boolean",
      required: true,
      defaultTo: DEFAULT_USER_SETTINGS.accountActivity,
      storage: { column: "notify_account_activity" }
    },
    securityAlerts: {
      type: "boolean",
      required: true,
      defaultTo: DEFAULT_USER_SETTINGS.securityAlerts,
      storage: { column: "notify_security_alerts" }
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
  messages: USER_SETTINGS_OPERATION_MESSAGES,
  crudOperations: ["view", "list", "create", "replace", "patch"],
  crud: {
    output: userSettingsOutputValidator,
    body: userSettingsBodySchema
  },
  operations: {
    preferencesUpdate: {
      method: "PATCH",
      body: userSettingsPreferencesSchema,
      output: userSettingsOutputValidator
    },
    notificationsUpdate: {
      method: "PATCH",
      body: userSettingsNotificationsSchema,
      output: userSettingsOutputValidator
    },
    passwordChange: {
      method: "POST",
      body: passwordChangeBodySchema,
      output: passwordChangeOutputSchema
    },
    passwordMethodToggle: {
      method: "PATCH",
      body: passwordMethodToggleBodySchema,
      output: passwordMethodToggleOutputSchema
    },
    oauthLinkStart: {
      method: "GET",
      params: oauthProviderParamsSchema,
      query: oauthProviderQuerySchema,
      output: oauthLinkStartOutputSchema
    },
    oauthUnlink: {
      method: "DELETE",
      params: oauthProviderParamsSchema,
      output: oauthUnlinkOutputSchema
    },
    logoutOtherSessions: {
      method: "POST",
      body: createSchema({}),
      output: logoutOtherSessionsOutputSchema
    }
  }
});

export {
  USER_SETTINGS_ALL_KEYS,
  USER_SETTINGS_BOOTSTRAP_KEYS,
  USER_SETTINGS_NOTIFICATION_KEYS,
  USER_SETTINGS_PREFERENCE_KEYS,
  userSettingsOutputSchema,
  userSettingsOutputValidator,
  userSettingsResource
};
