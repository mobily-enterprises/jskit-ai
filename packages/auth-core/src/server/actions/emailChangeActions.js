import { resolveRequest } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import {
  authEmailChangeConfirmCommand,
  authEmailChangeRequestCommand
} from "../../shared/commands/authEmailChangeCommands.js";

const ACTION_REQUEST_EMAIL_CHANGE = "auth.emailChange.request";
const ACTION_CONFIRM_EMAIL_CHANGE = "auth.emailChange.confirm";

// Over HTTP or from the server's own code; a password or a link never reaches automation.
const EMAIL_CHANGE_COMMAND = Object.freeze({
  version: 1,
  kind: "command",
  channels: Object.freeze(["api", "internal"]),
  surfaces: Object.freeze(["*"])
});

/**
 * The email change's actions, each one call to the installed provider's auth.service: the signed-in person asks for
 * their own change, and whoever opens the link sent to the new address confirms it, signed in or not. An
 * application's change of an account it chose is auth.service's requestEmailChangeForUser, called by its own code
 * after its own permission check.
 * @param {{ authService: import("../types.js").AuthService }} dependencies
 */
function createEmailChangeActions({ authService }) {
  return Object.freeze([
    Object.freeze({
      ...EMAIL_CHANGE_COMMAND,
      id: ACTION_REQUEST_EMAIL_CHANGE,
      input: authEmailChangeRequestCommand.operation.body,
      permission: Object.freeze({ require: "authenticated" }),
      execute: (input, context) => authService.requestEmailChange(resolveRequest(context), input)
    }),
    Object.freeze({
      ...EMAIL_CHANGE_COMMAND,
      id: ACTION_CONFIRM_EMAIL_CHANGE,
      input: authEmailChangeConfirmCommand.operation.body,
      execute: (input) => authService.confirmEmailChange(input)
    })
  ]);
}

export { ACTION_CONFIRM_EMAIL_CHANGE, ACTION_REQUEST_EMAIL_CHANGE, createEmailChangeActions };
