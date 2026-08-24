const attachByHandle = new WeakMap();

function createDeferredAuthService() {
  let service = null;
  const handle = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === Symbol.toStringTag) return "AuthService";
      if (!service) throw new Error("Authentication service is not ready until runtime startup completes.");
      const value = service[property];
      return typeof value === "function" ? value.bind(service) : value;
    },
    has(_target, property) {
      return service ? property in service : false;
    }
  });
  attachByHandle.set(handle, (value) => {
    if (service) throw new Error("Authentication service is already initialized.");
    service = value;
  });
  return handle;
}

function attachDeferredAuthService(handle, service) {
  const attach = attachByHandle.get(handle);
  if (!attach) throw new TypeError("attachDeferredAuthService requires a deferred auth service handle.");
  if (!service || typeof service !== "object") {
    throw new TypeError("attachDeferredAuthService requires an auth service object.");
  }
  attach(service);
}

export { attachDeferredAuthService, createDeferredAuthService };
