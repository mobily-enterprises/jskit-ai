import { pageClientBuildId } from "@jskit-ai/kernel/shared/support/clientBuild";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

// The title the page loaded with (index.html's <title>) names the app; screens
// may change the tab title later.
function loadedAppName(documentObject = globalThis.document) {
  return normalizeText(documentObject?.title);
}

// Offers a reload when the server serves a different client build from the one
// this page runs, as it does after an update. It never reloads by itself: the
// person may be in the middle of something. Reload returns to the same address.
function createShellClientUpdateRuntime({
  errorRuntime,
  reload,
  pageBuildId = pageClientBuildId(),
  appName = loadedAppName()
} = {}) {
  let offer = null;
  let stopWatching = null;

  function withdraw() {
    if (offer?.presentationId) {
      errorRuntime.dismiss(offer.presentationId);
    }
    offer = null;
  }

  function offerReload(servedBuildId) {
    const [messageKey, messageParams] = appName
      ? ["jskit.shell.recovery.appUpdated", { app: appName }]
      : ["jskit.shell.recovery.thisAppUpdated", {}];
    const result = errorRuntime.report({
      source: "shell-web.client-update",
      message: t(messageKey, messageParams),
      // The error host renders the sentence in the user's language from its code.
      messageCode: messageKey.slice("jskit.".length),
      messageParams,
      intent: "app-recoverable",
      severity: "info",
      action: {
        label: t("jskit.shell.actions.reload"),
        handler() {
          return reload();
        }
      }
    });
    offer = { buildId: servedBuildId, presentationId: normalizeText(result?.presentationId) };
  }

  // One offer per served build: a reconnection to the same build does not
  // repeat it, even after the person closed it.
  function check(servedBuildId = "") {
    const served = normalizeText(servedBuildId);
    if (!pageBuildId || !served || served === offer?.buildId) {
      return;
    }
    withdraw();
    if (served !== pageBuildId) {
      offerReload(served);
    }
  }

  // realtime is the optional client.realtime capability, which names the
  // server's build on every connection.
  function watch(realtime = null) {
    dispose();
    stopWatching = realtime ? realtime.onServedClientBuild(check) : null;
  }

  function dispose() {
    stopWatching?.();
    stopWatching = null;
  }

  return Object.freeze({
    check,
    dispose,
    watch
  });
}

export { createShellClientUpdateRuntime };
