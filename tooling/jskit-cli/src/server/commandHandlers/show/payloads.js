import {
  ensureArray,
  ensureObject
} from "../../shared/collectionUtils.js";

async function buildPackageShowPayload({
  packageRegistry,
  packageEntry,
  options,
  inspectPackageOfferings,
  buildFileWriteGroups,
  listDeclaredCapabilities,
  buildCapabilityDetailsForPackage
} = {}) {
  const packageMetadata = packageEntry.packageMetadata;
  const fileWriteGroups = buildFileWriteGroups(
    ensureArray(ensureObject(packageMetadata.mutations).files),
    { packageId: packageMetadata.packageId }
  );
  const fileWriteCount = fileWriteGroups.reduce((total, group) => total + ensureArray(group.files).length, 0);
  const capabilities = ensureObject(packageMetadata.capabilities);
  const runtime = ensureObject(packageMetadata.runtime);
  const metadata = ensureObject(packageMetadata.metadata);
  const mutations = ensureObject(packageMetadata.mutations);
  const packageInsights = await inspectPackageOfferings({ packageEntry });
  const dependencies = Object.keys(ensureObject(packageEntry?.packageJson?.dependencies));

  const payload = {
    kind: "package",
    packageId: packageMetadata.packageId,
    version: packageMetadata.version,
    description: String(packageMetadata.description || ""),
    dependencies,
    capabilities,
    options: ensureObject(packageMetadata.options),
    runtime,
    metadata,
    mutations,
    fileWritePlan: {
      groupCount: fileWriteGroups.length,
      fileCount: fileWriteCount,
      groups: fileWriteGroups
    },
    manifestPath: packageEntry.manifestRelativePath,
    introspection: {
      available: Boolean(packageInsights.available),
      notes: ensureArray(packageInsights.notes)
    },
    packageExports: ensureArray(packageInsights.packageExports),
    containerBindings: ensureObject(packageInsights.containerBindings),
    exportedSymbols: ensureArray(packageInsights.exportedSymbols)
  };

  const provides = listDeclaredCapabilities(payload.capabilities, "provides");
  const requires = listDeclaredCapabilities(payload.capabilities, "requires");
  const capabilityDetails = options.details
    ? buildCapabilityDetailsForPackage({
        packageRegistry,
        packageId: payload.packageId,
        dependencies: payload.dependencies,
        provides,
        requires
      })
    : null;

  if (capabilityDetails) {
    payload.capabilityDetails = capabilityDetails;
  }

  return {
    payload,
    provides,
    requires,
    capabilityDetails
  };
}

function buildBundleShowPayload(bundle = {}) {
  return {
    kind: "bundle",
    bundleId: bundle.bundleId,
    version: bundle.version,
    description: String(bundle.description || ""),
    provider: Number(bundle.provider) === 1,
    curated: Number(bundle.curated) === 1,
    packages: ensureArray(bundle.packages).map((value) => String(value))
  };
}

export {
  buildBundleShowPayload,
  buildPackageShowPayload
};
