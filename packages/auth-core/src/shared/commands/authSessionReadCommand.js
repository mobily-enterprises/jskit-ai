import {
  createCommandMessages,
  sessionResponseValidator,
  sessionUnavailableResponseValidator
} from "./authCommandValidators.js";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const AUTH_SESSION_READ_MESSAGES = createCommandMessages();

const authSessionReadCommand = deepFreeze({
  command: "auth.session.read",
  operation: {
    method: "GET",
    response: sessionResponseValidator,
    unavailableResponse: sessionUnavailableResponseValidator,
    messages: AUTH_SESSION_READ_MESSAGES,
    idempotent: true,
    invalidates: []
  }
});

export {
  sessionResponseValidator,
  sessionUnavailableResponseValidator,
  AUTH_SESSION_READ_MESSAGES,
  authSessionReadCommand
};
