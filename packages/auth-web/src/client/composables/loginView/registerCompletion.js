import { useJskitText } from "../../i18n.js";

function resolveRegisterCompletionState(registerResult) {
  if (registerResult?.requiresEmailConfirmation === true) {
    const { serverMessage, t } = useJskitText();
    const message = serverMessage(registerResult).trim() || t("jskit.auth.register.confirmEmail");
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
