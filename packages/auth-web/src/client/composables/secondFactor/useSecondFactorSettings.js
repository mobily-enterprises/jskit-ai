import { computed, onMounted, ref } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { pageClipboard, saveTextFile } from "../../browser.js";
import { useJskitText } from "../../i18n.js";
import { qrCodePath } from "../../lib/qrCode.js";
import { readSecondFactor, startSecondFactorSetup } from "../../runtime/secondFactorRequests.js";

const SOURCE = "auth-web.second-factor-settings";
const RECOVERY_CODES_FILE = "recovery-codes.txt";

/**
 * The signed-in person's authenticator app: its state, read on mount (`load` is "loading", "ready" or "error"), and
 * the step shown: "status", "setup" (the secret, once, and its first code), "codes" (new recovery codes, once), or
 * "replaceCodes" and "remove", which each ask for a proof.
 */
function useSecondFactorSettings() {
  const { serverMessage, t } = useJskitText();
  const errorRuntime = useShellWebErrorRuntime();
  const load = ref("loading");
  /** @type {import("vue").Ref<import("../../types.js").SecondFactorStatus | null>} */
  const status = ref(null);
  const step = ref("status");
  /** @type {import("vue").Ref<import("../../types.js").SecondFactorSetup | null>} */
  const setup = ref(null);
  /** @type {import("vue").Ref<string[]>} */
  const recoveryCodes = ref([]);
  const starting = ref(false);
  const canCopy = Boolean(pageClipboard());
  const qrCode = computed(() => (setup.value ? qrCodePath(setup.value.otpauthUrl) : null));
  // The secret in groups of four, as a person reads it out to type it.
  const secretText = computed(() => (setup.value ? setup.value.secret.replace(/(.{4})(?=.)/gu, "$1 ") : ""));

  function report(message, severity) {
    errorRuntime.report({
      source: SOURCE,
      message,
      severity,
      channel: "snackbar",
      dedupeKey: `${SOURCE}:${message}`,
      dedupeWindowMs: 3000
    });
  }

  async function reload() {
    load.value = "loading";
    try {
      status.value = await readSecondFactor();
      load.value = "ready";
    } catch {
      load.value = "error";
    }
  }

  async function startSetup() {
    starting.value = true;
    try {
      setup.value = await startSecondFactorSetup();
      step.value = "setup";
    } catch (error) {
      report(serverMessage(error, t("jskit.auth.secondFactor.settings.startFailed")), "error");
    } finally {
      starting.value = false;
    }
  }

  /** Shows new recovery codes, once, and reads the state again behind them. */
  function showRecoveryCodes(/** @type {import("../../types.js").SecondFactorRecoveryCodes} */ result) {
    recoveryCodes.value = result.recoveryCodes;
    setup.value = null;
    step.value = "codes";
    void reload();
  }

  function codesSaved() {
    recoveryCodes.value = [];
    step.value = "status";
  }

  function removed() {
    step.value = "status";
    report(t("jskit.auth.secondFactor.settings.removed"), "success");
    void reload();
  }

  /** @param {"status" | "replaceCodes" | "remove"} name */
  function showStep(name) {
    setup.value = null;
    step.value = name;
  }

  /** @param {string} text */
  async function copy(text) {
    try {
      await pageClipboard().writeText(text);
      report(t("jskit.auth.secondFactor.copied"), "success");
    } catch {
      report(t("jskit.auth.secondFactor.copyFailed"), "error");
    }
  }

  /** Saves the recovery codes shown as a text file, one code a line, for a person who keeps them as a file. */
  function download() {
    saveTextFile(RECOVERY_CODES_FILE, `${recoveryCodes.value.join("\n")}\n`);
  }

  onMounted(reload);

  return {
    load,
    status,
    step,
    setup,
    qrCode,
    secretText,
    recoveryCodes,
    starting,
    canCopy,
    reload,
    startSetup,
    showRecoveryCodes,
    codesSaved,
    removed,
    showStep,
    copy,
    download
  };
}

export { useSecondFactorSettings };
