import {
  toBoolean,
  toCurrencyCode,
  toEnum,
  toLocale,
  toPositiveInt,
  toTimeZone,
  toTrimmedString
} from "./settingsValidation.js";

const BASE_THEME_OPTIONS = ["system", "light", "dark"];
const BASE_DATE_FORMAT_OPTIONS = ["system", "mdy", "dmy", "ymd"];
const BASE_NUMBER_FORMAT_OPTIONS = ["system", "comma-dot", "dot-comma", "space-comma"];
const BASE_MODE_OPTIONS = ["fv", "pv"];
const BASE_TIMING_OPTIONS = ["ordinary", "due"];

const BASE_LOCALE_PATTERN = "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$";
const BASE_CURRENCY_CODE_PATTERN = "^[A-Z]{3}$";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);

  if (normalized.length < 1) {
    return [...fallback];
  }

  return [...new Set(normalized)];
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function normalizeAvatarSizeOptions(value, { minSize, maxSize, defaultSize }) {
  const source = Array.isArray(value) ? value : [];
  const normalized = source
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= minSize && entry <= maxSize);

  if (normalized.length < 1) {
    return [...new Set([minSize, defaultSize, maxSize])].sort((left, right) => left - right);
  }

  return [...new Set(normalized)].sort((left, right) => left - right);
}

function normalizeAvatarConfig(avatar = {}) {
  const input = isPlainObject(avatar) ? avatar : {};
  const minSize = normalizePositiveInteger(input.minSize, 24);
  const maxSize = normalizePositiveInteger(input.maxSize, Math.max(24, minSize));
  const resolvedMaxSize = Math.max(minSize, maxSize);
  const defaultSize = Math.min(
    resolvedMaxSize,
    Math.max(minSize, normalizePositiveInteger(input.defaultSize, Math.min(64, resolvedMaxSize)))
  );

  return {
    minSize,
    maxSize: resolvedMaxSize,
    defaultSize,
    sizeOptions: normalizeAvatarSizeOptions(input.sizeOptions, {
      minSize,
      maxSize: resolvedMaxSize,
      defaultSize
    })
  };
}

function mergeFieldSpecs(baseFieldSpecs, extensionFieldSpecs) {
  if (!isPlainObject(extensionFieldSpecs)) {
    return baseFieldSpecs;
  }

  const output = {};
  for (const [sectionName, sectionValue] of Object.entries(baseFieldSpecs)) {
    if (isPlainObject(sectionValue)) {
      output[sectionName] = { ...sectionValue };
    } else {
      output[sectionName] = sectionValue;
    }
  }
  for (const [sectionName, sectionPatch] of Object.entries(extensionFieldSpecs)) {
    if (!isPlainObject(sectionPatch)) {
      continue;
    }

    const currentSection = isPlainObject(output[sectionName]) ? output[sectionName] : {};
    const nextSection = { ...currentSection };
    for (const [fieldName, fieldPatch] of Object.entries(sectionPatch)) {
      if (isPlainObject(fieldPatch) && isPlainObject(currentSection[fieldName])) {
        nextSection[fieldName] = {
          ...currentSection[fieldName],
          ...fieldPatch
        };
      } else {
        nextSection[fieldName] = fieldPatch;
      }
    }

    output[sectionName] = nextSection;
  }

  return output;
}

