import {
  createCommandMessages,
  logoutResponseSchema
} from "./authCommandSchemas.js";

const authLogoutOutputSchema = logoutResponseSchema;

const AUTH_LOGOUT_MESSAGES = createCommandMessages();

const authLogoutCommand = Object.freeze({
  command: "auth.logout",
  operation: Object.freeze({
    method: "POST",
    response: Object.freeze({
      schema: authLogoutOutputSchema
    }),
    messages: AUTH_LOGOUT_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authLogoutOutputSchema,
  AUTH_LOGOUT_MESSAGES,
  authLogoutCommand
};
