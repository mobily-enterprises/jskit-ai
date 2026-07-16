import { normalizeCiContribution } from "./contract.js";

class CiCompositionError extends Error {
  constructor(code, message, details = {}) {
    super(`[ci:${code}] ${message}`);
    this.name = "CiCompositionError";
    this.code = `ci:${code}`;
    this.details = details && typeof details === "object" ? { ...details } : {};
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalValue(value[key])])
    );
  }
  return value;
}

function valuesMatch(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function formatConflictValue(value) {
  return JSON.stringify(canonicalValue(value));
}

function normalizePackageEntries(packageEntries = []) {
  const entries = packageEntries instanceof Map ? [...packageEntries.values()] : packageEntries;
  if (!Array.isArray(entries)) {
    throw new TypeError("composeCiContributions requires package entries as an array or Map.");
  }
  return entries
    .map((entry) => ({
      packageId: String(entry?.packageId || entry?.descriptor?.packageId || "").trim(),
      descriptor: entry?.descriptor && typeof entry.descriptor === "object" ? entry.descriptor : {}
    }))
    .filter((entry) => Boolean(entry.packageId))
    .sort((left, right) => left.packageId.localeCompare(right.packageId));
}

function appendSource(sourceMap, key, packageId) {
  if (!sourceMap.has(key)) {
    sourceMap.set(key, new Set());
  }
  sourceMap.get(key).add(packageId);
}

function conflict({ kind, id, existing, incoming, existingPackages, incomingPackage }) {
  const label = kind === "environment" ? "environment key" : `${kind} ID`;
  throw new CiCompositionError(
    `${kind}-conflict`,
    `Conflicting CI ${label} "${id}" from ${[...existingPackages].sort().join(", ")} and ${incomingPackage}. ` +
      `Existing value: ${formatConflictValue(existing)}. Incoming value: ${formatConflictValue(incoming)}. ` +
      "Align the package descriptors or remove one of the conflicting packages.",
    {
      kind,
      id,
      existing,
      incoming,
      existingPackages: [...existingPackages].sort(),
      incomingPackage
    }
  );
}

function sourcesToObject(sourceMap) {
  return Object.fromEntries(
    [...sourceMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, packageIds]) => [key, [...packageIds].sort((left, right) => left.localeCompare(right))])
  );
}

function composeCiContributions(packageEntries = []) {
  const environmentByKey = new Map();
  const servicesById = new Map();
  const stepsById = new Map();
  const environmentSources = new Map();
  const serviceSources = new Map();
  const stepSources = new Map();
  const contributingPackages = new Set();

  for (const packageEntry of normalizePackageEntries(packageEntries)) {
    const { packageId, descriptor } = packageEntry;
    const contribution = normalizeCiContribution(descriptor.ci, {
      packageId,
      descriptorPath: packageId
    });
    const contributes =
      Object.keys(contribution.environment).length > 0 ||
      contribution.services.length > 0 ||
      contribution.steps.length > 0;
    if (contributes) {
      contributingPackages.add(packageId);
    }

    for (const [key, value] of Object.entries(contribution.environment)) {
      if (environmentByKey.has(key) && environmentByKey.get(key) !== value) {
        conflict({
          kind: "environment",
          id: key,
          existing: environmentByKey.get(key),
          incoming: value,
          existingPackages: environmentSources.get(key),
          incomingPackage: packageId
        });
      }
      environmentByKey.set(key, value);
      appendSource(environmentSources, key, packageId);
    }

    for (const service of contribution.services) {
      if (servicesById.has(service.id) && !valuesMatch(servicesById.get(service.id), service)) {
        conflict({
          kind: "service",
          id: service.id,
          existing: servicesById.get(service.id),
          incoming: service,
          existingPackages: serviceSources.get(service.id),
          incomingPackage: packageId
        });
      }
      servicesById.set(service.id, service);
      appendSource(serviceSources, service.id, packageId);
    }

    for (const step of contribution.steps) {
      if (stepsById.has(step.id) && !valuesMatch(stepsById.get(step.id), step)) {
        conflict({
          kind: "step",
          id: step.id,
          existing: stepsById.get(step.id),
          incoming: step,
          existingPackages: stepSources.get(step.id),
          incomingPackage: packageId
        });
      }
      stepsById.set(step.id, step);
      appendSource(stepSources, step.id, packageId);
    }
  }

  return {
    environment: Object.fromEntries(
      [...environmentByKey.entries()].sort(([left], [right]) => left.localeCompare(right))
    ),
    services: [...servicesById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    steps: [...stepsById.values()].sort((left, right) => {
      const phaseComparison = left.phase.localeCompare(right.phase);
      return phaseComparison || left.id.localeCompare(right.id);
    }),
    sources: {
      environment: sourcesToObject(environmentSources),
      services: sourcesToObject(serviceSources),
      steps: sourcesToObject(stepSources)
    },
    packages: [...contributingPackages].sort((left, right) => left.localeCompare(right))
  };
}

export {
  CiCompositionError,
  composeCiContributions
};
