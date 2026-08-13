function defaultScrollFallback(to, _from, savedPosition) {
  if (savedPosition) {
    return savedPosition;
  }
  if (to?.hash) {
    return { el: to.hash };
  }
  return { left: 0, top: 0 };
}

function createJskitNavigationScrollCoordinator({ fallback = defaultScrollFallback } = {}) {
  if (typeof fallback !== "function") {
    throw new TypeError("createJskitNavigationScrollCoordinator fallback must be a function.");
  }

  let navigation = null;
  let disposed = false;

  return Object.freeze({
    scrollBehavior(to, from, savedPosition) {
      if (!disposed && navigation?.shouldDeferScroll?.(to)) {
        return false;
      }
      return fallback(to, from, savedPosition);
    },
    attach(runtime) {
      if (disposed) {
        throw new Error("Cannot attach a disposed JSKIT navigation scroll coordinator.");
      }
      if (!runtime || typeof runtime !== "object") {
        throw new TypeError("JSKIT navigation scroll coordinator requires a navigation runtime.");
      }
      if (navigation && navigation !== runtime) {
        throw new Error("JSKIT navigation scroll coordinator is already attached to another runtime.");
      }
      navigation = runtime;
    },
    dispose() {
      disposed = true;
      navigation = null;
    }
  });
}

export { createJskitNavigationScrollCoordinator };
