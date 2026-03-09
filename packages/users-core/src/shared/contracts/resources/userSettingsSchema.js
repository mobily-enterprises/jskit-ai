import { Type } from "typebox";
import { createOperationMessages } from "../contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { userProfileRecordSchema } from "./userProfileSchema.js";

function pickPatchBody(schema, keys = []) {
  const properties = {};
  for (const key of keys) {
    if (!Object.hasOwn(schema.properties, key)) {
      throw new Error(`pickPatchBody requires patch field \"${key}\".`);
    }

    properties[key] = schema.properties[key];
  }

  return Type.Object(properties, {
    additionalProperties: false,
    minProperties: 1
  });
}

const securityRecordSchema = Type.Object({}, { additionalProperties: true });

const preferencesRecordSchema = Type.Object(
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
);

const notificationsRecordSchema = Type.Object(
  {
    productUpdates: Type.Boolean(),
    accountActivity: Type.Boolean(),
    securityAlerts: Type.Boolean()
  },
  { additionalProperties: true }
);

const chatRecordSchema = Type.Object({}, { additionalProperties: true });

const userSettingsRecordSchema = Type.Object(
  {
    profile: userProfileRecordSchema,
    security: securityRecordSchema,
    preferences: preferencesRecordSchema,
    notifications: notificationsRecordSchema,
    chat: chatRecordSchema
  },
  { additionalProperties: true }
);

const userSettingsCreateSchema = Type.Object(
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

const userSettingsReplaceSchema = userSettingsCreateSchema;
const userSettingsPatchSchema = Type.Partial(userSettingsCreateSchema, {
  additionalProperties: false
});

const preferencesPatchBodySchema = pickPatchBody(userSettingsPatchSchema, [
  "theme",
  "locale",
  "timeZone",
  "dateFormat",
  "numberFormat",
  "currencyCode",
  "avatarSize"
]);

const notificationsPatchBodySchema = pickPatchBody(userSettingsPatchSchema, [
  "productUpdates",
  "accountActivity",
  "securityAlerts"
]);

const chatPatchBodySchema = pickPatchBody(userSettingsPatchSchema, [
  "publicChatId",
  "allowWorkspaceDms",
  "allowGlobalDms",
  "requireSharedWorkspaceForGlobalDm",
  "discoverableByPublicChatId"
]);

const userSettingsListSchema = Type.Object(
  {
    items: Type.Array(userSettingsRecordSchema),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);

const USER_SETTINGS_OPERATION_MESSAGES = createOperationMessages();

const userSettingsSchema = Object.freeze({
  resource: "userSettings",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      response: Object.freeze({
        schema: userSettingsRecordSchema
      })
    }),
    list: Object.freeze({
      method: "GET",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      response: Object.freeze({
        schema: userSettingsListSchema
      })
    }),
    create: Object.freeze({
      method: "POST",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: userSettingsCreateSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: userSettingsRecordSchema
      })
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: userSettingsReplaceSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: userSettingsRecordSchema
      })
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: USER_SETTINGS_OPERATION_MESSAGES,
      body: Object.freeze({
        schema: userSettingsPatchSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: userSettingsRecordSchema
      })
    })
  })
});

export {
  securityRecordSchema,
  preferencesRecordSchema,
  notificationsRecordSchema,
  chatRecordSchema,
  userSettingsRecordSchema,
  userSettingsCreateSchema,
  userSettingsReplaceSchema,
  userSettingsPatchSchema,
  preferencesPatchBodySchema,
  notificationsPatchBodySchema,
  chatPatchBodySchema,
  userSettingsListSchema,
  userSettingsSchema
};
