import { Type } from "@fastify/type-provider-typebox";
import {
  createCommandContract,
  createResourceSchemaContract
} from "@jskit-ai/http-runtime/shared/contracts";

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

const profileAvatar = Type.Object({}, { additionalProperties: true });

const userProfileRecordSchema = Type.Object(
  {
    displayName: Type.String(),
    email: Type.String(),
    emailManagedBy: Type.Optional(Type.String()),
    emailChangeFlow: Type.Optional(Type.String()),
    avatar: Type.Optional(profileAvatar)
  },
  { additionalProperties: true }
);

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

const userProfileCreateSchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 120 })
  },
  { additionalProperties: false }
);
const userProfileReplaceSchema = userProfileCreateSchema;
const userProfilePatchSchema = Type.Partial(userProfileCreateSchema, { additionalProperties: false });

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
const userSettingsPatchSchema = Type.Partial(userSettingsCreateSchema, { additionalProperties: false });

const profileUpdateBody = userProfileReplaceSchema;
const preferencesBody = pickPatchBody(userSettingsPatchSchema, [
  "theme",
  "locale",
  "timeZone",
  "dateFormat",
  "numberFormat",
  "currencyCode",
  "avatarSize"
]);
const notificationsBody = pickPatchBody(userSettingsPatchSchema, [
  "productUpdates",
  "accountActivity",
  "securityAlerts"
]);
const chatBody = pickPatchBody(userSettingsPatchSchema, [
  "publicChatId",
  "allowWorkspaceDms",
  "allowGlobalDms",
  "requireSharedWorkspaceForGlobalDm",
  "discoverableByPublicChatId"
]);

const changePasswordBody = Type.Object(
  {
    currentPassword: Type.Optional(Type.String({ minLength: 1 })),
    newPassword: Type.String({ minLength: 8 }),
    confirmPassword: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const passwordMethodToggleBody = Type.Object(
  {
    enabled: Type.Boolean()
  },
  { additionalProperties: false }
);

const oauthCommandInput = Type.Object(
  {
    provider: Type.String({ minLength: 2, maxLength: 64 }),
    returnTo: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const oauthProviderParams = Type.Object(
  {
    provider: oauthCommandInput.properties.provider
  },
  { additionalProperties: false }
);

const oauthProviderQuery = Type.Object(
  {
    returnTo: oauthCommandInput.properties.returnTo
  },
  { additionalProperties: false }
);

const userProfileResourceContract = createResourceSchemaContract({
  record: userProfileRecordSchema,
  create: userProfileCreateSchema,
  replace: userProfileReplaceSchema,
  patch: userProfilePatchSchema
});

const userSettingsResourceContract = createResourceSchemaContract({
  record: userSettingsRecordSchema,
  create: userSettingsCreateSchema,
  replace: userSettingsReplaceSchema,
  patch: userSettingsPatchSchema
});

const passwordChangeCommandContract = createCommandContract({
  input: changePasswordBody,
  output: Type.Object(
    {
      ok: Type.Boolean(),
      message: Type.String()
    },
    { additionalProperties: false }
  ),
  idempotent: false,
  invalidates: ["settings.read"]
});

const passwordMethodToggleCommandContract = createCommandContract({
  input: passwordMethodToggleBody,
  output: Type.Object({}, { additionalProperties: true }),
  idempotent: false,
  invalidates: ["settings.read"]
});

const oauthLinkStartCommandContract = createCommandContract({
  input: oauthCommandInput,
  output: Type.Object(
    {
      provider: Type.String({ minLength: 2, maxLength: 64 }),
      returnTo: Type.String({ minLength: 1 }),
      url: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  idempotent: true
});

const oauthUnlinkCommandContract = createCommandContract({
  input: Type.Object(
    {
      provider: Type.String({ minLength: 2, maxLength: 64 })
    },
    { additionalProperties: false }
  ),
  output: Type.Object({}, { additionalProperties: true }),
  idempotent: false,
  invalidates: ["settings.read"]
});

const logoutOtherSessionsCommandContract = createCommandContract({
  input: Type.Object({}, { additionalProperties: false }),
  output: Type.Object({}, { additionalProperties: true }),
  idempotent: false
});

const avatarUploadCommandContract = createCommandContract({
  input: Type.Object(
    {
      mimeType: Type.Optional(Type.String({ minLength: 1 })),
      fileName: Type.Optional(Type.String({ minLength: 1 })),
      uploadDimension: Type.Optional(Type.String({ minLength: 1 }))
    },
    { additionalProperties: true }
  ),
  output: Type.Object({}, { additionalProperties: true }),
  idempotent: false,
  invalidates: ["settings.read"]
});

const avatarDeleteCommandContract = createCommandContract({
  input: Type.Object({}, { additionalProperties: false }),
  output: Type.Object({}, { additionalProperties: true }),
  idempotent: false,
  invalidates: ["settings.read"]
});

const schema = Object.freeze({
  body: {
    profile: profileUpdateBody,
    preferences: preferencesBody,
    notifications: notificationsBody,
    chat: chatBody,
    changePassword: passwordChangeCommandContract.input,
    passwordMethodToggle: passwordMethodToggleCommandContract.input
  },
  params: {
    oauthProvider: oauthProviderParams
  },
  query: {
    oauthProvider: oauthProviderQuery
  },
  response: userSettingsResourceContract.record,
  resourceContracts: {
    userProfile: userProfileResourceContract,
    userSettings: userSettingsResourceContract
  },
  commandContracts: {
    "settings.security.password.change": passwordChangeCommandContract,
    "settings.security.password_method.toggle": passwordMethodToggleCommandContract,
    "settings.security.oauth.link.start": oauthLinkStartCommandContract,
    "settings.security.oauth.unlink": oauthUnlinkCommandContract,
    "settings.security.sessions.logout_others": logoutOtherSessionsCommandContract,
    "settings.profile.avatar.upload": avatarUploadCommandContract,
    "settings.profile.avatar.delete": avatarDeleteCommandContract
  }
});

export { schema };
