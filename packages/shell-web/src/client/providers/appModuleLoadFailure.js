import {
  isDynamicImportError
} from "@jskit-ai/kernel/client/asyncModuleRecovery";

function isMissingDynamicModule(error, moduleSpecifier) {
  const message = String(error?.message || error || "");
  return (
    message.includes(moduleSpecifier) &&
    (message.includes("Cannot find module") ||
      message.includes("ERR_MODULE_NOT_FOUND"))
  );
}

function notifyDynamicImportFailure(asyncModuleRecoveryRuntime, error, {
  label = "App module"
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
