import { createRuntimeComposition } from "./composition.js";

function normalizeDefinitions(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRuntimeServiceIds(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRuntimeBundle(bundle = {}) {
  const source = bundle && typeof bundle === "object" ? bundle : {};

  return {
    repositoryDefinitions: normalizeDefinitions(source.repositoryDefinitions),
    serviceDefinitions: normalizeDefinitions(source.serviceDefinitions),
    controllerDefinitions: normalizeDefinitions(source.controllerDefinitions),
    runtimeServiceIds: normalizeRuntimeServiceIds(source.runtimeServiceIds)
  };
}

function createRuntimeKernel({
  runtimeBundle,
  dependencies = {},
  repositoryDependencies = {},
  serviceDependencies = {},
  controllerDependencies = {}
} = {}) {
  const sharedDependencies = dependencies && typeof dependencies === "object" ? dependencies : {};
  const normalizedBundle = normalizeRuntimeBundle(runtimeBundle);

  return createRuntimeComposition({
    ...normalizedBundle,
    repositoryDependencies: {
      ...sharedDependencies,
      ...(repositoryDependencies || {})
    },
    serviceDependencies: {
      ...sharedDependencies,
      ...(serviceDependencies || {})
    },
    controllerDependencies: {
      ...sharedDependencies,
      ...(controllerDependencies || {})
    }
  });
}

const __testables = {
  normalizeDefinitions,
  normalizeRuntimeServiceIds,
  normalizeRuntimeBundle
};

export { normalizeRuntimeBundle, createRuntimeKernel, __testables };
