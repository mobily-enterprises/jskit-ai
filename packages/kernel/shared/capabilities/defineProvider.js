import { isRecord } from "../support/normalize.js";

/** @typedef {import("../../server/types.js").ProviderDefinition} ProviderDefinition */

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

/**
 * What to do about each required capability when no provider gives it, keyed by capability id: the text the startup
 * error adds, such as the feature to register.
 * @param {unknown} value
 * @param {Readonly<Record<string, string>>} requires
 * @param {string} providerId
 */
function normalizeHints(value, requires, providerId) {
  if (value == null) {
    return Object.freeze({});
  }
  if (!isRecord(value)) {
    throw new TypeError(`${providerId}.hints must be an object mapping required capability ids to what to register.`);
  }
  const required = new Set(Object.values(requires));
  const normalized = {};
  for (const [rawCapabilityId, hint] of Object.entries(value)) {
    const capabilityId = normalizeArchitectureId(rawCapabilityId, `${providerId}.hints key`);
    if (!required.has(capabilityId)) {
      throw new TypeError(`${providerId}.hints names "${capabilityId}", which the provider does not require.`);
    }
    if (typeof hint !== "string" || !hint.trim()) {
      throw new TypeError(`${providerId}.hints["${capabilityId}"] must be the text that says what to register.`);
    }
    normalized[capabilityId] = hint.trim();
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
  // readable-check: allow method-probe - input validation: a provider's lifecycle method is optional, and a function when given
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function when provided.`);
  }
  return value;
}

/**
 * An absent definition reaches the checks below, which name what is missing.
 * @param {ProviderDefinition} [definition]
 */
function defineProvider({
  id,
  requires = {},
  optional = {},
  provides = {},
  hints = {},
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
    hints: normalizeHints(hints, normalizedRequires, providerId),
    setup: setupMethod,
    boot: normalizeLifecycleMethod(boot, `${providerId}.boot`),
    shutdown: normalizeLifecycleMethod(shutdown, `${providerId}.shutdown`)
  });
}

export { ARCHITECTURE_ID_PATTERN, defineProvider, normalizeArchitectureId };
