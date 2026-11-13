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
        const hint = provider.hints?.[capabilityId];
        throw new Error(`Provider "${provider.id}" requires missing capability "${capabilityId}".${hint ? ` ${hint}` : ""}`);
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

/**
 * What a provider's hooks receive, by local name: its required and optional capabilities as values, and each late
 * requirement as a getter that refuses a read until start() has resolved it, once every provider has booted.
 * @param {ReturnType<typeof defineProvider>} provider
 * @param {Map<string, unknown>} capabilities
 * @param {{ values: Readonly<Record<string, unknown>> | null }} late The provider's late requirements once resolved.
 */
function resolveProviderDependencies(provider, capabilities, late) {
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
  for (const [localName, capabilityId] of Object.entries(provider.late)) {
    Object.defineProperty(dependencies, localName, {
      enumerable: true,
      get() {
        if (late.values === null) {
          throw new Error(`Provider "${provider.id}" read its late requirement "${localName}" (capability "${capabilityId}") before every provider booted: a late requirement can only be read at call time after boot, such as inside a row policy or a request handler, never in setup or boot, and never destructured in setup.`);
        }
        return late.values[localName];
      }
    });
  }
  return Object.freeze(dependencies);
}

/**
 * A provider's late requirements, by local name, from the capabilities every provider has provided once all have
 * booted: a missing one fails start(), naming the provider and the capability.
 * @param {ReturnType<typeof defineProvider>} provider
 * @param {Map<string, unknown>} capabilities
 */
function resolveLateDependencies(provider, capabilities) {
  const values = {};
  for (const [localName, capabilityId] of Object.entries(provider.late)) {
    if (!capabilities.has(capabilityId)) {
      const hint = provider.hints[capabilityId];
      throw new Error(
        `Provider "${provider.id}" late-requires missing capability "${capabilityId}": no provider or runtime input provides it.${hint ? ` ${hint}` : ""}`
      );
    }
    values[localName] = capabilities.get(capabilityId);
  }
  return Object.freeze(values);
}

/**
 * A provider's setup() result, checked to hold exactly the capabilities it
 * declares; a provider that declares none may return nothing.
 * @param {{ id: string, provides: Record<string, string> }} provider
 * @param {unknown} value
 */
function normalizeProviderOutputs(provider, value) {
  const expectedNames = Object.keys(provider.provides).sort();
  const outputs = value == null && expectedNames.length === 0 ? {} : value;
  if (!isRecord(outputs)) {
    throw new Error(`Provider "${provider.id}" setup() must return its declared capability outputs.`);
  }

  const actualNames = Object.keys(outputs).sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error(
      `Provider "${provider.id}" setup() outputs must be exactly: ${expectedNames.join(", ") || "<none>"}.`
    );
  }
  return Object.freeze({ ...outputs });
}

function createCapabilityRuntime({ providers = [], inputs = {}, profile = "" } = {}) {
  const capabilities = normalizeInputCapabilities(inputs);
  const providerOrder = buildProviderOrder(Array.isArray(providers) ? providers : [], capabilities);
  const providerStates = new Map();
  const normalizedProfile = String(profile || "").trim();
  let lifecycleState = "created";
  // One entry per provider shutdown hook, in the order they ran, so a host can
  // say which provider is still stopping and how long each one took.
  const providerShutdowns = [];

  async function stopInitializedProviders() {
    const stopped = [];
    const failures = [];
    for (const provider of [...providerOrder].reverse()) {
      if (!providerStates.has(provider.id)) {
        continue;
      }
      if (provider.shutdown) {
        const state = providerStates.get(provider.id);
        const record = { id: provider.id, status: "stopping", startedAt: Date.now(), durationMs: 0 };
        providerShutdowns.push(record);
        try {
          await provider.shutdown(state.dependencies, Object.freeze({
            outputs: state.outputs,
            profile: normalizedProfile
          }));
          record.status = "stopped";
        } catch (error) {
          record.status = "failed";
          const message = error instanceof Error ? error.message : String(error);
          failures.push(Object.assign(
            new Error(`Provider "${provider.id}" shutdown failed: ${message}`, { cause: error }),
            { providerId: provider.id }
          ));
        } finally {
          record.durationMs = Date.now() - record.startedAt;
        }
      }
      stopped.push(provider.id);
    }
    // Every provider has stopped, even after one failed; each failure names its provider.
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Capability runtime shutdown failed: ${failures.map(({ providerId }) => providerId).join(", ")}.`
      );
    }
    return Object.freeze(stopped);
  }

  function providerShutdownDiagnostics() {
    const now = Date.now();
    return Object.freeze(providerShutdowns.map(({ id, status, startedAt, durationMs }) => Object.freeze({
      id,
      status,
      durationMs: status === "stopping" ? now - startedAt : durationMs
    })));
  }

  async function start() {
    if (lifecycleState !== "created") {
      throw new Error(`Capability runtime cannot start from state "${lifecycleState}".`);
    }
    lifecycleState = "starting";

    try {
      for (const provider of providerOrder) {
        const late = { values: null };
        const dependencies = resolveProviderDependencies(provider, capabilities, late);
        const outputs = normalizeProviderOutputs(
          provider,
          await provider.setup(dependencies, Object.freeze({ profile: normalizedProfile }))
        );
        for (const [localName, capabilityId] of Object.entries(provider.provides)) {
          capabilities.set(capabilityId, outputs[localName]);
        }
        providerStates.set(provider.id, Object.freeze({ dependencies, outputs, late }));
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

      // Late requirements take no part in the order above, so a ring one closes starts; each resolves once, here,
      // after every boot, and all of them or none do.
      const lateValues = providerOrder.map((provider) => resolveLateDependencies(provider, capabilities));
      for (const [index, provider] of providerOrder.entries()) {
        providerStates.get(provider.id).late.values = lateValues[index];
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
      capabilityIds: Object.freeze([...capabilities.keys()].sort()),
      providerShutdowns: providerShutdownDiagnostics()
    });
  }

  const api = Object.freeze({ start, shutdown, diagnostics });
  return api;
}

export { createCapabilityRuntime, normalizeProviderOutputs };
