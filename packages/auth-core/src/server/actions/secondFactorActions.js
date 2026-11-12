import { emptyInputValidator, resolveRequest } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import {
  authSecondFactorRecoveryCodesReplaceCommand,
  authSecondFactorRemoveCommand,
  authSecondFactorSetupConfirmCommand,
  authSecondFactorVerifyCommand
} from "../../shared/commands/authSecondFactorCommands.js";

const ACTION_READ_SECOND_FACTOR = "auth.secondFactor.read";
const ACTION_START_SECOND_FACTOR_SETUP = "auth.secondFactor.setup.start";
const ACTION_CONFIRM_SECOND_FACTOR_SETUP = "auth.secondFactor.setup.confirm";
const ACTION_VERIFY_SECOND_FACTOR = "auth.secondFactor.verify";
const ACTION_REPLACE_SECOND_FACTOR_RECOVERY_CODES = "auth.secondFactor.recoveryCodes.replace";
const ACTION_REMOVE_SECOND_FACTOR = "auth.secondFactor.remove";

// Only the signed-in person works with their own second factor, over HTTP or from the server's own code; codes and
// secrets never reach automation.
const SECOND_FACTOR_QUERY = Object.freeze({
  version: 1,
  kind: "query",
  channels: Object.freeze(["api", "internal"]),
  surfaces: Object.freeze(["*"])
});
const SECOND_FACTOR_COMMAND = Object.freeze({
  version: 1,
  kind: "command",
  channels: Object.freeze(["api", "internal"]),
  surfaces: Object.freeze(["*"])
});
const SIGNED_IN = Object.freeze({ require: "authenticated" });

/**
 * The second factor's actions, each one call to the installed provider's
 * auth.service for the request's own session.
 * @param {{ authService: import("../types.js").AuthService }} dependencies
 */
function createSecondFactorActions({ authService }) {
  return Object.freeze([
    Object.freeze({
      ...SECOND_FACTOR_QUERY,
      id: ACTION_READ_SECOND_FACTOR,
      input: emptyInputValidator,
      permission: SIGNED_IN,
      execute: (input, context) => authService.getSecondFactorStatus(resolveRequest(context))
    }),
    Object.freeze({
      ...SECOND_FACTOR_COMMAND,
      id: ACTION_START_SECOND_FACTOR_SETUP,
      input: emptyInputValidator,
      permission: SIGNED_IN,
      execute: (input, context) => authService.startSecondFactorSetup(resolveRequest(context))
    }),
    Object.freeze({
      ...SECOND_FACTOR_COMMAND,
      id: ACTION_CONFIRM_SECOND_FACTOR_SETUP,
      input: authSecondFactorSetupConfirmCommand.operation.body,
      permission: SIGNED_IN,
      execute: (input, context) => authService.confirmSecondFactorSetup(resolveRequest(context), input)
    }),
    Object.freeze({
      ...SECOND_FACTOR_COMMAND,
      id: ACTION_VERIFY_SECOND_FACTOR,
      input: authSecondFactorVerifyCommand.operation.body,
      permission: SIGNED_IN,
      execute: (input, context) => authService.verifySecondFactor(resolveRequest(context), input)
    }),
    Object.freeze({
      ...SECOND_FACTOR_COMMAND,
      id: ACTION_REPLACE_SECOND_FACTOR_RECOVERY_CODES,
      input: authSecondFactorRecoveryCodesReplaceCommand.operation.body,
      permission: SIGNED_IN,
      execute: (input, context) => authService.replaceSecondFactorRecoveryCodes(resolveRequest(context), input)
    }),
    Object.freeze({
      ...SECOND_FACTOR_COMMAND,
      id: ACTION_REMOVE_SECOND_FACTOR,
      input: authSecondFactorRemoveCommand.operation.body,
      permission: SIGNED_IN,
      execute: (input, context) => authService.removeSecondFactor(resolveRequest(context), input)
    })
  ]);
}

export {
  ACTION_CONFIRM_SECOND_FACTOR_SETUP,
  ACTION_READ_SECOND_FACTOR,
  ACTION_REMOVE_SECOND_FACTOR,
  ACTION_REPLACE_SECOND_FACTOR_RECOVERY_CODES,
  ACTION_START_SECOND_FACTOR_SETUP,
  ACTION_VERIFY_SECOND_FACTOR,
  createSecondFactorActions
};
