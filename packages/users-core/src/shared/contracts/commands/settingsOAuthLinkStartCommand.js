import { Type } from "typebox";
import { createOperationMessages } from "../contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";

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

const SETTINGS_OAUTH_LINK_START_MESSAGES = createOperationMessages({
  fields: {
    provider: {
      required: "OAuth provider is required.",
      default: "OAuth provider is invalid."
    },
    returnTo: {
      default: "Return path is invalid."
    }
  }
});

const settingsOAuthLinkStartCommand = Object.freeze({
  command: "settings.security.oauth.link.start",
  operation: Object.freeze({
    method: "GET",
    messages: SETTINGS_OAUTH_LINK_START_MESSAGES,
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
  SETTINGS_OAUTH_LINK_START_MESSAGES,
  settingsOAuthLinkStartCommand
};
