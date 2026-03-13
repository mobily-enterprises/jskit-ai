import { Type } from "typebox";
import {
  createCursorListValidator,
  normalizeObjectInput
} from "@jskit-ai/kernel/shared/contracts";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createOperationMessages } from "../operationMessages.js";
import { userProfileResource } from "./userProfileResource.js";

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

const userSettingsOutputSchema = Type.Object(
  {
    profile: userProfileResource.operations.view.output.schema,
    security: Type.Object({}, { additionalProperties: true }),
    preferences: Type.Object(
      {
        theme: Type.String(),
        locale: Type.String(),
        timeZone: Type.String(),
        dateFormat: Type.String(),
        numberFormat: Type.String(),
        currencyCode: Type.String(),
        avatarSize: Type.Integer({ minimum: 1 })
      },
      { additionalProperties: true }
    ),
    notifications: Type.Object(
      {
        productUpdates: Type.Boolean(),
        accountActivity: Type.Boolean(),
        securityAlerts: Type.Boolean()
      },
      { additionalProperties: true }
    ),
    chat: Type.Object({}, { additionalProperties: true })
  },
  { additionalProperties: true }
);

const userSettingsOutputValidator = Object.freeze({
  schema: userSettingsOutputSchema,
  normalize: normalizeObjectInput
});

const userSettingsCreateBodySchema = Type.Object(
  {
    theme: Type.String({ minLength: 1 }),
    locale: Type.String({ minLength: 1 }),
    timeZone: Type.String({ minLength: 1 }),
    dateFormat: Type.String({ minLength: 1 }),
    numberFormat: Type.String({ minLength: 1 }),
    currencyCode: Type.String({ minLength: 1 }),
    avatarSize: Type.Integer({ minimum: 1 }),
    productUpdates: Type.Boolean(),
    accountActivity: Type.Boolean(),
    securityAlerts: Type.Boolean(),
    publicChatId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    allowWorkspaceDms: Type.Boolean(),
    allowGlobalDms: Type.Boolean(),
    requireSharedWorkspaceForGlobalDm: Type.Boolean(),
    discoverableByPublicChatId: Type.Boolean()
  },
  { additionalProperties: false }
);

const userSettingsPatchBodySchema = Type.Partial(userSettingsCreateBodySchema, {
  additionalProperties: false,
  minProperties: 1
});

const preferencesUpdateBodyValidator = Object.freeze({
  schema: pickPatchBody(userSettingsPatchBodySchema, [
    "theme",
    "locale",
    "timeZone",
    "dateFormat",
    "numberFormat",
    "currencyCode",
    "avatarSize"
  ]),
  normalize: normalizeObjectInput
});

const notificationsUpdateBodyValidator = Object.freeze({
  schema: pickPatchBody(userSettingsPatchBodySchema, [
    "productUpdates",
    "accountActivity",
    "securityAlerts"
  ]),
  normalize: normalizeObjectInput
});

const chatUpdateBodyValidator = Object.freeze({
  schema: pickPatchBody(userSettingsPatchBodySchema, [
    "publicChatId",
    "allowWorkspaceDms",
    "allowGlobalDms",
    "requireSharedWorkspaceForGlobalDm",
    "discoverableByPublicChatId"
  ]),
  normalize: normalizeObjectInput
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
      output: userSettingsOutputValidator
    }),
    list: Object.freeze({
      method: "GET",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      output: createCursorListValidator(userSettingsOutputValidator)
    }),
    create: Object.freeze({
      method: "POST",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: userSettingsCreateBodySchema,
        normalize: normalizeObjectInput
      }),
      output: userSettingsOutputValidator
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: userSettingsCreateBodySchema,
        normalize: normalizeObjectInput
      }),
      output: userSettingsOutputValidator
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: userSettingsPatchBodySchema,
        normalize: normalizeObjectInput
      }),
      output: userSettingsOutputValidator
    }),
    preferencesUpdate: Object.freeze({
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: preferencesUpdateBodyValidator,
      output: userSettingsOutputValidator
    }),
    notificationsUpdate: Object.freeze({
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: notificationsUpdateBodyValidator,
      output: userSettingsOutputValidator
    }),
    chatUpdate: Object.freeze({
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: chatUpdateBodyValidator,
      output: userSettingsOutputValidator
    }),
    passwordChange: Object.freeze({
      method: "POST",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: passwordChangeBodyValidator,
      output: passwordChangeOutputValidator
    }),
    passwordMethodToggle: Object.freeze({
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: passwordMethodToggleBodyValidator,
      output: settingsActionOutputValidator
    }),
    oauthLinkStart: Object.freeze({
      method: "GET",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      params: oauthProviderParamsValidator,
      query: oauthProviderQueryValidator,
      output: oauthLinkStartOutputValidator
    }),
    oauthUnlink: Object.freeze({
      method: "DELETE",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      params: oauthProviderParamsValidator,
      output: settingsActionOutputValidator
    }),
    logoutOtherSessions: Object.freeze({
      method: "POST",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: emptyBodyValidator,
      output: settingsActionOutputValidator
    })
  })
});

export { userSettingsResource };
