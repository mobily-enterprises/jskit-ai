import { computed, proxyRefs, ref, unref } from "vue";
import { useRouter } from "vue-router";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudJsonApiTransport } from "./crud/crudJsonApiTransportSupport.js";
import { toQueryErrorMessage } from "./support/errorMessageHelpers.js";
import { useCommand } from "./useCommand.js";

function requireCrudDeleteOperation(resource = null) {
  const operation = resource?.operations?.delete;
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new TypeError("useCrudDeleteAction requires resource.operations.delete.");
  }
  if (normalizeText(operation.method).toUpperCase() !== "DELETE") {
    throw new TypeError("useCrudDeleteAction requires resource.operations.delete.method to be DELETE.");
  }
  return operation;
}

function requireCrudViewScreen(screen = null) {
  if (!screen || typeof screen !== "object" || typeof screen?.view?.resolveParams !== "function") {
    throw new TypeError("useCrudDeleteAction requires a useCrudViewScreen() result.");
  }
  return screen;
}

function resolveDeleteApiSuffix(screen, apiUrlTemplate = "") {
  const template = normalizeText(unref(apiUrlTemplate));
  return template ? normalizeText(screen.view.resolveParams(template)) : "";
}

function resolveListLocation(screen) {
  return unref(screen?.listLocation) || null;
}

function useCrudDeleteAction({
  screen = null,
  resource = null,
  resourceNamespace = "",
  apiUrlTemplate = "",
  access = "auto",
  client = null,
  router: routerOverride = null,
  fallbackDeleteError = "Unable to delete record."
} = {}) {
  const resolvedScreen = requireCrudViewScreen(screen);
  const deleteOperation = requireCrudDeleteOperation(resource);
  const namespace = normalizeText(resourceNamespace, {
    fallback: resource?.namespace
  });
  if (!namespace) {
    throw new TypeError("useCrudDeleteAction requires resourceNamespace or resource.namespace.");
  }

  const activeRouter = routerOverride || useRouter();
  if (!activeRouter || typeof activeRouter.push !== "function") {
    throw new TypeError("useCrudDeleteAction requires an installed Vue Router.");
  }

  const isOpen = ref(false);
  const error = ref("");
  const deleteApiSuffix = computed(() => resolveDeleteApiSuffix(resolvedScreen, apiUrlTemplate));

  async function handleDeleteSuccess(_response, context = {}) {
    await context?.queryClient?.invalidateQueries?.({
      queryKey: ["crud", namespace]
    });

    const listLocation = resolveListLocation(resolvedScreen);
    if (!listLocation) {
      throw new Error("Deleted the record, but the generated list route is unavailable.");
    }

    isOpen.value = false;
    await activeRouter.push(listLocation);
  }

  function handleDeleteError(cause) {
    error.value = toQueryErrorMessage(
      cause,
      fallbackDeleteError,
      "Unable to delete record."
    );
  }

  const command = useCommand({
    access,
    apiSuffix: deleteApiSuffix,
    writeMethod: deleteOperation.method,
    client,
    transport: resolveCrudJsonApiTransport(undefined, resource, {
      mode: "delete"
    }),
    placementSource: `crud.${namespace}.view.delete`,
    fallbackRunError: fallbackDeleteError,
    onRunSuccess: handleDeleteSuccess,
    onRunError: handleDeleteError,
    suppressSuccessMessage: true
  });

  const isDeleting = computed(() => Boolean(command.isRunning));
  const canDelete = computed(() => {
    const view = resolvedScreen.view;
    return Boolean(
      command.canRun &&
      deleteApiSuffix.value &&
      resolveListLocation(resolvedScreen) &&
      unref(view.recordId) &&
      unref(view.record) &&
      !unref(view.isLoading) &&
      !unref(view.isNotFound)
    );
  });

  function request() {
    if (!canDelete.value) {
      return false;
    }
    error.value = "";
    isOpen.value = true;
    return true;
  }

  function cancel() {
    if (isDeleting.value) {
      return false;
    }
    error.value = "";
    isOpen.value = false;
    return true;
  }

  async function confirm() {
    if (!isOpen.value || !canDelete.value || isDeleting.value) {
      return null;
    }

    error.value = "";
    try {
      return await command.run();
    } catch {
      return null;
    }
  }

  return proxyRefs({
    isOpen,
    isDeleting,
    canDelete,
    error,
    request,
    cancel,
    confirm
  });
}

export {
  requireCrudDeleteOperation,
  resolveDeleteApiSuffix,
  useCrudDeleteAction
};
