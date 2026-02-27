import { createCliError, ensureBundleId, ensureObject, ensurePackageId } from "./validationHelpers.mjs";

export function normalizeBundleDescriptor(bundle, descriptorPath) {
  ensureObject(bundle, `Bundle descriptor at ${descriptorPath}`);

  if (Number(bundle.bundleVersion) !== 1) {
    throw createCliError(`Bundle descriptor ${descriptorPath} must set bundleVersion to 1.`);
  }

  const bundleId = ensureBundleId(bundle.bundleId, `Bundle descriptor ${descriptorPath} bundleId`);
  const version = String(bundle.version || "").trim();
  if (!version) {
    throw createCliError(`Bundle descriptor ${descriptorPath} must define version.`);
  }

  if (bundle.options !== undefined) {
    throw createCliError(`Bundle ${bundleId} must not define options. Bundles are static package lists.`);
  }

  const packages = (Array.isArray(bundle.packages) ? bundle.packages : []).map((entry, index) => {
    if (typeof entry !== "string") {
      throw createCliError(
        `Bundle ${bundleId} packages[${index}] must be a package id string. Conditional mappings are not supported.`
      );
    }
    return ensurePackageId(entry, `Bundle ${bundleId} packages[${index}]`);
  });

  if (packages.length < 1) {
    throw createCliError(`Bundle descriptor ${descriptorPath} must define at least one package.`);
  }

  return {
    bundleVersion: 1,
    bundleId,
    version,
    description: String(bundle.description || "").trim(),
    packages
  };
}
