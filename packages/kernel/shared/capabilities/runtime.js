import { isRecord } from "../support/normalize.js";
import { defineProvider, normalizeArchitectureId } from "./defineProvider.js";

function normalizeProviderDefinition(value) {
  if (!isRecord(value)) {
    throw new TypeError("Capability runtime providers must be provider definitions.");
  }
  return defineProvider(value);
}

function normalizeInputCapabilities(value) {
  if (value == null) {
    return new Map();
  }
  if (!isRecord(value)) {
    throw new TypeError("Capability runtime inputs must be an object keyed by capability id.");
  }
  return new Map(Object.entries(value).map(([id, capability]) => [
    normalizeArchitectureId(id, "Runtime input capability id"),
    capability
  ]));
}

function providerCapabilityIds(provider, field) {
  return Object.values(provider[field] || {});
}

function buildProviderOrder(providers, inputCapabilities) {
  const normalizedProviders = providers.map(normalizeProviderDefinition);
  const providersById = new Map();
  const providerByCapability = new Map();

  for (const provider of normalizedProviders) {
    if (providersById.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" is duplicated.`);
    }
    providersById.set(provider.id, provider);

    for (const capabilityId of providerCapabilityIds(provider, "provides")) {
      if (inputCapabilities.has(capabilityId)) {
        throw new Error(`Capability "${capabilityId}" is supplied both as a runtime input and by ${provider.id}.`);
      }
      if (providerByCapability.has(capabilityId)) {
        throw new Error(
          `Capability "${capabilityId}" is provided by both ${providerByCapability.get(capabilityId).id} and ${provider.id}.`
        );
      }
      providerByCapability.set(capabilityId, provider);
    }
  }

  for (const provider of normalizedProviders) {
    for (const capabilityId of providerCapabilityIds(provider, "requires")) {
      if (!inputCapabilities.has(capabilityId) && !providerByCapability.has(capabilityId)) {
        throw new Error(`Provider "${provider.id}" requires missing capability "${capabilityId}".`);
      }
      if (providerByCapability.get(capabilityId)?.id === provider.id) {
        throw new Error(`Provider "${provider.id}" cannot require capability "${capabilityId}" that it provides.`);
      }
    }
  }

  const visited = new Set();
  const visiting = new Set();
  const ordered = [];

  function visit(provider, lineage = []) {
    if (visited.has(provider.id)) {
      return;
    }
    if (visiting.has(provider.id)) {
      throw new Error(`Provider capability cycle detected: ${[...lineage, provider.id].join(" -> ")}.`);
    }

    visiting.add(provider.id);
    const dependencyProviders = [
      ...providerCapabilityIds(provider, "requires"),
      ...providerCapabilityIds(provider, "optional")
    ]
      .map((capabilityId) => providerByCapability.get(capabilityId) || null)
      .filter(Boolean)
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const dependencyProvider of dependencyProviders) {
      visit(dependencyProvider, [...lineage, provider.id]);
    }
    visiting.delete(provider.id);
    visited.add(provider.id);
    ordered.push(provider);
  }

  for (const provider of [...normalizedProviders].sort((left, right) => left.id.localeCompare(right.id))) {
    visit(provider);
  }
  return Object.freeze(ordered);
}

function resolveProviderDependencies(provider, capabilities) {
  const dependencies = {};
  for (const [localName, capabilityId] of Object.entries(provider.requires)) {
    if (!capabilities.has(capabilityId)) {
      throw new Error(`Provider "${provider.id}" requires unavailable capability "${capabilityId}".`);
    }
    dependencies[localName] = capabilities.get(capabilityId);
  }
  for (const [localName, capabilityId] of Object.entries(provider.optional)) {
    dependencies[localName] = capabilities.has(capabilityId) ? capabilities.get(capabilityId) : null;
  }
  return Object.freeze(dependencies);
}

