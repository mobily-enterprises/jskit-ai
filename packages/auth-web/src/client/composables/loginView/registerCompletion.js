import { DEFAULT_REGISTER_CONFIRMATION_MESSAGE } from "./constants.js";

function resolveRegisterCompletionState(registerResult) {
  if (registerResult?.requiresEmailConfirmation === true) {
    const message = String(registerResult?.message || "").trim() || DEFAULT_REGISTER_CONFIRMATION_MESSAGE;
    return {
      shouldCompleteLogin: false,
      message
    };
  }

  return {
    shouldCompleteLogin: true,
    message: ""
  };
}

export { resolveRegisterCompletionState };
