import { computed, unref } from "vue";
import { useRoute } from "vue-router";
import { useCrudAddEdit } from "./records/useCrudAddEdit.js";
import { useCrudFormNavigationBlocker } from "./useCrudFormNavigationBlocker.js";

function normalizeProvidedScreen(screen = null) {
  return screen && typeof screen === "object" && !Array.isArray(screen)
    ? screen
    : null;
}

function useCrudAddEditScreen({
  screen = null,
  mode = "new",
  title = "",
  subtitle = "",
  saveLabel = "Save",
  navigationBlockerId = "",
  cancelTo = "",
  resource = null,
  operationName = "",
  formFields = [],
  addEditOptions = {},
  saveSuccess = {},
  fieldBinding = null,
  createModel = null,
  buildPayload = null,
  mapPayloadToModel = null,
  input = null,
  preserveCancelQuery = false
} = {}) {
  const providedScreen = normalizeProvidedScreen(screen);
  if (providedScreen) {
    return providedScreen;
  }

  const route = useRoute();
  const formRuntime = useCrudAddEdit({
    resource,
    operationName,
    formFields,
    addEditOptions,
    saveSuccess,
    fieldBinding,
    createModel,
    buildPayload,
    mapPayloadToModel,
    input
  });
  const resolvedMode = computed(() => String(unref(mode) || "new").trim() || "new");
  const resolvedTitle = computed(() => String(unref(title) || "").trim());
  const resolvedSubtitle = computed(() => String(unref(subtitle) || "").trim());
  const resolvedSaveLabel = computed(() => String(unref(saveLabel) || "Save").trim() || "Save");
  const resolvedNavigationBlockerId = String(unref(navigationBlockerId) || "").trim();
  if (resolvedNavigationBlockerId) {
    useCrudFormNavigationBlocker({
      id: resolvedNavigationBlockerId,
      isDirty: () => Boolean(formRuntime.isDirty)
    });
  }
  const resolvedCancelTo = computed(() => unref(cancelTo));

  function resolveCancelTo(target = resolvedCancelTo.value) {
    const resolvedTarget = unref(target);
    if (!resolvedTarget) {
      return "";
    }

    if (typeof resolvedTarget === "string") {
      const resolvedPath = formRuntime.addEdit.resolveParams(resolvedTarget);
      if (!preserveCancelQuery || !resolvedPath) {
        return resolvedPath;
      }
      return {
        path: resolvedPath,
        query: route.query
      };
    }

    return resolvedTarget;
  }

  async function cancel() {
    return formRuntime.navigateFromMachinery(resolveCancelTo(), { reason: "programmatic" });
  }

  return Object.freeze({
    mode: resolvedMode,
    title: resolvedTitle,
    subtitle: resolvedSubtitle,
    saveLabel: resolvedSaveLabel,
    navigationBlockerId: resolvedNavigationBlockerId,
    cancelTo: resolvedCancelTo,
    formRuntime,
    addEdit: formRuntime.addEdit,
    formState: formRuntime.form,
    resolveFieldErrors: formRuntime.resolveFieldErrors,
    resolveCancelTo,
    cancel
  });
}

export { useCrudAddEditScreen };
