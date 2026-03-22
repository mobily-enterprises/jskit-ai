import { Type } from "typebox";
import {
  createCursorListValidator,
  normalizeObjectInput
} from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createOperationMessages } from "../operationMessages.js";
import { normalizeSettingsFieldInput } from "./normalizeSettingsFieldInput.js";
import { userProfileResource } from "./userProfileResource.js";
import {
  USER_SETTINGS_SECTIONS,
  userSettingsFields
} from "./userSettingsFields.js";

function pickPatchBody(schema, keys = []) {
  const properties = {};
  for (const key of keys) {
    if (!Object.hasOwn(schema.properties, key)) {
      throw new Error(`pickPatchBody requires patch field "${key}".`);
    }

    properties[key] = schema.properties[key];
  }

  return Type.Object(properties, {
    additionalProperties: false,
    minProperties: 1
  });
}

function listFieldsBySection(section) {
  return userSettingsFields.filter((field) => field.section === section);
}

function buildCreateBodySchema() {
  const properties = {};
  for (const field of userSettingsFields) {
    properties[field.key] = field.required === false ? Type.Optional(field.inputSchema) : field.inputSchema;
  }

  return Type.Object(properties, { additionalProperties: false });
}

function buildSectionOutputSchema(section) {
  const properties = {};
  for (const field of listFieldsBySection(section)) {
    properties[field.key] = field.outputSchema;
  }

  return Type.Object(properties, { additionalProperties: false });
}

function normalizeInput(payload = {}) {
  return normalizeSettingsFieldInput(payload, userSettingsFields);
}

function normalizeSectionOutput(section, sectionSource = {}, settings = {}) {
  const normalized = {};
  for (const field of listFieldsBySection(section)) {
    const rawValue = Object.hasOwn(sectionSource, field.key)
      ? sectionSource[field.key]
      : field.resolveDefault({
          settings
        });
    normalized[field.key] = field.normalizeOutput(rawValue, {
      settings
    });
  }
  return normalized;
}

function buildUserSettingsOutputSchema() {
  return Type.Object(
    {
      profile: userProfileResource.operations.view.outputValidator.schema,
      security: Type.Object({}, { additionalProperties: true }),
      preferences: buildSectionOutputSchema(USER_SETTINGS_SECTIONS.PREFERENCES),
      notifications: buildSectionOutputSchema(USER_SETTINGS_SECTIONS.NOTIFICATIONS)
    },
    { additionalProperties: true }
  );
}

const userSettingsOutputValidator = Object.freeze({
  get schema() {
    return buildUserSettingsOutputSchema();
  },
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const preferencesSource = normalizeObjectInput(source.preferences);
    const notificationsSource = normalizeObjectInput(source.notifications);

    return {
      profile: normalizeObjectInput(source.profile),
      security: normalizeObjectInput(source.security),
      preferences: normalizeSectionOutput(
        USER_SETTINGS_SECTIONS.PREFERENCES,
        preferencesSource,
        preferencesSource
      ),
      notifications: normalizeSectionOutput(
        USER_SETTINGS_SECTIONS.NOTIFICATIONS,
        notificationsSource,
        notificationsSource
      )
    };
  }
});

function buildUserSettingsCreateBodySchema() {
  return buildCreateBodySchema();
}

function buildUserSettingsPatchBodySchema() {
  return Type.Partial(buildUserSettingsCreateBodySchema(), {
    additionalProperties: false,
    minProperties: 1
  });
}

function buildPreferencesUpdateBodySchema() {
  return pickPatchBody(
    buildUserSettingsPatchBodySchema(),
    listFieldsBySection(USER_SETTINGS_SECTIONS.PREFERENCES).map((field) => field.key)
  );
}

function buildNotificationsUpdateBodySchema() {
  return pickPatchBody(
    buildUserSettingsPatchBodySchema(),
    listFieldsBySection(USER_SETTINGS_SECTIONS.NOTIFICATIONS).map((field) => field.key)
  );
}

const preferencesUpdateBodyValidator = Object.freeze({
  get schema() {
    return buildPreferencesUpdateBodySchema();
  },
  normalize: normalizeInput
});

const notificationsUpdateBodyValidator = Object.freeze({
  get schema() {
    return buildNotificationsUpdateBodySchema();
  },
  normalize: normalizeInput
});

function normalizeOAuthProviderParams(payload = {}) {
  const source = normalizeObjectInput(payload);
  if (!Object.hasOwn(source, "provider")) {
    return {};
  }

  return {
    provider: normalizeText(source.provider)
  };
}

function normalizeOAuthProviderQuery(payload = {}) {
  const source = normalizeObjectInput(payload);
  if (!Object.hasOwn(source, "returnTo")) {
    return {};
  }

  const returnTo = normalizeText(source.returnTo);
  if (!returnTo) {
    return {};
  }

  return {
    returnTo
  };
}

