import {
  createCommandMessages,
  sessionResponseValidator,
  sessionUnavailableResponseValidator
} from "./authCommandValidators.js";

const AUTH_SESSION_READ_MESSAGES = createCommandMessages();

const authSessionReadCommand = Object.freeze({
  command: "auth.session.read",
  operation: Object.freeze({
    method: "GET",
    response: sessionResponseValidator,
    unavailableResponse: sessionUnavailableResponseValidator,
    messages: AUTH_SESSION_READ_MESSAGES,
    idempotent: true,
    invalidates: Object.freeze([])
  })
});

export {
  sessionResponseValidator,
  sessionUnavailableResponseValidator,
  AUTH_SESSION_READ_MESSAGES,
  authSessionReadCommand
};
