import {
  createCommandMessages,
  logoutResponseValidator
} from "./authCommandValidators.js";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const AUTH_LOGOUT_MESSAGES = createCommandMessages();

const authLogoutCommand = deepFreeze({
  command: "auth.logout",
  operation: {
    method: "POST",
    response: logoutResponseValidator,
    messages: AUTH_LOGOUT_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export {
  logoutResponseValidator,
  AUTH_LOGOUT_MESSAGES,
  authLogoutCommand
};
