import { onMounted, ref } from "vue";
import { confirmEmailChangeLink } from "../runtime/emailChangeLink.js";
import { useJskitText } from "../i18n.js";

/** The email change page: it confirms the link it was opened with once, then says what happened. */
export function useDefaultEmailChangeView() {
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