function createSettingsModel({ avatar = {}, modelExtension = {} } = {}) {
  const extension = isPlainObject(modelExtension) ? modelExtension : {};
  const avatarConfig = normalizeAvatarConfig(avatar);

  const SETTINGS_THEME_OPTIONS = normalizeStringArray(extension.themeOptions, BASE_THEME_OPTIONS);
  const SETTINGS_DATE_FORMAT_OPTIONS = normalizeStringArray(extension.dateFormatOptions, BASE_DATE_FORMAT_OPTIONS);
  const SETTINGS_NUMBER_FORMAT_OPTIONS = normalizeStringArray(extension.numberFormatOptions, BASE_NUMBER_FORMAT_OPTIONS);
  const SETTINGS_MODE_OPTIONS = normalizeStringArray(extension.modeOptions, BASE_MODE_OPTIONS);
  const SETTINGS_TIMING_OPTIONS = normalizeStringArray(extension.timingOptions, BASE_TIMING_OPTIONS);

  const SETTINGS_LOCALE_PATTERN = String(extension.localePattern || BASE_LOCALE_PATTERN);
  const SETTINGS_CURRENCY_CODE_PATTERN = String(extension.currencyCodePattern || BASE_CURRENCY_CODE_PATTERN);

  const SETTINGS_PROFILE_KEYS = ["displayName", "email"];
  const SETTINGS_PREFERENCE_KEYS = [
    "theme",
    "locale",
    "timeZone",
    "dateFormat",
    "numberFormat",
    "currencyCode",
    "avatarSize"
  ];
  const SETTINGS_NOTIFICATION_KEYS = ["productUpdates", "accountActivity", "securityAlerts"];
  const SETTINGS_CHAT_KEYS = [
    "publicChatId",
    "allowWorkspaceDms",
    "allowGlobalDms",
    "requireSharedWorkspaceForGlobalDm",
    "discoverableByPublicChatId"
  ];

  const SETTINGS_FEATURE_FLAGS = {
    securityAlertsAlwaysEnabled: true,
    allowPublicChatIdDiscoverabilityToggle: true,
    ...(isPlainObject(extension.featureFlags) ? extension.featureFlags : {})
  };

  const SETTINGS_LIMITS = {
    displayNameMaxLength: 120,
    publicChatIdMaxLength: 64,
    avatarSizeMin: avatarConfig.minSize,
    avatarSizeMax: avatarConfig.maxSize,
    ...(isPlainObject(extension.limits) ? extension.limits : {})
  };

  const SETTINGS_DEFAULTS = {
    theme: SETTINGS_THEME_OPTIONS[0] || "system",
    locale: "en-US",
    timeZone: "UTC",
    dateFormat: SETTINGS_DATE_FORMAT_OPTIONS[0] || "system",
    numberFormat: SETTINGS_NUMBER_FORMAT_OPTIONS[0] || "system",
    currencyCode: "USD",
    defaultMode: SETTINGS_MODE_OPTIONS[0] || "fv",
    defaultTiming: SETTINGS_TIMING_OPTIONS[0] || "ordinary",
    defaultPaymentsPerYear: 12,
    defaultHistoryPageSize: 10,
    avatarSize: avatarConfig.defaultSize,
    productUpdates: true,
    accountActivity: true,
    securityAlerts: true,
    ...(isPlainObject(extension.defaults) ? extension.defaults : {})
  };

  const SETTINGS_NOTIFICATIONS_DEFAULTS = {
    productUpdates: true,
    accountActivity: true,
    securityAlerts: true,
    ...(isPlainObject(extension.notificationsDefaults) ? extension.notificationsDefaults : {})
  };

  const SETTINGS_CHAT_DEFAULTS = {
    publicChatId: "",
    allowWorkspaceDms: true,
    allowGlobalDms: false,
    requireSharedWorkspaceForGlobalDm: true,
    discoverableByPublicChatId: false,
    ...(isPlainObject(extension.chatDefaults) ? extension.chatDefaults : {})
  };

  const basePreferencesOptions = {
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
    avatarSize: [...avatarConfig.sizeOptions]
  };

  const extensionPreferencesOptions = isPlainObject(extension.preferencesOptions) ? extension.preferencesOptions : {};
  const SETTINGS_PREFERENCES_OPTIONS = {
    ...basePreferencesOptions,
    ...extensionPreferencesOptions
  };

  const baseFieldSpecs = {
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
            message: `Theme must be one of: ${SETTINGS_THEME_OPTIONS.join(", ")}.`
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
            message: `Date format must be one of: ${SETTINGS_DATE_FORMAT_OPTIONS.join(", ")}.`
          });
        }
      },
      numberFormat: {
        type: "enum",
        allowedValues: SETTINGS_NUMBER_FORMAT_OPTIONS,
        normalize(value) {
          return toEnum(toTrimmedString(value).toLowerCase(), SETTINGS_NUMBER_FORMAT_OPTIONS, {
            message: `Number format must be one of: ${SETTINGS_NUMBER_FORMAT_OPTIONS.join(", ")}.`
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
        min: SETTINGS_LIMITS.avatarSizeMin,
        max: SETTINGS_LIMITS.avatarSizeMax,
        normalize(value) {
          return toPositiveInt(value, {
            min: SETTINGS_LIMITS.avatarSizeMin,
            max: SETTINGS_LIMITS.avatarSizeMax,
            message: `Avatar size must be an integer from ${SETTINGS_LIMITS.avatarSizeMin} to ${
              SETTINGS_LIMITS.avatarSizeMax
            }.`
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
          if (SETTINGS_FEATURE_FLAGS.securityAlertsAlwaysEnabled && value !== true) {
            throw new Error("Security alerts must stay enabled.");
          }

          return toBoolean(value, {
            message: "Security alerts setting must be boolean."
          });
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

  const SETTINGS_FIELD_SPECS = mergeFieldSpecs(baseFieldSpecs, extension.fieldSpecs);

  return {
    SETTINGS_THEME_OPTIONS,
    SETTINGS_DATE_FORMAT_OPTIONS,
    SETTINGS_NUMBER_FORMAT_OPTIONS,
    SETTINGS_MODE_OPTIONS,
    SETTINGS_TIMING_OPTIONS,
    SETTINGS_LOCALE_PATTERN,
    SETTINGS_CURRENCY_CODE_PATTERN,
    SETTINGS_PROFILE_KEYS,
    SETTINGS_PREFERENCE_KEYS,
    SETTINGS_NOTIFICATION_KEYS,
    SETTINGS_CHAT_KEYS,
    SETTINGS_FEATURE_FLAGS,
    SETTINGS_DEFAULTS,
    SETTINGS_NOTIFICATIONS_DEFAULTS,
    SETTINGS_CHAT_DEFAULTS,
    SETTINGS_PREFERENCES_OPTIONS,
    SETTINGS_LIMITS,
    SETTINGS_FIELD_SPECS
  };
}

const PLATFORM_AVATAR_SETTINGS = Object.freeze({
  minSize: 32,
  maxSize: 128,
  defaultSize: 64,
  sizeOptions: [32, 40, 48, 56, 64, 72, 80, 96, 112, 128]
});

const PLATFORM_SETTINGS_MODEL = createSettingsModel({
  avatar: PLATFORM_AVATAR_SETTINGS
});

const {
  SETTINGS_THEME_OPTIONS,
  SETTINGS_DATE_FORMAT_OPTIONS,
  SETTINGS_NUMBER_FORMAT_OPTIONS,
  SETTINGS_MODE_OPTIONS,
  SETTINGS_TIMING_OPTIONS,
  SETTINGS_LOCALE_PATTERN,
  SETTINGS_CURRENCY_CODE_PATTERN,
  SETTINGS_PROFILE_KEYS,
  SETTINGS_PREFERENCE_KEYS,
  SETTINGS_NOTIFICATION_KEYS,
  SETTINGS_CHAT_KEYS,
  SETTINGS_FEATURE_FLAGS,
  SETTINGS_DEFAULTS,
  SETTINGS_NOTIFICATIONS_DEFAULTS,
  SETTINGS_CHAT_DEFAULTS,
  SETTINGS_PREFERENCES_OPTIONS,
  SETTINGS_LIMITS,
  SETTINGS_FIELD_SPECS
} = PLATFORM_SETTINGS_MODEL;

export {
  createSettingsModel,
  PLATFORM_AVATAR_SETTINGS,
  PLATFORM_SETTINGS_MODEL,
  SETTINGS_THEME_OPTIONS,
  SETTINGS_DATE_FORMAT_OPTIONS,
  SETTINGS_NUMBER_FORMAT_OPTIONS,
  SETTINGS_MODE_OPTIONS,
  SETTINGS_TIMING_OPTIONS,
  SETTINGS_LOCALE_PATTERN,
  SETTINGS_CURRENCY_CODE_PATTERN,
  SETTINGS_PROFILE_KEYS,
  SETTINGS_PREFERENCE_KEYS,
  SETTINGS_NOTIFICATION_KEYS,
  SETTINGS_CHAT_KEYS,
  SETTINGS_FEATURE_FLAGS,
  SETTINGS_DEFAULTS,
  SETTINGS_NOTIFICATIONS_DEFAULTS,
  SETTINGS_CHAT_DEFAULTS,
  SETTINGS_PREFERENCES_OPTIONS,
  SETTINGS_LIMITS,
  SETTINGS_FIELD_SPECS
};
