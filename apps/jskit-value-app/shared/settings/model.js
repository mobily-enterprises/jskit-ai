import {
  toBoolean,
  toCurrencyCode,
  toEnum,
  toLocale,
  toPositiveInt,
  toTimeZone,
  toTrimmedString
} from "@jskit-ai/workspace-console-core/settingsValidation";
import {
  AVATAR_DEFAULT_SIZE,
  AVATAR_MAX_SIZE,
  AVATAR_MIN_SIZE,
  AVATAR_SIZE_OPTIONS
} from "../avatar/index.js";

export const SETTINGS_THEME_OPTIONS = ["system", "light", "dark"];
export const SETTINGS_DATE_FORMAT_OPTIONS = ["system", "mdy", "dmy", "ymd"];
export const SETTINGS_NUMBER_FORMAT_OPTIONS = ["system", "comma-dot", "dot-comma", "space-comma"];
export const SETTINGS_MODE_OPTIONS = ["fv", "pv"];
export const SETTINGS_TIMING_OPTIONS = ["ordinary", "due"];

export const SETTINGS_LOCALE_PATTERN = "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$";
export const SETTINGS_CURRENCY_CODE_PATTERN = "^[A-Z]{3}$";

export const SETTINGS_PROFILE_KEYS = ["displayName", "email"];
export const SETTINGS_PREFERENCE_KEYS = [
  "theme",
  "locale",
  "timeZone",
  "dateFormat",
  "numberFormat",
  "currencyCode",
  "avatarSize"
];
export const SETTINGS_NOTIFICATION_KEYS = ["productUpdates", "accountActivity", "securityAlerts"];
export const SETTINGS_CHAT_KEYS = [
  "publicChatId",
  "allowWorkspaceDms",
  "allowGlobalDms",
  "requireSharedWorkspaceForGlobalDm",
  "discoverableByPublicChatId"
];

export const SETTINGS_FEATURE_FLAGS = {
  securityAlertsAlwaysEnabled: true,
  allowPublicChatIdDiscoverabilityToggle: true
};

export const SETTINGS_DEFAULTS = {
  theme: "system",
  locale: "en-US",
  timeZone: "UTC",
  dateFormat: "system",
  numberFormat: "system",
  currencyCode: "USD",
  defaultMode: "fv",
  defaultTiming: "ordinary",
  defaultPaymentsPerYear: 12,
  defaultHistoryPageSize: 10,
  avatarSize: AVATAR_DEFAULT_SIZE,
  productUpdates: true,
  accountActivity: true,
  securityAlerts: true
};

export const SETTINGS_NOTIFICATIONS_DEFAULTS = {
  productUpdates: true,
  accountActivity: true,
  securityAlerts: true
};

export const SETTINGS_CHAT_DEFAULTS = {
  publicChatId: "",
  allowWorkspaceDms: true,
  allowGlobalDms: false,
  requireSharedWorkspaceForGlobalDm: true,
  discoverableByPublicChatId: false
};

export const SETTINGS_PREFERENCES_OPTIONS = {
  theme: [
    { title: "System", value: "system" },
    { title: "Light", value: "light" },
    { title: "Dark", value: "dark" }
  ],
  locale: [
    { title: "English (US)", value: "en-US" },
    { title: "English (UK)", value: "en-GB" },
    { title: "Italian", value: "it-IT" },
    { title: "Spanish", value: "es-ES" }
  ],
  dateFormat: [
    { title: "System", value: "system" },
    { title: "MM/DD/YYYY", value: "mdy" },
    { title: "DD/MM/YYYY", value: "dmy" },
    { title: "YYYY-MM-DD", value: "ymd" }
  ],
  numberFormat: [
    { title: "System", value: "system" },
    { title: "1,234.56", value: "comma-dot" },
    { title: "1.234,56", value: "dot-comma" },
    { title: "1 234,56", value: "space-comma" }
  ],
  currency: ["USD", "EUR", "GBP", "AUD", "JPY"],
  timeZone: [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Rome",
    "Asia/Tokyo",
    "Australia/Sydney"
  ],
  avatarSize: [...AVATAR_SIZE_OPTIONS]
};

export const SETTINGS_LIMITS = {
  displayNameMaxLength: 120,
  publicChatIdMaxLength: 64,
  avatarSizeMin: AVATAR_MIN_SIZE,
  avatarSizeMax: AVATAR_MAX_SIZE
};

