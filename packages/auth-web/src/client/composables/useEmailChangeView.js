import { onMounted, ref } from "vue";
import { confirmEmailChangeLink } from "../runtime/emailChangeLink.js";
import { useJskitText } from "../i18n.js";

/**
 * The email change page without its look: it confirms the link it was opened with once (`status` "checking", then
 * "done" or "error"), and `message` says what happened. `DefaultEmailChangeView` renders it in Material 3; an app with
 * its own design system renders it in its own (`@jskit-ai/auth-web/client/composables/useEmailChangeView`).
 */
export function useEmailChangeView() {
  const { serverMessage, t } = useJskitText();
  const status = ref("checking");
  const message = ref("");

  async function confirmLink() {
    const result = await confirmEmailChangeLink(window.location.href);
    // The link works once: it leaves the address bar and the history.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    status.value = result.status === "done" ? "done" : "error";
    if (result.status === "done") {
      message.value = t("jskit.auth.emailChange.done", { email: result.email });
    } else if (result.status === "missing") {
      message.value = t("jskit.auth.emailChange.linkMissing");
    } else {
      message.value = serverMessage(result.error, t("jskit.auth.emailChange.failed"));
    }
  }

  onMounted(confirmLink);

  return { status, message };
}
