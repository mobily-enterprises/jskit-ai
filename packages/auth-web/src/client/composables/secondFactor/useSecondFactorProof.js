import { computed, ref } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { useJskitText } from "../../i18n.js";

// Refusals of what the person typed (a wrong, used or missing code, or an account waiting after wrong codes) show
// beside the field; any other failure is reported as a failed command.
const FIELD_REFUSAL_STATUSES = Object.freeze([400, 409, 429]);
const SOURCE = "auth-web.second-factor";

/**
 * A form for a code from the authenticator app or one of the recovery codes: what the person typed, the refusal shown
 * beside the field, and the submission, which hands `submit`'s answer to `onDone`.
 * @param {{
 *   submit: (proof: import("../../types.js").SecondFactorProof) => Promise<unknown>,
 *   onDone: (result: unknown) => void
 * }} options
 */
function useSecondFactorProof({ submit, onDone }) {
  const { fieldErrorMessages, serverMessage, t } = useJskitText();
  const errorRuntime = useShellWebErrorRuntime();
  const usingRecoveryCode = ref(false);
  const code = ref("");
  const recoveryCode = ref("");
  const fieldError = ref("");
  const pending = ref(false);
  const typed = computed(() => (usingRecoveryCode.value ? recoveryCode.value : code.value).trim());
  const canSubmit = computed(() => typed.value.length > 0 && !pending.value);

  function toggleRecoveryCode() {
    usingRecoveryCode.value = !usingRecoveryCode.value;
    fieldError.value = "";
  }

  async function submitProof() {
    if (!canSubmit.value) {
      return;
    }
    const field = usingRecoveryCode.value ? "recoveryCode" : "code";
    pending.value = true;
    fieldError.value = "";
    let result;
    try {
      result = await submit({ [field]: typed.value });
    } catch (error) {
      const message = fieldErrorMessages(error)[field] || serverMessage(error, t("jskit.auth.secondFactor.form.failed"));
      if (FIELD_REFUSAL_STATUSES.includes(error.status)) {
        fieldError.value = message;
      } else {
        errorRuntime.report({
          source: SOURCE,
          message,
          severity: "error",
          channel: "snackbar",
          dedupeKey: `${SOURCE}:${message}`,
          dedupeWindowMs: 3000
        });
      }
      return;
    } finally {
      pending.value = false;
    }
    code.value = "";
    recoveryCode.value = "";
    onDone(result);
  }

  return {
    usingRecoveryCode,
    code,
    recoveryCode,
    fieldError,
    pending,
    canSubmit,
    toggleRecoveryCode,
    submitProof
  };
}

export { useSecondFactorProof };
