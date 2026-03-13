import {
  createCommandMessages,
  sessionResponseSchema,
  sessionUnavailableResponseSchema
} from "./authCommandSchemas.js";

const authSessionReadOutputSchema = sessionResponseSchema;
const authSessionReadUnavailableResponseSchema = sessionUnavailableResponseSchema;

const AUTH_SESSION_READ_MESSAGES = createCommandMessages();

const authSessionReadCommand = Object.freeze({
  command: "auth.session.read",
  operation: Object.freeze({
    method: "GET",
    response: Object.freeze({
      schema: authSessionReadOutputSchema
    }),
    messages: AUTH_SESSION_READ_MESSAGES,
    idempotent: true,
    invalidates: Object.freeze([])
  })
});

export {
  authSessionReadOutputSchema,
  authSessionReadUnavailableResponseSchema,
  AUTH_SESSION_READ_MESSAGES,
  authSessionReadCommand
};
