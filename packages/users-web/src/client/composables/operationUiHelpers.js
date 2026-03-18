import { watch } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";

function normalizeMessage(value) {
  return String(value || "").trim();
}

function setupOperationErrorReporting({
  enabled = true,
  source = "users-web.operation",
  loadError = null,
  notFoundError = null,
  loadActionFactory = null,
  notFoundActionFactory = null,
  loadChannel = "banner",
  notFoundChannel = "banner",
  loadSeverity = "error",
  notFoundSeverity = "warning",
  dedupeWindowMs = 2000
} = {}) {
  if (!enabled) {
    return;
  }

  const runtime = useShellWebErrorRuntime();
  const normalizedSource = normalizeMessage(source) || "users-web.operation";

  function watchMessage(value, {
    kind = "load",
    channel = "banner",
    severity = "error",
    actionFactory = null
  } = {}) {
    let lastMessage = "";

    watch(
      () => normalizeMessage(value?.value),
      (nextMessage) => {
        if (!nextMessage) {
          lastMessage = "";
          return;
        }

        if (nextMessage === lastMessage) {
          return;
        }

        lastMessage = nextMessage;
        const action = typeof actionFactory === "function"
          ? actionFactory({
              message: nextMessage,
              kind
            })
          : null;
        runtime.report({
          source: normalizedSource,
          message: nextMessage,
          severity,
          channel,
          action,
          dedupeKey: `${normalizedSource}:${kind}:${nextMessage}`,
          dedupeWindowMs
        });
      },
      { immediate: true }
    );
  }

  if (loadError) {
    watchMessage(loadError, {
      kind: "load",
      channel: loadChannel,
      severity: loadSeverity,
      actionFactory: loadActionFactory
    });
  }

  if (notFoundError) {
    watchMessage(notFoundError, {
      kind: "not-found",
      channel: notFoundChannel,
      severity: notFoundSeverity,
      actionFactory: notFoundActionFactory
    });
  }
}

function setupRouteChangeCleanup({
  enabled = true,
  route = null,
  feedback = null,
  fieldBag = null
} = {}) {
  if (!enabled) {
    return;
  }

  watch(
    () => route?.fullPath,
    () => {
      feedback?.clear?.();
      fieldBag?.clear?.();
    }
  );
}

export { setupRouteChangeCleanup };
export { setupOperationErrorReporting };
