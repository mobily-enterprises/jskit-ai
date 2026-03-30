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
  const descriptor = packageEntry.descriptor;
  const fileWriteGroups = buildFileWriteGroups(
    ensureArray(ensureObject(descriptor.mutations).files),
    { packageId: descriptor.packageId }
  );
  const fileWriteCount = fileWriteGroups.reduce((total, group) => total + ensureArray(group.files).length, 0);
  const capabilities = ensureObject(descriptor.capabilities);
  const runtime = ensureObject(descriptor.runtime);
  const metadata = ensureObject(descriptor.metadata);
  const mutations = ensureObject(descriptor.mutations);
  const packageInsights = await inspectPackageOfferings({ packageEntry });

  const payload = {
    kind: "package",
    packageId: descriptor.packageId,
    version: descriptor.version,
    description: String(descriptor.description || ""),
    dependsOn: ensureArray(descriptor.dependsOn).map((value) => String(value)),
    capabilities,
    options: ensureObject(descriptor.options),
    runtime,
    metadata,
    mutations,
    fileWritePlan: {
      groupCount: fileWriteGroups.length,
      fileCount: fileWriteCount,
      groups: fileWriteGroups
    },
    descriptorPath: packageEntry.descriptorRelativePath,
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
        dependsOn: payload.dependsOn,
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
