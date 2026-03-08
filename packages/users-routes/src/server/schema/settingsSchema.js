import { Type } from "@fastify/type-provider-typebox";

const settingsResponse = Type.Object({}, { additionalProperties: true });

const profileUpdateBody = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 120 })
  },
  { additionalProperties: false }
);

const preferencesBody = Type.Object({}, { additionalProperties: true, minProperties: 1 });
const notificationsBody = Type.Object({}, { additionalProperties: true, minProperties: 1 });
const chatBody = Type.Object({}, { additionalProperties: true, minProperties: 1 });

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

const oauthProviderParams = Type.Object(
  {
    provider: Type.String({ minLength: 2, maxLength: 64 })
  },
  { additionalProperties: false }
);

const oauthProviderQuery = Type.Object(
  {
    returnTo: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const schema = Object.freeze({
  body: {
    profile: profileUpdateBody,
    preferences: preferencesBody,
    notifications: notificationsBody,
    chat: chatBody,
    changePassword: changePasswordBody,
    passwordMethodToggle: passwordMethodToggleBody
  },
  params: {
    oauthProvider: oauthProviderParams
  },
  query: {
    oauthProvider: oauthProviderQuery
  },
  response: settingsResponse
});

export { schema };