export const SETTINGS_FIELD_SPECS = {
  profile: {
    displayName: {
      type: "string",
      minLength: 1,
      maxLength: SETTINGS_LIMITS.displayNameMaxLength,
      required: true,
      normalize(value) {
        const displayName = toTrimmedString(value);
        if (!displayName) {
          throw new Error("Display name is required.");
        }
        if (displayName.length > SETTINGS_LIMITS.displayNameMaxLength) {
          throw new Error(`Display name must be at most ${SETTINGS_LIMITS.displayNameMaxLength} characters.`);
        }

        return displayName;
      }
    }
  },
  preferences: {
    theme: {
      type: "enum",
      allowedValues: SETTINGS_THEME_OPTIONS,
      normalize(value) {
        return toEnum(toTrimmedString(value).toLowerCase(), SETTINGS_THEME_OPTIONS, {
          message: "Theme must be one of: system, light, dark."
        });
      }
    },
    locale: {
      type: "string",
      minLength: 2,
      maxLength: 24,
      pattern: SETTINGS_LOCALE_PATTERN,
      normalize(value) {
        return toLocale(value, {
          requiredMessage: "Locale is required.",
          message: "Locale must be a valid BCP 47 locale tag."
        });
      }
    },
    timeZone: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      normalize(value) {
        return toTimeZone(value, {
          requiredMessage: "Time zone is required.",
          message: "Time zone must be a valid IANA time zone identifier."
        });
      }
    },
    dateFormat: {
      type: "enum",
      allowedValues: SETTINGS_DATE_FORMAT_OPTIONS,
      normalize(value) {
        return toEnum(toTrimmedString(value).toLowerCase(), SETTINGS_DATE_FORMAT_OPTIONS, {
          message: "Date format must be one of: system, mdy, dmy, ymd."
        });
      }
    },
    numberFormat: {
      type: "enum",
      allowedValues: SETTINGS_NUMBER_FORMAT_OPTIONS,
      normalize(value) {
        return toEnum(toTrimmedString(value).toLowerCase(), SETTINGS_NUMBER_FORMAT_OPTIONS, {
          message: "Number format must be one of: system, comma-dot, dot-comma, space-comma."
        });
      }
    },
    currencyCode: {
      type: "string",
      pattern: SETTINGS_CURRENCY_CODE_PATTERN,
      normalize(value) {
        return toCurrencyCode(value, {
          requiredMessage: "Currency code is required.",
          patternMessage: "Currency code must be a 3-letter ISO 4217 code.",
          message: "Currency code is not supported."
        });
      }
    },
    avatarSize: {
      type: "integer",
      min: AVATAR_MIN_SIZE,
      max: AVATAR_MAX_SIZE,
      normalize(value) {
        return toPositiveInt(value, {
          min: AVATAR_MIN_SIZE,
          max: AVATAR_MAX_SIZE,
          message: `Avatar size must be an integer from ${AVATAR_MIN_SIZE} to ${AVATAR_MAX_SIZE}.`
        });
      }
    }
  },
  notifications: {
    productUpdates: {
      type: "boolean",
      normalize(value) {
        return toBoolean(value, {
          message: "Product updates setting must be boolean."
        });
      }
    },
    accountActivity: {
      type: "boolean",
      normalize(value) {
        return toBoolean(value, {
          message: "Account activity setting must be boolean."
        });
      }
    },
    securityAlerts: {
      type: "boolean",
      normalize(value) {
        if (value !== true) {
          throw new Error("Security alerts must stay enabled.");
        }

        return true;
      }
    }
  },
  chat: {
    publicChatId: {
      type: "string",
      minLength: 1,
      maxLength: SETTINGS_LIMITS.publicChatIdMaxLength,
      nullable: true,
      normalize(value) {
        if (value == null) {
          return null;
        }

        const publicChatId = toTrimmedString(value);
        if (publicChatId.length > SETTINGS_LIMITS.publicChatIdMaxLength) {
          throw new Error(`Public chat id must be at most ${SETTINGS_LIMITS.publicChatIdMaxLength} characters.`);
        }

        return publicChatId || null;
      }
    },
    allowWorkspaceDms: {
      type: "boolean",
      normalize(value) {
        return toBoolean(value, {
          message: "Workspace direct messages setting must be boolean."
        });
      }
    },
    allowGlobalDms: {
      type: "boolean",
      normalize(value) {
        return toBoolean(value, {
          message: "Global direct messages setting must be boolean."
        });
      }
    },
    requireSharedWorkspaceForGlobalDm: {
      type: "boolean",
      normalize(value) {
        return toBoolean(value, {
          message: "Shared workspace requirement setting must be boolean."
        });
      }
    },
    discoverableByPublicChatId: {
      type: "boolean",
      normalize(value) {
        return toBoolean(value, {
          message: "Discoverability setting must be boolean."
        });
      }
    }
  }
};
