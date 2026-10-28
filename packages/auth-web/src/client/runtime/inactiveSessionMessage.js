import { resolveAuthDeniedLoginText } from "@jskit-ai/auth-core/shared/authDenied";
import { useJskitText } from "../i18n.js";

// Why a sign-in that succeeded left no active session: the account's denial,
// or a hint to retry.
function inactiveSessionMessage(session) {
  const { serverMessage, t } = useJskitText();
  const denied = resolveAuthDeniedLoginText(session?.authDenied);
  return denied ? serverMessage(denied) : t("jskit.auth.login.error.sessionNotActive");
}

export { inactiveSessionMessage };
