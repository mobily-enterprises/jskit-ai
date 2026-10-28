import {
  isDynamicImportError
} from "@jskit-ai/kernel/client/asyncModuleRecovery";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

function isMissingDynamicModule(error, moduleSpecifier) {
  const message = String(error?.message || error || "");
  return (
    message.includes(moduleSpecifier) &&
    (message.includes("Cannot find module") ||
      message.includes("ERR_MODULE_NOT_FOUND"))
  );
}

function notifyDynamicImportFailure(asyncModuleRecoveryRuntime, error, {
  label = t("jskit.shell.recovery.appModuleLabel")
} = {}) {
  if (!isDynamicImportError(error) || typeof asyncModuleRecoveryRuntime?.notify !== "function") {
    return;
  }

  asyncModuleRecoveryRuntime.notify(error, {
    label
  });
}

export {
  isMissingDynamicModule,
  notifyDynamicImportFailure
};
