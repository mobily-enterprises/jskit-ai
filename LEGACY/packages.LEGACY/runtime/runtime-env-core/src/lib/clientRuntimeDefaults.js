function defaultUseAuthGuard() {
  return {
    handleUnauthorizedError() {}
  };
}

function createDefaultUseWorkspaceStore(defaults = {}) {
  const normalizedDefaults = defaults && typeof defaults === "object" ? defaults : {};
  return () => ({
    activeWorkspace: null,
    activeWorkspaceSlug: "",
    ...normalizedDefaults
  });
}

function createDefaultUseQueryErrorMessage({ computed, resolveMessage = null, fallbackMessage = "" } = {}) {
  if (typeof computed !== "function") {
    throw new Error("computed is required.");
  }

  return ({ error } = {}) =>
    computed(() => {
      const resolvedMessage =
        typeof resolveMessage === "function" ? String(resolveMessage(error?.value || null) || "").trim() : "";
      return resolvedMessage || fallbackMessage;
    });
}

export { defaultUseAuthGuard, createDefaultUseWorkspaceStore, createDefaultUseQueryErrorMessage };
