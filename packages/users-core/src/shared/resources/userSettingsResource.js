import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  createSchemaDefinition,
  defineApiContract
} from "@jskit-ai/resource-core/shared/apiContract";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { OPERATION_MESSAGES } from "../operationMessages.js";
import { DEFAULT_USER_SETTINGS, normalizeLocaleCode } from "../settings.js";
import {
  accountSecurityStatusSchema,
  userProfileOutputSchema
} from "./accountSettingsSchemas.js";

const USER_PASSWORD_MIN_LENGTH = 8;

// Each field message: its English and the code a client renders it from in the user's language.
const USER_SETTINGS_FIELD_MESSAGES = deepFreeze({
  productUpdatesInvalid: { code: "users.settings.productUpdatesInvalid", message: "productUpdates must be a boolean." },
  accountActivityInvalid: {
    code: "users.settings.accountActivityInvalid",
    message: "accountActivity must be a boolean."
  },
  securityAlertsInvalid: { code: "users.settings.securityAlertsInvalid", message: "securityAlerts must be a boolean." },
  currentPasswordInvalid: { code: "users.security.currentPasswordInvalid", message: "Current password is invalid." },
  newPasswordRequired: { code: "users.security.newPasswordRequired", message: "New password is required." },
  newPasswordMinLength: {
    code: "users.security.newPasswordMinLength",
    message: `New password must be at least ${USER_PASSWORD_MIN_LENGTH} characters.`,
    params: { min: USER_PASSWORD_MIN_LENGTH }
  },
  confirmPasswordRequired: { code: "users.security.confirmPasswordRequired", message: "Confirm password is required." },
  enabledRequired: { code: "users.security.enabledRequired", message: "enabled is required." },
  enabledInvalid: { code: "users.security.enabledInvalid", message: "enabled must be a boolean." },
  oauthProviderRequired: { code: "users.security.oauthProviderRequired", message: "OAuth provider is required." },
  oauthProviderInvalid: { code: "users.security.oauthProviderInvalid", message: "OAuth provider is invalid." },
  returnToInvalid: { code: "users.security.returnToInvalid", message: "Return path is invalid." }
});

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

// Every preference and notification setting at once: the CRUD contract's body.
const userSettingsBodySchema = createSchema({
  theme: { type: "string", required: true, minLength: 1, maxLength: 32 },
  locale: { type: "string", required: true, minLength: 1, maxLength: 24 },
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
      default: USER_SETTINGS_FIELD_MESSAGES.productUpdatesInvalid
    }
  },
  accountActivity: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      default: USER_SETTINGS_FIELD_MESSAGES.accountActivityInvalid
    }
  },
  securityAlerts: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      default: USER_SETTINGS_FIELD_MESSAGES.securityAlertsInvalid
    }
  }
});

const userSettingsPreferencesSchema = createSchema({
  theme: { type: "string", required: true, minLength: 1, maxLength: 32 },
  locale: { type: "string", required: true, minLength: 1, maxLength: 24 },
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
      default: USER_SETTINGS_FIELD_MESSAGES.productUpdatesInvalid
    }
  },
  accountActivity: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      default: USER_SETTINGS_FIELD_MESSAGES.accountActivityInvalid
    }
  },
  securityAlerts: {
    type: "boolean",
    required: true,
    strictBoolean: true,
    messages: {
      default: USER_SETTINGS_FIELD_MESSAGES.securityAlertsInvalid
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
      default: USER_SETTINGS_FIELD_MESSAGES.currentPasswordInvalid
    }
  },
  newPassword: {
    type: "string",
    required: true,
    minLength: USER_PASSWORD_MIN_LENGTH,
    messages: {
      required: USER_SETTINGS_FIELD_MESSAGES.newPasswordRequired,
      minLength: USER_SETTINGS_FIELD_MESSAGES.newPasswordMinLength,
      default: USER_SETTINGS_FIELD_MESSAGES.newPasswordMinLength
    }
  },
  confirmPassword: {
    type: "string",
    required: true,
    minLength: 1,
    messages: {
      required: USER_SETTINGS_FIELD_MESSAGES.confirmPasswordRequired,
      minLength: USER_SETTINGS_FIELD_MESSAGES.confirmPasswordRequired,
      default: USER_SETTINGS_FIELD_MESSAGES.confirmPasswordRequired
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
      required: USER_SETTINGS_FIELD_MESSAGES.enabledRequired,
      default: USER_SETTINGS_FIELD_MESSAGES.enabledInvalid
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
      required: USER_SETTINGS_FIELD_MESSAGES.oauthProviderRequired,
      default: USER_SETTINGS_FIELD_MESSAGES.oauthProviderInvalid
    }
  }
});

const oauthProviderQuerySchema = createSchema({
  returnTo: {
    type: "string",
    required: false,
    minLength: 1,
    messages: {
      default: USER_SETTINGS_FIELD_MESSAGES.returnToInvalid
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

// The user_settings table, one row per user.
const userSettingsResource = defineTableResource({
  name: "userSettings",
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
      setter: (value) => normalizeLocaleCode(value)
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
      storage: {
        column: "created_at",
        writeSerializer: "datetime-utc"
      }
    },
    updatedAt: {
      type: "dateTime",
      storage: {
        column: "updated_at",
        writeSerializer: "datetime-utc"
      }
    }
  },
});

// The account settings' CRUD surface on the user_settings table: view, list,
// create, replace and patch, each with the account settings output and every
// setting as its body. No JSKIT route serves it; an application that offers
// these operations serves this contract.
const userSettingsCrud = defineCrudContract(userSettingsResource, {
  namespace: "userSettings",
  messages: OPERATION_MESSAGES,
  operations: ["view", "list", "create", "replace", "patch"],
  output: userSettingsOutputValidator,
  body: userSettingsBodySchema
});

// The signed-in user's settings over HTTP.
const userSettingsContract = defineApiContract({
  namespace: "userSettings",
  messages: OPERATION_MESSAGES,
  operations: {
    view: {
      method: "GET",
      output: userSettingsOutputValidator
    },
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
  userSettingsContract,
  userSettingsCrud,
  userSettingsOutputValidator,
  userSettingsResource
};
