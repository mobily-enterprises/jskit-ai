function resolveCapacitorAppPlugin(globalObject = globalThis) {
  if (!globalObject || typeof globalObject !== "object") {
    return null;
  }

  const pluginFromPlugins = globalObject?.Capacitor?.Plugins?.App;
  if (pluginFromPlugins && typeof pluginFromPlugins === "object") {
    return pluginFromPlugins;
  }

  const directPlugin = globalObject?.Capacitor?.App;
  if (directPlugin && typeof directPlugin === "object") {
    return directPlugin;
  }

  return null;
}

function createNoopCapacitorAppAdapter() {
  return Object.freeze({
    available: false,
    async getInitialLaunchUrl() {
      return "";
    },
    subscribeToLaunchUrls() {
      return () => {};
    },
    subscribeToBackButton() {
      return () => {};
    },
    async exitApp() {
      return false;
    }
  });
}

function createGlobalCapacitorAppAdapter({ globalObject = globalThis, appPlugin = null } = {}) {
  const plugin = appPlugin || resolveCapacitorAppPlugin(globalObject);
  if (!plugin || typeof plugin !== "object") {
    return createNoopCapacitorAppAdapter();
  }

  return Object.freeze({
    available: typeof plugin.getLaunchUrl === "function" || typeof plugin.addListener === "function",
    async getInitialLaunchUrl() {
      if (typeof plugin.getLaunchUrl !== "function") {
        return "";
      }

      const payload = await plugin.getLaunchUrl();
      return String(payload?.url || "").trim();
    },
    subscribeToLaunchUrls(handler = () => {}) {
      if (typeof plugin.addListener !== "function") {
        return () => {};
      }

      let disposed = false;
      let removeListener = null;

      Promise.resolve(
        plugin.addListener("appUrlOpen", (event = {}) => {
          if (disposed) {
            return;
          }

          handler(String(event?.url || "").trim());
        })
      )
        .then((listenerHandle) => {
          removeListener = listenerHandle;
          if (disposed && typeof removeListener?.remove === "function") {
            return removeListener.remove();
          }
          return null;
        })
        .catch(() => {});

      return () => {
        disposed = true;
        if (typeof removeListener?.remove === "function") {
          void removeListener.remove();
        }
      };
    },
    subscribeToBackButton(handler = () => {}) {
      if (typeof plugin.addListener !== "function") {
        return () => {};
      }

      let disposed = false;
      let removeListener = null;

      Promise.resolve(
        plugin.addListener("backButton", (event = {}) => {
          if (disposed) {
            return;
          }

          handler({
            canGoBack: event?.canGoBack === true
          });
        })
      )
        .then((listenerHandle) => {
          removeListener = listenerHandle;
          if (disposed && typeof removeListener?.remove === "function") {
            return removeListener.remove();
          }
          return null;
        })
        .catch(() => {});

      return () => {
        disposed = true;
        if (typeof removeListener?.remove === "function") {
          void removeListener.remove();
        }
      };
    },
    async exitApp() {
      if (typeof plugin.exitApp !== "function") {
        return false;
      }

      await plugin.exitApp();
      return true;
    }
  });
}

export {
  createGlobalCapacitorAppAdapter,
  createNoopCapacitorAppAdapter,
  resolveCapacitorAppPlugin
};
