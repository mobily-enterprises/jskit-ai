import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";

const settingsOAuthProviderSchema = Type.String({ minLength: 2, maxLength: 64 });
const settingsOAuthReturnToSchema = Type.Optional(Type.String({ minLength: 1 }));

const settingsOAuthLinkStartInputSchema = Type.Object(
  {
    provider: settingsOAuthProviderSchema,
    returnTo: settingsOAuthReturnToSchema
  },
  { additionalProperties: false }
);

const settingsOAuthLinkStartOutputSchema = Type.Object(
  {
    provider: Type.String({ minLength: 2, maxLength: 64 }),
    returnTo: Type.String({ minLength: 1 }),
    url: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const settingsOAuthProviderParamsSchema = Type.Object(
  {
    provider: settingsOAuthProviderSchema
  },
  { additionalProperties: false }
);

const settingsOAuthProviderQuerySchema = Type.Object(
  {
    returnTo: settingsOAuthReturnToSchema
  },
  { additionalProperties: false }
);

const settingsOAuthLinkStartCommand = Object.freeze({
  command: "settings.security.oauth.link.start",
  operation: Object.freeze({
    method: "GET",
    params: Object.freeze({
      schema: settingsOAuthProviderParamsSchema,
      normalize: normalizeObjectInput
    }),
    query: Object.freeze({
      schema: settingsOAuthProviderQuerySchema,
      normalize: normalizeObjectInput
    }),
    response: Object.freeze({
      schema: settingsOAuthLinkStartOutputSchema
    }),
    idempotent: true,
    invalidates: Object.freeze([])
  })
});

export {
  settingsOAuthProviderSchema,
  settingsOAuthReturnToSchema,
  settingsOAuthProviderParamsSchema,
  settingsOAuthProviderQuerySchema,
  settingsOAuthLinkStartInputSchema,
  settingsOAuthLinkStartOutputSchema,
  settingsOAuthLinkStartCommand
};
