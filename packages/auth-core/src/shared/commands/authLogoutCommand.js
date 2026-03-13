import {
  createCommandMessages,
  logoutResponseValidator
} from "./authCommandValidators.js";

const AUTH_LOGOUT_MESSAGES = createCommandMessages();

const authLogoutCommand = Object.freeze({
  command: "auth.logout",
  operation: Object.freeze({
    method: "POST",
    responseValidator: logoutResponseValidator,
    messages: AUTH_LOGOUT_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  logoutResponseValidator,
  AUTH_LOGOUT_MESSAGES,
  authLogoutCommand
};
