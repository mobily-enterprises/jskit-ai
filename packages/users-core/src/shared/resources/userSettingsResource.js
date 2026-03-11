import { Type } from "typebox";
import {
  createCursorListValidator,
  normalizeObjectInput
} from "@jskit-ai/kernel/shared/contracts";
import { createOperationMessages } from "../contractUtils.js";
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
    })
  })
});

export { userSettingsResource };
