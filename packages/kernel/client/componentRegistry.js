function normalizeComponentId(value) {
  const id = String(value || "").trim();
  if (!id) {
    throw new TypeError("Client component id is required.");
  }
  return id;
}

function createClientComponentRegistry() {
  const components = new Map();

  function register(id, component) {
    const componentId = normalizeComponentId(id);
    if (component == null) {
      throw new TypeError(`Client component "${componentId}" is required.`);
    }
    if (components.has(componentId)) {
      throw new Error(`Client component "${componentId}" is duplicated.`);
    }
    components.set(componentId, component);
    return api;
  }

  function has(id) {
    return components.has(normalizeComponentId(id));
  }

  function get(id) {
    const componentId = normalizeComponentId(id);
    if (!components.has(componentId)) {
      throw new Error(`Client component "${componentId}" is not registered.`);
    }
    return components.get(componentId);
  }

  function ids() {
    return Object.freeze([...components.keys()].sort());
  }

  const api = Object.freeze({ register, has, get, ids });
  return api;
}

export { createClientComponentRegistry };
