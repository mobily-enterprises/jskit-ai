import {
  createCommandMessages,
  sessionOutputValidator,
  sessionUnavailableOutputValidator
} from "./authCommandValidators.js";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const AUTH_SESSION_READ_MESSAGES = createCommandMessages();

const authSessionReadCommand = deepFreeze({
  command: "auth.session.read",
  operation: {
    method: "GET",
    response: sessionOutputValidator,
    unavailableResponse: sessionUnavailableOutputValidator,
    messages: AUTH_SESSION_READ_MESSAGES,
    idempotent: true,
    invalidates: []
  }
});

export {
  sessionOutputValidator,
  sessionUnavailableOutputValidator,
  AUTH_SESSION_READ_MESSAGES,
  authSessionReadCommand
};
