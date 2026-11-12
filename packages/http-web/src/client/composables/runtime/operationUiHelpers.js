import { toValue, watch } from "vue";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { isRetryableLoadStatus } from "../support/resourceLoadStateHelpers.js";
import { useJskitText } from "../../i18n.js";

const { t } = useJskitText();

function normalizeMessage(value) {
  return String(value || "").trim();
}

function noRetryAction() {
  return null;
}

/**
 * A load notice's Retry, offered only while trying again may succeed (`isRetryableLoadStatus`): a load the server
 * refused, such as a 403 or a 404, is refused again, so its notice offers no Retry.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<number>} options.errorStatus The failed load's HTTP status, or 0.
 * @param {() => unknown} options.retry Loads again.
 * @param {import("vue").MaybeRefOrGetter<boolean>} [options.enabled] False offers no Retry whatever the status.
 * @returns {() => Record<string, any> | null}
 */
function createLoadRetryActionFactory({ errorStatus, retry, enabled = true }) {
  return () => {
    if (!toValue(enabled) || !isRetryableLoadStatus(toValue(errorStatus))) {
      return null;
    }

    return {
      label: t("jskit.http.actions.retry"),
      dismissOnRun: true,
      handler() {
        void retry();
      }
    };
  };
}

/** @param {import("../../types.js").OperationErrorReporting} [options] */
function setupOperationErrorReporting({
  enabled = true,
  source = "http-web.operation",
  loadError = null,
  notFoundError = null,
  loadActionFactory = noRetryAction,
  notFoundActionFactory = noRetryAction,
  loadChannel = "",
  notFoundChannel = "",
  loadSeverity = "error",
  notFoundSeverity = "warning",
  dedupeWindowMs = 2000
} = {}) {
  if (!enabled) {
    return;
  }

  const runtime = useShellWebErrorRuntime();
  const normalizedSource = normalizeMessage(source) || "http-web.operation";

  function watchMessage(value, {
    kind = "load",
    channel = "",
    intent = "resource-load",
    severity = "error",
    actionFactory = noRetryAction
  } = {}) {
    let lastMessage = "";
    let lastPresentationId = "";

    watch(
      () => normalizeMessage(value.value),
      (nextMessage) => {
        if (!nextMessage) {
          lastMessage = "";
          if (lastPresentationId) {
            runtime.dismiss(lastPresentationId);
            lastPresentationId = "";
          }
          return;
        }

        if (nextMessage === lastMessage) {
          return;
        }

        lastMessage = nextMessage;
        const action = actionFactory({
          message: nextMessage,
          kind
        });
        const reportResult = runtime.report({
          source: normalizedSource,
          message: nextMessage,
          intent,
          severity,
          channel,
          action,
          dedupeKey: `${normalizedSource}:${kind}:${nextMessage}`,
          dedupeWindowMs
        });

        const nextPresentationId = String(reportResult?.presentationId || "").trim();
        if (nextPresentationId) {
          if (lastPresentationId && lastPresentationId !== nextPresentationId) {
            runtime.dismiss(lastPresentationId);
          }
          lastPresentationId = nextPresentationId;
        }
      },
      { immediate: true }
    );
  }

  if (loadError) {
    watchMessage(loadError, {
      kind: "load",
      channel: loadChannel,
      intent: "resource-load",
      severity: loadSeverity,
      actionFactory: loadActionFactory
    });
  }

  if (notFoundError) {
    watchMessage(notFoundError, {
      kind: "not-found",
      channel: notFoundChannel,
      intent: "resource-load",
      severity: notFoundSeverity,
      actionFactory: notFoundActionFactory
    });
  }
}

/**
 * Clears what an operation shows when the route changes.
 * @param {{ enabled?: boolean, route: { fullPath?: string } | null, feedback: Pick<import("../../types.js").UiFeedback, "clear">, onClear: () => void }} options
 */
function setupRouteChangeCleanup({ enabled = true, route, feedback, onClear }) {
  if (!enabled) {
    return;
  }

  watch(
    () => route?.fullPath,
    () => {
      feedback.clear();
      onClear();
    }
  );
}

export { createLoadRetryActionFactory };
export { setupRouteChangeCleanup };
export { setupOperationErrorReporting };
