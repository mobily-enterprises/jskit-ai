import { createSchema } from "json-rest-schema";
import { createCursorListValidator } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
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

const userSettingsOutputValidator = deepFreeze({
  schema: userSettingsOutputSchema,
  mode: "replace"
});

const passwordMethodToggleOutputValidator = deepFreeze({
  schema: createSchema({
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
  }),
  mode: "replace"
});

const oauthUnlinkOutputValidator = deepFreeze({
  schema: createSchema({
    securityStatus: {
      type: "object",
      required: true,
      schema: accountSecurityStatusSchema
    }
  }),
  mode: "replace"
});

const passwordChangeBodyValidator = deepFreeze({
  schema: createSchema({
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
  }),
  mode: "create"
});

const passwordChangeOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    message: { type: "string", required: true, minLength: 1 }
  }),
  mode: "replace"
});

const passwordMethodToggleBodyValidator = deepFreeze({
  schema: createSchema({
    enabled: {
      type: "boolean",
      required: true,
      strictBoolean: true,
      messages: {
        required: "enabled is required.",
        default: "enabled must be a boolean."
      }
    }
  }),
  mode: "patch"
});

const oauthProviderParamsValidator = deepFreeze({
  schema: createSchema({
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
  }),
  mode: "patch"
});

const oauthProviderQueryValidator = deepFreeze({
  schema: createSchema({
    returnTo: {
      type: "string",
      required: false,
      minLength: 1,
      messages: {
        default: "Return path is invalid."
      }
    }
  }),
  mode: "patch"
});

const oauthLinkStartOutputValidator = deepFreeze({
  schema: createSchema({
    provider: { type: "string", required: true, minLength: 2, maxLength: 64 },
    returnTo: { type: "string", required: true, minLength: 1 },
    url: { type: "string", required: true, minLength: 1 }
  }),
  mode: "replace"
});

const logoutOtherSessionsOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true }
  }),
  mode: "replace"
});

const emptyBodyValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const USER_SETTINGS_OPERATION_MESSAGES = createOperationMessages();

const userSettingsResource = deepFreeze({
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
  operations: {
    view: {
      method: "GET",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      output: userSettingsOutputValidator
    },
    list: {
      method: "GET",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      output: createCursorListValidator(userSettingsOutputValidator)
    },
    create: {
      method: "POST",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: {
        schema: userSettingsBodySchema,
        mode: "create"
      },
      output: userSettingsOutputValidator
    },
    replace: {
      method: "PUT",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: {
        schema: userSettingsBodySchema,
        mode: "replace"
      },
      output: userSettingsOutputValidator
    },
    patch: {
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: {
        schema: userSettingsBodySchema,
        mode: "patch"
      },
      output: userSettingsOutputValidator
    },
    preferencesUpdate: {
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: {
        schema: userSettingsPreferencesSchema,
        mode: "patch"
      },
      output: userSettingsOutputValidator
    },
    notificationsUpdate: {
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: {
        schema: userSettingsNotificationsSchema,
        mode: "patch"
      },
      output: userSettingsOutputValidator
    },
    passwordChange: {
      method: "POST",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: passwordChangeBodyValidator,
      output: passwordChangeOutputValidator
    },
    passwordMethodToggle: {
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: passwordMethodToggleBodyValidator,
      output: passwordMethodToggleOutputValidator
    },
    oauthLinkStart: {
      method: "GET",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      params: oauthProviderParamsValidator,
      query: oauthProviderQueryValidator,
      output: oauthLinkStartOutputValidator
    },
    oauthUnlink: {
      method: "DELETE",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      params: oauthProviderParamsValidator,
      output: oauthUnlinkOutputValidator
    },
    logoutOtherSessions: {
      method: "POST",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: emptyBodyValidator,
      output: logoutOtherSessionsOutputValidator
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
