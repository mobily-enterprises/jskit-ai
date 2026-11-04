/**
 * The Capacitor App plugin on the page, or null when there is none.
 * @param {{ Capacitor?: { Plugins?: { App?: unknown }, App?: unknown } }} [globalObject]
 * @returns {import("../types.js").CapacitorAppPlugin | null}
 */
function resolveCapacitorAppPlugin(globalObject = globalThis) {
  const pluginFromPlugins = globalObject.Capacitor?.Plugins?.App;
  if (pluginFromPlugins && typeof pluginFromPlugins === "object") {
    return pluginFromPlugins;
  }

  const directPlugin = globalObject.Capacitor?.App;
  if (directPlugin && typeof directPlugin === "object") {
    return directPlugin;
  }

  return null;
}

/**
 * Whether the App plugin has the named function.
 * @param {import("../types.js").CapacitorAppPlugin} plugin
 * @param {keyof import("../types.js").CapacitorAppPlugin} name
 */
function pluginHasFunction(plugin, name) {
  // readable-check: allow method-probe - platform object: the application's shell supplies the App plugin; this package does not depend on @capacitor/app
  return typeof plugin[name] === "function";
}

async function readNoLaunchUrl() {
  return "";
}

function removeNoListener() {}

function subscribeToNothing() {
  return removeNoListener;
}

async function exitNothing() {
  return false;
}

/** @returns {import("../types.js").CapacitorAppAdapter} */
function createNoopCapacitorAppAdapter() {
  return Object.freeze({
    available: false,
    getInitialLaunchUrl: readNoLaunchUrl,
    subscribeToLaunchUrls: subscribeToNothing,
    subscribeToBackButton: subscribeToNothing,
    exitApp: exitNothing
  });
}

/**
 * @param {object} [options]
 * @param {object} [options.globalObject]
 * @param {import("../types.js").CapacitorAppPlugin | null} [options.appPlugin]
 * @returns {import("../types.js").CapacitorAppAdapter}
 */
function createGlobalCapacitorAppAdapter({ globalObject = globalThis, appPlugin = resolveCapacitorAppPlugin(globalObject) } = {}) {
  if (appPlugin === null) {
    return createNoopCapacitorAppAdapter();
  }

  const canReadLaunchUrl = pluginHasFunction(appPlugin, "getLaunchUrl");
  const canListen = pluginHasFunction(appPlugin, "addListener");
  const canExit = pluginHasFunction(appPlugin, "exitApp");

  async function getInitialLaunchUrl() {
    if (!canReadLaunchUrl) {
      return "";
    }

    const payload = await appPlugin.getLaunchUrl();
    return String(payload?.url || "").trim();
  }

  // The plugin hands its listener back later, so a subscription disposed before then removes it when it arrives.
  function subscribeToPluginEvent(eventName, onEvent) {
    if (!canListen) {
      return removeNoListener;
    }

    let disposed = false;
    let listenerHandle = null;

    Promise.resolve(
      appPlugin.addListener(eventName, (event) => {
        if (disposed) {
          return;
        }

        onEvent(event);
      })
    )
      .then((handle) => {
        listenerHandle = handle;
        if (disposed) {
          return listenerHandle.remove();
        }
        return null;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (listenerHandle) {
        void listenerHandle.remove();
      }
    };
  }

  function subscribeToLaunchUrls(handler) {
    return subscribeToPluginEvent("appUrlOpen", (event) => {
      handler(String(event?.url || "").trim());
    });
  }

  function subscribeToBackButton(handler) {
    return subscribeToPluginEvent("backButton", (event) => {
      handler({
        canGoBack: event?.canGoBack === true
      });
    });
  }

  async function exitApp() {
    if (!canExit) {
      return false;
    }

    await appPlugin.exitApp();
    return true;
  }

  return Object.freeze({
    available: canReadLaunchUrl || canListen,
    getInitialLaunchUrl,
    subscribeToLaunchUrls,
    subscribeToBackButton,
    exitApp
  });
}

export {
  createGlobalCapacitorAppAdapter,
  createNoopCapacitorAppAdapter,
  resolveCapacitorAppPlugin
};