function normalizeProviderOutputs(provider, value) {
  const expectedNames = Object.keys(provider.provides);
  if (expectedNames.length === 0) {
    if (value != null && (!isRecord(value) || Object.keys(value).length > 0)) {
      throw new Error(`Provider "${provider.id}" declares no capabilities but setup() returned outputs.`);
    }
    return Object.freeze({});
  }
  if (!isRecord(value)) {
    throw new Error(`Provider "${provider.id}" setup() must return its declared capability outputs.`);
  }

  const actualNames = Object.keys(value).sort();
  const sortedExpectedNames = [...expectedNames].sort();
  if (
    actualNames.length !== sortedExpectedNames.length ||
    actualNames.some((name, index) => name !== sortedExpectedNames[index])
  ) {
    throw new Error(
      `Provider "${provider.id}" setup() outputs must be exactly: ${sortedExpectedNames.join(", ") || "<none>"}.`
    );
  }
  return Object.freeze({ ...value });
}

function createCapabilityRuntime({ providers = [], inputs = {}, profile = "" } = {}) {
  const capabilities = normalizeInputCapabilities(inputs);
  const providerOrder = buildProviderOrder(Array.isArray(providers) ? providers : [], capabilities);
  const providerStates = new Map();
  const normalizedProfile = String(profile || "").trim();
  let lifecycleState = "created";

  async function stopInitializedProviders() {
    const stopped = [];
    let firstError = null;
    for (const provider of [...providerOrder].reverse()) {
      if (!providerStates.has(provider.id)) {
        continue;
      }
      if (provider.shutdown) {
        const state = providerStates.get(provider.id);
        try {
          await provider.shutdown(state.dependencies, Object.freeze({
            outputs: state.outputs,
            profile: normalizedProfile
          }));
        } catch (error) {
          firstError ||= error;
        }
      }
      stopped.push(provider.id);
    }
    if (firstError) {
      throw firstError;
    }
    return Object.freeze(stopped);
  }

  async function start() {
    if (lifecycleState !== "created") {
      throw new Error(`Capability runtime cannot start from state "${lifecycleState}".`);
    }
    lifecycleState = "starting";

    try {
      for (const provider of providerOrder) {
        const dependencies = resolveProviderDependencies(provider, capabilities);
        const outputs = normalizeProviderOutputs(
          provider,
          await provider.setup(dependencies, Object.freeze({ profile: normalizedProfile }))
        );
        for (const [localName, capabilityId] of Object.entries(provider.provides)) {
          capabilities.set(capabilityId, outputs[localName]);
        }
        providerStates.set(provider.id, Object.freeze({ dependencies, outputs }));
      }

      for (const provider of providerOrder) {
        if (provider.boot) {
          const state = providerStates.get(provider.id);
          await provider.boot(state.dependencies, Object.freeze({
            outputs: state.outputs,
            profile: normalizedProfile
          }));
        }
      }

      lifecycleState = "started";
      return api;
    } catch (error) {
      lifecycleState = "failed";
      try {
        await stopInitializedProviders();
      } catch (shutdownError) {
        throw new AggregateError(
          [error, shutdownError],
          "Capability runtime startup failed and cleanup also failed.",
          { cause: error }
        );
      }
      throw error;
    }
  }

  async function shutdown() {
    if (lifecycleState === "stopped") {
      return Object.freeze([]);
    }
    if (lifecycleState !== "started") {
      throw new Error(`Capability runtime cannot shut down from state "${lifecycleState}".`);
    }
    lifecycleState = "stopping";
    try {
      return await stopInitializedProviders();
    } finally {
      lifecycleState = "stopped";
    }
  }

  function diagnostics() {
    return Object.freeze({
      profile: normalizedProfile,
      lifecycleState,
      providerOrder: Object.freeze(providerOrder.map((provider) => provider.id)),
      capabilityIds: Object.freeze([...capabilities.keys()].sort())
    });
  }

  const api = Object.freeze({ start, shutdown, diagnostics });
  return api;
}

export { createCapabilityRuntime };