const settingsActionOutputValidator = Object.freeze({
  schema: Type.Object({}, { additionalProperties: true }),
  normalize: normalizeObjectInput
});

const passwordChangeOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      ok: Type.Boolean(),
      message: Type.String()
    },
    { additionalProperties: false }
  ),
  normalize: normalizeObjectInput
});

const passwordChangeBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      currentPassword: Type.Optional(
        Type.String({
          minLength: 1,
          messages: {
            default: "Current password is invalid."
          }
        })
      ),
      newPassword: Type.String({
        minLength: 8,
        messages: {
          required: "New password is required.",
          minLength: "New password must be at least 8 characters.",
          default: "New password must be at least 8 characters."
        }
      }),
      confirmPassword: Type.String({
        minLength: 1,
        messages: {
          required: "Confirm password is required.",
          minLength: "Confirm password is required.",
          default: "Confirm password is required."
        }
      })
    },
    {
      additionalProperties: false,
      messages: {
        additionalProperties: "Unexpected field."
      }
    }
  ),
  normalize: normalizeObjectInput
});

const passwordMethodToggleBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      enabled: Type.Boolean({
        messages: {
          required: "enabled is required.",
          default: "enabled must be a boolean."
        }
      })
    },
    {
      additionalProperties: false,
      messages: {
        additionalProperties: "Unexpected field."
      }
    }
  ),
  normalize: normalizeObjectInput
});

const oauthProviderParamsValidator = Object.freeze({
  schema: Type.Object(
    {
      provider: Type.String({
        minLength: 2,
        maxLength: 64,
        messages: {
          required: "OAuth provider is required.",
          default: "OAuth provider is invalid."
        }
      })
    },
    {
      additionalProperties: false,
      messages: {
        additionalProperties: "Unexpected field."
      }
    }
  ),
  normalize: normalizeOAuthProviderParams
});

const oauthProviderQueryValidator = Object.freeze({
  schema: Type.Object(
    {
      returnTo: Type.Optional(
        Type.String({
          minLength: 1,
          messages: {
            default: "Return path is invalid."
          }
        })
      )
    },
    {
      additionalProperties: false,
      messages: {
        additionalProperties: "Unexpected field."
      }
    }
  ),
  normalize: normalizeOAuthProviderQuery
});

const oauthLinkStartOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      provider: Type.String({ minLength: 2, maxLength: 64 }),
      returnTo: Type.String({ minLength: 1 }),
      url: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  normalize: normalizeObjectInput
});

const emptyBodyValidator = Object.freeze({
  schema: Type.Object({}, { additionalProperties: false }),
  normalize: normalizeObjectInput
});

const USER_SETTINGS_OPERATION_MESSAGES = createOperationMessages();

const userSettingsResource = Object.freeze({
  resource: "userSettings",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      outputValidator: userSettingsOutputValidator
    }),
    list: Object.freeze({
      method: "GET",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      outputValidator: createCursorListValidator(userSettingsOutputValidator)
    }),
    create: Object.freeze({
      method: "POST",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        get schema() {
          return buildUserSettingsCreateBodySchema();
        },
        normalize: normalizeInput
      }),
      outputValidator: userSettingsOutputValidator
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        get schema() {
          return buildUserSettingsCreateBodySchema();
        },
        normalize: normalizeInput
      }),
      outputValidator: userSettingsOutputValidator
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        get schema() {
          return buildUserSettingsPatchBodySchema();
        },
        normalize: normalizeInput
      }),
      outputValidator: userSettingsOutputValidator
    }),
    preferencesUpdate: Object.freeze({
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: preferencesUpdateBodyValidator,
      outputValidator: userSettingsOutputValidator
    }),
    notificationsUpdate: Object.freeze({
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: notificationsUpdateBodyValidator,
      outputValidator: userSettingsOutputValidator
    }),
    passwordChange: Object.freeze({
      method: "POST",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: passwordChangeBodyValidator,
      outputValidator: passwordChangeOutputValidator
    }),
    passwordMethodToggle: Object.freeze({
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: passwordMethodToggleBodyValidator,
      outputValidator: settingsActionOutputValidator
    }),
    oauthLinkStart: Object.freeze({
      method: "GET",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      paramsValidator: oauthProviderParamsValidator,
      queryValidator: oauthProviderQueryValidator,
      outputValidator: oauthLinkStartOutputValidator
    }),
    oauthUnlink: Object.freeze({
      method: "DELETE",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      paramsValidator: oauthProviderParamsValidator,
      outputValidator: settingsActionOutputValidator
    }),
    logoutOtherSessions: Object.freeze({
      method: "POST",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: emptyBodyValidator,
      outputValidator: settingsActionOutputValidator
    })
  })
});

export { userSettingsResource };
