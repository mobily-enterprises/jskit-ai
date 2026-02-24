function normalizeRegistryDefinitions(definitions, { registryKind = "registry" } = {}) {
  const source = Array.isArray(definitions) ? definitions : [];
  const normalized = [];
  const seenIds = new Set();

  for (const entry of source) {
    const id = String(entry?.id || "").trim();
    const create = entry?.create;

    if (!id) {
      throw new TypeError(`${registryKind} definition id is required.`);
    }
    if (seenIds.has(id)) {
      throw new TypeError(`${registryKind} definition "${id}" is duplicated.`);
    }
    if (typeof create !== "function") {
      throw new TypeError(`${registryKind} definition "${id}" create must be a function.`);
    }

    seenIds.add(id);
    normalized.push({
      id,
      create
    });
  }

  return normalized;
}

function createRegistryFromDefinitions(definitions, createArgsFactory, options = {}) {
  const normalizedDefinitions = normalizeRegistryDefinitions(definitions, options);
  const registry = {};

  for (const definition of normalizedDefinitions) {
    const createArgs =
      typeof createArgsFactory === "function" ? createArgsFactory({ definition, registry }) : Object.freeze({});
    registry[definition.id] = definition.create(createArgs || {});
  }

  return registry;
}

function createRepositoryRegistry(definitions) {
  return createRegistryFromDefinitions(definitions, () => ({}), {
    registryKind: "repository"
  });
}

function createServiceRegistry({ definitions, dependencies = {} } = {}) {
  return createRegistryFromDefinitions(
    definitions,
    ({ registry }) => ({
      ...(dependencies || {}),
      services: registry
    }),
    {
      registryKind: "service"
    }
  );
}

function createControllerRegistry({ definitions, services = {}, dependencies = {} } = {}) {
  return createRegistryFromDefinitions(
    definitions,
    ({ registry }) => ({
      ...(dependencies || {}),
      services,
      controllers: registry
    }),
    {
      registryKind: "controller"
    }
  );
}

function selectRuntimeServices(services, selectedIds = []) {
  const source = services && typeof services === "object" ? services : {};
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  const runtimeServices = {};

  for (const rawId of ids) {
    const id = String(rawId || "").trim();
    if (!id) {
      continue;
    }
    if (!Object.hasOwn(source, id)) {
      throw new Error(`Runtime service "${id}" is not defined.`);
    }
    runtimeServices[id] = source[id];
  }

  return runtimeServices;
}

const __testables = {
  normalizeRegistryDefinitions,
  createRegistryFromDefinitions
};

export { createRepositoryRegistry, createServiceRegistry, createControllerRegistry, selectRuntimeServices, __testables };
