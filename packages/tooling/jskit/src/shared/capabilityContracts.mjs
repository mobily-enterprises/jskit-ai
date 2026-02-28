import { access, constants as fsConstants, readFile } from "node:fs/promises";
import path from "node:path";
import {
  CAPABILITY_CONTRACT_IDS,
  CAPABILITY_CONTRACTS,
  getCapabilityContractTestRelativePath
} from "../../contracts/capabilities/index.mjs";

function toSortedUniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeExportEntryTarget(exportEntry) {
  if (typeof exportEntry === "string") {
    const normalized = String(exportEntry || "").trim();
    return normalized || null;
  }
  if (!exportEntry || typeof exportEntry !== "object" || Array.isArray(exportEntry)) {
    return null;
  }

  for (const key of ["import", "default", "node", "module", "browser", "worker", "require"]) {
    const resolved = normalizeExportEntryTarget(exportEntry[key]);
    if (resolved) {
      return resolved;
    }
  }

  for (const value of Object.values(exportEntry)) {
    const resolved = normalizeExportEntryTarget(value);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

async function fileExists(absolutePath) {
  try {
    await access(absolutePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isInsidePath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readPackageJson(packageRoot, packageJsonCache) {
  if (packageJsonCache.has(packageRoot)) {
    return packageJsonCache.get(packageRoot);
  }

  const packageJsonPath = path.join(packageRoot, "package.json");
  const source = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(source);
  packageJsonCache.set(packageRoot, parsed);
  return parsed;
}

async function resolveContractEntrypointModulePath({ packageEntry, capabilityId, entrypoint, packageJsonCache }) {
  const packageRoot = path.resolve(packageEntry.packageRoot);
  const packageJson = await readPackageJson(packageRoot, packageJsonCache);
  const exportsField = packageJson?.exports;
  const normalizedEntrypoint = String(entrypoint || "").trim() || ".";

  let target = null;
  if (typeof exportsField === "string") {
    if (normalizedEntrypoint === ".") {
      target = normalizeExportEntryTarget(exportsField);
    }
  } else if (exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)) {
    target = normalizeExportEntryTarget(exportsField[normalizedEntrypoint]);
  }

  if (!target) {
    return {
      ok: false,
      issue:
        `Capability ${capabilityId} contract requires export ${normalizedEntrypoint}, ` +
        `but package ${packageEntry.descriptor.packageId} does not expose it.`
    };
  }

  const normalizedTarget = String(target || "").trim();
  if (!normalizedTarget) {
    return {
      ok: false,
      issue:
        `Capability ${capabilityId} contract resolved an empty export target for ` +
        `${packageEntry.descriptor.packageId}:${normalizedEntrypoint}.`
    };
  }

  const resolvedPath = path.resolve(packageRoot, normalizedTarget);
  if (!isInsidePath(packageRoot, resolvedPath)) {
    return {
      ok: false,
      issue:
        `Capability ${capabilityId} contract entrypoint for ${packageEntry.descriptor.packageId} ` +
        `escapes package root (${normalizedTarget}).`
    };
  }

  if (!(await fileExists(resolvedPath))) {
    return {
      ok: false,
      issue:
        `Capability ${capabilityId} contract entrypoint for ${packageEntry.descriptor.packageId} ` +
        `points to missing file ${normalizedTarget}.`
    };
  }

  return {
    ok: true,
    resolvedPath
  };
}

function extractModuleNamedExports(source) {
  const symbols = new Set();
  const input = String(source || "");

  for (const match of input.matchAll(/export\s*\{([\s\S]*?)\}\s*(?:from\s*["'][^"']+["'])?\s*;/g)) {
    const block = String(match[1] || "");
    for (const rawSpec of block.split(",")) {
      const spec = String(rawSpec || "").trim();
      if (!spec) {
        continue;
      }
      const aliasMatch = spec.match(/\bas\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (aliasMatch) {
        symbols.add(aliasMatch[1]);
        continue;
      }
      const nameMatch = spec.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (nameMatch) {
        symbols.add(nameMatch[1]);
      }
    }
  }

  for (const match of input.matchAll(/export\s+\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["'][^"']+["']/g)) {
    symbols.add(match[1]);
  }

  for (const match of input.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    symbols.add(match[1]);
  }

  for (const match of input.matchAll(/export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    symbols.add(match[1]);
  }

  for (const match of input.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    symbols.add(match[1]);
  }

  return toSortedUniqueStrings([...symbols]);
}

async function loadEntrypointNamedExports(resolvedPath, moduleCache) {
  if (moduleCache.has(resolvedPath)) {
    return moduleCache.get(resolvedPath);
  }

  const source = await readFile(resolvedPath, "utf8");
  const symbols = extractModuleNamedExports(source);
  moduleCache.set(resolvedPath, symbols);
  return symbols;
}

async function validateProviderContractSymbols({
  contract,
  capabilityId,
  providerPackageId,
  packageEntry,
  packageJsonCache,
  moduleCache
}) {
  const entrypoint = String(contract.entrypoint || "").trim();
  const symbols = toSortedUniqueStrings(contract.symbols || []);
  if (!entrypoint || symbols.length < 1) {
    return [];
  }

  if (entrypoint.startsWith("descriptor:")) {
    const descriptorRelativePath = String(entrypoint.slice("descriptor:".length) || "").trim();
    if (!descriptorRelativePath) {
      return [
        `Capability ${capabilityId} contract entrypoint for ${providerPackageId} has invalid descriptor entrypoint ${entrypoint}.`
      ];
    }
    const descriptorPath = path.resolve(packageEntry.packageRoot, descriptorRelativePath);
    if (!(await fileExists(descriptorPath))) {
      return [
        `Capability ${capabilityId} contract descriptor entrypoint for ${providerPackageId} points to missing file ${descriptorRelativePath}.`
      ];
    }
    return [];
  }

  const resolved = await resolveContractEntrypointModulePath({
    packageEntry,
    capabilityId,
    entrypoint,
    packageJsonCache
  });
  if (!resolved.ok) {
    return [resolved.issue];
  }

  const exportedSymbols = await loadEntrypointNamedExports(resolved.resolvedPath, moduleCache);
  const exportedSymbolSet = new Set(exportedSymbols);
  const missingSymbols = symbols.filter((symbol) => !exportedSymbolSet.has(symbol));
  if (missingSymbols.length < 1) {
    return [];
  }

  return [
    `Capability ${capabilityId} contract is not satisfied by ${providerPackageId}:${entrypoint}; ` +
      `missing exports: ${missingSymbols.join(", ")}.`
  ];
}

function buildCapabilityUsageGraph(availablePackages) {
  const usageByCapability = new Map();

  for (const packageEntry of availablePackages.values()) {
    const packageId = packageEntry?.descriptor?.packageId;
    if (!packageId) {
      continue;
    }

    const provides = Array.isArray(packageEntry?.descriptor?.capabilities?.provides)
      ? packageEntry.descriptor.capabilities.provides
      : [];
    const requires = Array.isArray(packageEntry?.descriptor?.capabilities?.requires)
      ? packageEntry.descriptor.capabilities.requires
      : [];

    for (const rawCapabilityId of provides) {
      const capabilityId = String(rawCapabilityId || "").trim();
      if (!capabilityId) {
        continue;
      }
      if (!usageByCapability.has(capabilityId)) {
        usageByCapability.set(capabilityId, {
          providers: new Set(),
          consumers: new Set()
        });
      }
      usageByCapability.get(capabilityId).providers.add(packageId);
    }

    for (const rawCapabilityId of requires) {
      const capabilityId = String(rawCapabilityId || "").trim();
      if (!capabilityId) {
        continue;
      }
      if (!usageByCapability.has(capabilityId)) {
        usageByCapability.set(capabilityId, {
          providers: new Set(),
          consumers: new Set()
        });
      }
      usageByCapability.get(capabilityId).consumers.add(packageId);
    }
  }

  return usageByCapability;
}

function listCapabilityUsage(availablePackages) {
  const usageByCapability = buildCapabilityUsageGraph(availablePackages);
  return [...usageByCapability.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([capabilityId, usage]) => ({
      capabilityId,
      providers: toSortedUniqueStrings([...usage.providers]),
      consumers: toSortedUniqueStrings([...usage.consumers])
    }));
}

async function validateCapabilityContracts(availablePackages) {
  const issues = [];
  const usageByCapability = buildCapabilityUsageGraph(availablePackages);
  const usedCapabilityIds = [...usageByCapability.keys()].sort((left, right) => left.localeCompare(right));
  const packageJsonCache = new Map();
  const moduleCache = new Map();

  for (const capabilityId of usedCapabilityIds) {
    const contract = CAPABILITY_CONTRACTS[capabilityId];
    if (!contract) {
      issues.push(`Capability ${capabilityId} is referenced in descriptors but missing from central contracts.`);
      continue;
    }

    const kind = String(contract.kind || "").trim();
    const summary = String(contract.summary || "").trim();
    if (!kind) {
      issues.push(`Capability ${capabilityId} contract must define kind.`);
    }
    if (!summary) {
      issues.push(`Capability ${capabilityId} contract must define summary.`);
    }

    const contractCapabilityId = String(contract.capabilityId || "").trim();
    if (contractCapabilityId !== capabilityId) {
      issues.push(
        `Capability ${capabilityId} contract must set capabilityId to ${capabilityId} (found ${contractCapabilityId || "<empty>"}).`
      );
    }

    const entrypoint = String(contract.entrypoint || "").trim();
    if (!entrypoint) {
      issues.push(`Capability ${capabilityId} contract entrypoint must be a non-empty export key.`);
    }

    const symbols = toSortedUniqueStrings(contract.symbols || []);
    if (symbols.length < 1) {
      issues.push(`Capability ${capabilityId} contract must define at least one symbol.`);
    }

    const requireContractTest = Number(contract.requireContractTest || 0);
    if (requireContractTest !== 0 && requireContractTest !== 1) {
      issues.push(`Capability ${capabilityId} contract requireContractTest must be 0 or 1.`);
    }

    const usage = usageByCapability.get(capabilityId);
    const providers = toSortedUniqueStrings([...(usage?.providers || new Set())]);

    for (const providerPackageId of providers) {
      const packageEntry = availablePackages.get(providerPackageId);
      if (!packageEntry) {
        issues.push(
          `Capability ${capabilityId} provider ${providerPackageId} was not found in descriptor catalog.`
        );
        continue;
      }

      if (requireContractTest === 1) {
        const relativeTestPath = getCapabilityContractTestRelativePath(capabilityId);
        if (!relativeTestPath) {
          issues.push(`Capability ${capabilityId} contract requires tests but has invalid test path.`);
        } else {
          const absoluteTestPath = path.join(packageEntry.packageRoot, relativeTestPath);
          if (!(await fileExists(absoluteTestPath))) {
            issues.push(
              `Capability ${capabilityId} provider ${providerPackageId} is missing contract test ${relativeTestPath}.`
            );
          }
        }
      }

      if (symbols.length > 0) {
        const symbolIssues = await validateProviderContractSymbols({
          contract: {
            ...contract,
            symbols
          },
          capabilityId,
          providerPackageId,
          packageEntry,
          packageJsonCache,
          moduleCache
        });
        issues.push(...symbolIssues);
      }
    }
  }

  for (const capabilityId of CAPABILITY_CONTRACT_IDS) {
    if (!usageByCapability.has(capabilityId)) {
      issues.push(`Capability ${capabilityId} exists in central contracts but is unused by descriptors.`);
    }
  }

  return {
    ok: issues.length < 1,
    issues,
    contractCount: CAPABILITY_CONTRACT_IDS.length,
    usedCapabilityCount: usedCapabilityIds.length
  };
}

export { buildCapabilityUsageGraph, listCapabilityUsage, validateCapabilityContracts };
