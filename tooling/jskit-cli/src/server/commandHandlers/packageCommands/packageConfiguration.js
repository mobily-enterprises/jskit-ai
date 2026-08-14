import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";
import { resolveOptionEnvFallbacks } from "../../cliRuntime/sensitiveOptions.js";

function orderRuntimePackagesForConfiguration(packageRegistry, requestedPackageIds, resolvePackageKind) {
  const requested = new Set(
    ensureArray(requestedPackageIds).map((value) => String(value || "").trim())
  );
  const candidates = new Set(
    [...packageRegistry.entries()]
      .filter(([, packageEntry]) => {
        return resolvePackageKind(packageEntry) === "runtime" &&
          Object.keys(ensureObject(packageEntry?.packageMetadata?.options)).length > 0;
      })
      .map(([packageId]) => packageId)
  );
  const visited = new Set();
  const ordered = [];

  function visit(packageId, { allowRequested = false } = {}) {
    if (visited.has(packageId) || !candidates.has(packageId)) {
      return;
    }
    if (requested.has(packageId) && !allowRequested) {
      return;
    }
    visited.add(packageId);
    const packageEntry = packageRegistry.get(packageId);
    const dependencyIds = new Set();
    for (const sectionName of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const dependencyId of Object.keys(ensureObject(packageEntry?.packageJson?.[sectionName]))) {
        dependencyIds.add(String(dependencyId || "").trim());
      }
    }
    for (const dependencyId of sortStrings([...dependencyIds])) {
      visit(dependencyId);
    }
    ordered.push(packageId);
  }

  for (const packageId of sortStrings([...candidates].filter((packageId) => !requested.has(packageId)))) {
    visit(packageId);
  }
  for (const packageId of sortStrings([...requested])) {
    visit(packageId, { allowRequested: true });
  }
  return ordered;
}

async function resolvePackageOptionInput({
  packageEntry,
  inlineOptions,
  appRoot,
  readFileBufferIfExists
}) {
  const normalizedInlineOptions = ensureObject(inlineOptions);
  const envFallbacks = await resolveOptionEnvFallbacks({
    packageEntry,
    appRoot,
    optionInput: normalizedInlineOptions,
    readFileBufferIfExists
  });
  return {
    ...envFallbacks,
    ...normalizedInlineOptions
  };
}

async function resolvePackageConfiguration({
  packageRegistry,
  configurationRegistry,
  requestedPackageIds,
  packagesToApply,
  invocationMode,
  targetType,
  resolvedTargetPackageId,
  inlineOptions,
  resolvePackageKind,
  resolveBundleInlineOptionsForPackage,
  resolvePackageOptions,
  appRoot,
  readFileBufferIfExists,
  io
}) {
  const configurationOrder = invocationMode === "add"
    ? orderRuntimePackagesForConfiguration(
        configurationRegistry,
        requestedPackageIds,
        resolvePackageKind
      )
    : packagesToApply;
  const resolvedOptionsByPackage = {};
  const promptedPackageIds = new Set();

  for (const packageId of configurationOrder) {
    const packageEntry = packageRegistry.get(packageId);
    const isRequestedPackage = requestedPackageIds.includes(packageId);
    const isDirectTargetPackage = targetType === "package" && packageId === resolvedTargetPackageId;
    const packageInlineOptions = isRequestedPackage && targetType === "bundle"
      ? resolveBundleInlineOptionsForPackage(packageEntry, inlineOptions)
      : isDirectTargetPackage
        ? ensureObject(inlineOptions)
        : {};
    const optionInput = await resolvePackageOptionInput({
      packageEntry,
      inlineOptions: packageInlineOptions,
      appRoot,
      readFileBufferIfExists
    });
    resolvedOptionsByPackage[packageId] = await resolvePackageOptions(
      packageEntry,
      optionInput,
      io,
      {
        appRoot,
        onPrompt: () => promptedPackageIds.add(packageId)
      }
    );
  }

  const configuredPackagesToApply = [
    ...configurationOrder.filter((packageId) =>
      promptedPackageIds.has(packageId) && !requestedPackageIds.includes(packageId)
    ),
    ...packagesToApply
  ];

  for (const packageId of configuredPackagesToApply) {
    if (Object.prototype.hasOwnProperty.call(resolvedOptionsByPackage, packageId)) {
      continue;
    }
    const packageEntry = packageRegistry.get(packageId);
    const packageInlineOptions = targetType === "bundle"
      ? resolveBundleInlineOptionsForPackage(packageEntry, inlineOptions)
      : ensureObject(inlineOptions);
    const optionInput = await resolvePackageOptionInput({
      packageEntry,
      inlineOptions: packageInlineOptions,
      appRoot,
      readFileBufferIfExists
    });
    resolvedOptionsByPackage[packageId] = await resolvePackageOptions(
      packageEntry,
      optionInput,
      io,
      { appRoot }
    );
  }

  return {
    packagesToApply: configuredPackagesToApply,
    resolvedOptionsByPackage
  };
}

export {
  orderRuntimePackagesForConfiguration,
  resolvePackageConfiguration
};
