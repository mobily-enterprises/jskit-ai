import { computed, nextTick, proxyRefs, ref, unref } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { useShellNavigation } from "@jskit-ai/shell-web/client/navigation/useShellNavigation";
import { resolveCrudJsonApiTransport } from "./crud/crudJsonApiTransportSupport.js";
import { resolveCrudHttpClient } from "./crud/crudHttpClientSupport.js";
import { toQueryErrorMessage } from "./support/errorMessageHelpers.js";
import { useCommand } from "./useCommand.js";
import { createTextError, useJskitText } from "../i18n.js";

const { t } = useJskitText();

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

function resolveDeleteApiSuffix(screen, apiUrlTemplate = "") {
  const template = normalizeText(unref(apiUrlTemplate));
  return template ? normalizeText(screen.view.resolveParams(template)) : "";
}

function resolveListLocation(screen) {
  return unref(screen.listLocation) || null;
}

/** @param {import("../types.js").CrudDeleteActionOptions} options */
function useCrudDeleteAction({
  screen,
  resource = null,
  resourceNamespace = "",
  apiUrlTemplate = "",
  access = "auto",
  client,
  fallbackDeleteError = t("jskit.http.crud.delete.failed")
}) {
  const deleteOperation = requireCrudDeleteOperation(resource);
  const namespace = normalizeText(resourceNamespace, {
    fallback: resource?.namespace
  });
  if (!namespace) {
    throw new TypeError("useCrudDeleteAction requires resourceNamespace or resource.namespace.");
  }

  const navigation = useShellNavigation();
  const isOpen = ref(false);
  const error = ref("");
  const deleteApiSuffix = computed(() => resolveDeleteApiSuffix(screen, apiUrlTemplate));

  async function handleDeleteSuccess(_response, context) {
    const listLocation = resolveListLocation(screen);
    if (!listLocation) {
      throw createTextError("jskit.http.crud.delete.listRouteUnavailable");
    }

    isOpen.value = false;
    // Leave the deleted record's view before invalidating: while its view query is
    // still observed, invalidation would refetch it and report "Record not found.".
    // The list replaces the record's history entry, so neither Up nor Back reopens it.
    await navigation.finish(listLocation);
    await nextTick();
    await context.queryClient.invalidateQueries({
      queryKey: ["crud", namespace]
    });
  }

  function handleDeleteError(cause) {
    error.value = toQueryErrorMessage(
      cause,
      fallbackDeleteError,
      t("jskit.http.crud.delete.failed")
    );
  }

  const command = useCommand({
    access,
    apiSuffix: deleteApiSuffix,
    writeMethod: deleteOperation.method,
    client: resolveCrudHttpClient(resource, { client }),
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
    const view = screen.view;
    return Boolean(
      command.canRun &&
      deleteApiSuffix.value &&
      resolveListLocation(screen) &&
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
