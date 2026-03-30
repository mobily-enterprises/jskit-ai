import { createCliError } from "../shared/cliError.js";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../shared/collectionUtils.js";

const BUILTIN_CAPABILITY_PROVIDERS = Object.freeze({
  "runtime.actions": Object.freeze(["@jskit-ai/kernel"])
});

function listDeclaredCapabilities(capabilitiesSection, fieldName) {
  const section = ensureObject(capabilitiesSection);
  const source = ensureArray(section[fieldName]);
  const normalized = [];
  const seen = new Set();
  for (const value of source) {
    const capabilityId = String(value || "").trim();
    if (!capabilityId || seen.has(capabilityId)) {
      continue;
    }
    seen.add(capabilityId);
    normalized.push(capabilityId);
  }
  return normalized;
}

function buildCapabilityGraph(packageRegistry) {
  const graph = new Map();
  const ensureNode = (capabilityId) => {
    if (!graph.has(capabilityId)) {
      graph.set(capabilityId, {
        providers: new Set(),
        requirers: new Set()
      });
    }
    return graph.get(capabilityId);
  };

  for (const [packageId, packageEntry] of packageRegistry.entries()) {
    const capabilities = ensureObject(packageEntry?.descriptor?.capabilities);
    for (const capabilityId of listDeclaredCapabilities(capabilities, "provides")) {
      ensureNode(capabilityId).providers.add(packageId);
    }
    for (const capabilityId of listDeclaredCapabilities(capabilities, "requires")) {
      ensureNode(capabilityId).requirers.add(packageId);
    }
  }

  for (const [capabilityId, providers] of Object.entries(BUILTIN_CAPABILITY_PROVIDERS)) {
    const node = ensureNode(capabilityId);
    for (const providerId of ensureArray(providers).map((value) => String(value || "").trim()).filter(Boolean)) {
      node.providers.add(providerId);
    }
  }

  const normalizedGraph = new Map();
  for (const [capabilityId, node] of graph.entries()) {
    normalizedGraph.set(capabilityId, {
      providers: sortStrings([...node.providers]),
      requirers: sortStrings([...node.requirers])
    });
  }
  return normalizedGraph;
}

function createCapabilityPackageDetail(packageId, packageRegistry) {
  const packageEntry = packageRegistry.get(packageId);
  return {
    packageId,
    version: String(packageEntry?.version || packageEntry?.descriptor?.version || "").trim(),
    descriptorPath: String(packageEntry?.descriptorRelativePath || "").trim()
  };
}

function buildCapabilityDetailsForPackage({ packageRegistry, packageId, dependsOn = [], provides = [], requires = [] }) {
  const graph = buildCapabilityGraph(packageRegistry);
  const dependsOnSet = new Set(ensureArray(dependsOn).map((value) => String(value || "").trim()).filter(Boolean));

  function buildCapabilityRecord(capabilityId) {
    const node = graph.get(capabilityId) || {
      providers: [],
      requirers: []
    };
    const providers = sortStrings(ensureArray(node.providers));
    const requirers = sortStrings(ensureArray(node.requirers));
    const providersInDependsOn = providers.filter((providerId) => dependsOnSet.has(providerId));
    return {
      capabilityId,
      providers,
      requirers,
      providersInDependsOn,
      providerDetails: providers.map((providerId) => createCapabilityPackageDetail(providerId, packageRegistry)),
      requirerDetails: requirers.map((requirerId) => createCapabilityPackageDetail(requirerId, packageRegistry)),
      isProvidedByCurrentPackage: providers.includes(packageId),
      isRequiredByCurrentPackage: requirers.includes(packageId)
    };
  }

  return {
    provides: ensureArray(provides).map((capabilityId) => buildCapabilityRecord(capabilityId)),
    requires: ensureArray(requires).map((capabilityId) => buildCapabilityRecord(capabilityId))
  };
}

function collectPlannedCapabilityIssues(plannedPackageIds, packageRegistry) {
  const selectedPackageIds = sortStrings(
    [...new Set(ensureArray(plannedPackageIds).map((value) => String(value || "").trim()).filter(Boolean))]
  );
  const selectedPackageSet = new Set(selectedPackageIds);
  const providersByCapability = new Map();

  for (const [capabilityId, providers] of Object.entries(BUILTIN_CAPABILITY_PROVIDERS)) {
    if (!providersByCapability.has(capabilityId)) {
      providersByCapability.set(capabilityId, new Set());
    }
    for (const providerId of ensureArray(providers).map((value) => String(value || "").trim()).filter(Boolean)) {
      providersByCapability.get(capabilityId).add(providerId);
    }
  }

  for (const packageId of selectedPackageIds) {
    const packageEntry = packageRegistry.get(packageId);
    if (!packageEntry) {
      continue;
    }
    const provides = listDeclaredCapabilities(packageEntry.descriptor.capabilities, "provides");
    for (const capabilityId of provides) {
      if (!providersByCapability.has(capabilityId)) {
        providersByCapability.set(capabilityId, new Set());
      }
      providersByCapability.get(capabilityId).add(packageId);
    }
  }

  const issues = [];
  for (const packageId of selectedPackageIds) {
    const packageEntry = packageRegistry.get(packageId);
    if (!packageEntry) {
      continue;
    }
    const requires = listDeclaredCapabilities(packageEntry.descriptor.capabilities, "requires");
    for (const capabilityId of requires) {
      const selectedProviders = providersByCapability.get(capabilityId);
      if (selectedProviders && selectedProviders.size > 0) {
        continue;
      }

      const availableProviders = [];
      for (const [candidatePackageId, candidatePackageEntry] of packageRegistry.entries()) {
        if (selectedPackageSet.has(candidatePackageId)) {
          continue;
        }
        const candidateProvides = listDeclaredCapabilities(candidatePackageEntry.descriptor.capabilities, "provides");
        if (candidateProvides.includes(capabilityId)) {
          availableProviders.push(candidatePackageId);
        }
      }

      issues.push({
        packageId,
        capabilityId,
        availableProviders: sortStrings(availableProviders)
      });
    }
  }

  return issues;
}

function validatePlannedCapabilityClosure(plannedPackageIds, packageRegistry, actionLabel) {
  const issues = collectPlannedCapabilityIssues(plannedPackageIds, packageRegistry);
  if (issues.length === 0) {
    return;
  }

  const lines = [`Cannot ${actionLabel}: capability requirements are not satisfied.`];
  for (const issue of issues) {
    const providersHint = issue.availableProviders.length > 0
      ? ` Available providers: ${issue.availableProviders.join(", ")}.`
      : "";
    lines.push(
      `- ${issue.packageId} requires capability ${issue.capabilityId}, but no selected package provides it.${providersHint}`
    );
  }

  throw createCliError(lines.join("\n"));
}

export {
  listDeclaredCapabilities,
  buildCapabilityDetailsForPackage,
  validatePlannedCapabilityClosure
};
