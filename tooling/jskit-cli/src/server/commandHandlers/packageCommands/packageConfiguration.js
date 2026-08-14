import { collectPackageDependencyIds } from "@jskit-ai/kernel/server/support";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../../shared/collectionUtils.js";
import { resolveOptionEnvFallbacks } from "../../cliRuntime/sensitiveOptions.js";

function orderRuntimePackageClosure(
  packageRegistry,
  packageIds,
  resolvePackageKind,
  { includePackage = () => true } = {}
) {
  const visited = new Set();
  const ordered = [];

  function visit(packageId) {
    if (visited.has(packageId)) {
      return;
    }
    visited.add(packageId);
    const packageEntry = packageRegistry.get(packageId);
    if (!packageEntry || resolvePackageKind(packageEntry) !== "runtime") {
      return;
    }
    for (const dependencyId of sortStrings(collectPackageDependencyIds(packageEntry.packageJson))) {
      visit(dependencyId);
    }
    if (includePackage(packageEntry, packageId)) {
      ordered.push(packageId);
    }
  }

  for (const packageId of ensureArray(packageIds)) {
    visit(String(packageId || "").trim());
  }
  return ordered;
}

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
  const existingOrder = orderRuntimePackageClosure(
    packageRegistry,
    sortStrings([...candidates].filter((packageId) => !requested.has(packageId))),
    resolvePackageKind,
    { includePackage: (_entry, packageId) => candidates.has(packageId) && !requested.has(packageId) }
  );
  const requestedOrder = orderRuntimePackageClosure(
    packageRegistry,
    sortStrings([...requested]),
    resolvePackageKind,
    { includePackage: (_entry, packageId) => candidates.has(packageId) }
  );
  return [...new Set([...existingOrder, ...requestedOrder])];
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
  orderRuntimePackageClosure,
  orderRuntimePackagesForConfiguration,
  resolvePackageConfiguration
};
