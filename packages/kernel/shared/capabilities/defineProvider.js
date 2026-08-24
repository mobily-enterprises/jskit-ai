import { isRecord } from "../support/normalize.js";

const ARCHITECTURE_ID_PATTERN = /^[a-z][a-z0-9_.-]*$/u;
const LOCAL_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

function normalizeArchitectureId(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!ARCHITECTURE_ID_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must match ${ARCHITECTURE_ID_PATTERN.toString()}.`);
  }
  return normalized;
}

function normalizeCapabilityMap(value, label) {
  if (value == null) {
    return Object.freeze({});
  }
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object mapping local names to capability ids.`);
  }

  const normalized = {};
  const seenCapabilityIds = new Set();
  for (const [rawLocalName, rawCapabilityId] of Object.entries(value)) {
    const localName = String(rawLocalName || "").trim();
    if (!LOCAL_NAME_PATTERN.test(localName)) {
      throw new TypeError(`${label} local name "${localName}" must be a JavaScript identifier.`);
    }
    const capabilityId = normalizeArchitectureId(rawCapabilityId, `${label}.${localName}`);
    if (seenCapabilityIds.has(capabilityId)) {
      throw new TypeError(`${label} declares capability "${capabilityId}" more than once.`);
    }
    seenCapabilityIds.add(capabilityId);
    normalized[localName] = capabilityId;
  }

  return Object.freeze(normalized);
}

function assertDistinctLocalNames(maps) {
  const owners = new Map();
  for (const [kind, entries] of Object.entries(maps)) {
    for (const localName of Object.keys(entries)) {
      if (owners.has(localName)) {
        throw new TypeError(
          `Provider local name "${localName}" is declared by both ${owners.get(localName)} and ${kind}.`
        );
      }
      owners.set(localName, kind);
    }
  }
}

function normalizeLifecycleMethod(value, label) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function when provided.`);
  }
  return value;
}

function defineProvider({
  id,
  requires = {},
  optional = {},
  provides = {},
  setup,
  boot = null,
  shutdown = null
} = {}) {
  const providerId = normalizeArchitectureId(id, "Provider id");
  const normalizedRequires = normalizeCapabilityMap(requires, `${providerId}.requires`);
  const normalizedOptional = normalizeCapabilityMap(optional, `${providerId}.optional`);
  const normalizedProvides = normalizeCapabilityMap(provides, `${providerId}.provides`);
  assertDistinctLocalNames({
    requires: normalizedRequires,
    optional: normalizedOptional,
    provides: normalizedProvides
  });

  const setupMethod = normalizeLifecycleMethod(setup, `${providerId}.setup`);
  if (!setupMethod) {
    throw new TypeError(`${providerId}.setup is required.`);
  }

  return Object.freeze({
    id: providerId,
    requires: normalizedRequires,
    optional: normalizedOptional,
    provides: normalizedProvides,
    setup: setupMethod,
    boot: normalizeLifecycleMethod(boot, `${providerId}.boot`),
    shutdown: normalizeLifecycleMethod(shutdown, `${providerId}.shutdown`)
  });
}

export { defineProvider, normalizeArchitectureId };
