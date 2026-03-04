import { createRuntimeAssembly } from "../runtime/runtimeAssembly.js";

function createPlatformRuntimeBundle({
  repositoryDefinitions = [],
  serviceDefinitions = [],
  controllerDefinitions = [],
  runtimeServiceIds = []
} = {}) {
  return Object.freeze({
    repositoryDefinitions,
    serviceDefinitions,
    controllerDefinitions,
    runtimeServiceIds
  });
}

function createServerRuntime({ bundles = [], dependencies = {} } = {}) {
  return createRuntimeAssembly({
    bundles,
    dependencies
  });
}

function createServerRuntimeWithPlatformBundle({
  platformBundle,
  appFeatureBundle,
  dependencies = {}
} = {}) {
  if (!platformBundle || typeof platformBundle !== "object") {
    throw new Error("platformBundle is required.");
  }

  const bundles = appFeatureBundle ? [platformBundle, appFeatureBundle] : [platformBundle];
  return createServerRuntime({
    bundles,
    dependencies
  });
}

export { createPlatformRuntimeBundle, createServerRuntime, createServerRuntimeWithPlatformBundle };
