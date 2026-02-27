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
  let curated = 0;
  if (bundle.curated !== undefined) {
    if (bundle.curated === true || bundle.curated === 1) {
      curated = 1;
    } else if (bundle.curated === false || bundle.curated === 0) {
      curated = 0;
    } else {
      throw createCliError(`Bundle ${bundleId} curated must be 0 or 1.`);
    }
  }

  let provider = 0;
  if (bundle.provider !== undefined) {
    if (bundle.provider === true || bundle.provider === 1) {
      provider = 1;
    } else if (bundle.provider === false || bundle.provider === 0) {
      provider = 0;
    } else {
      throw createCliError(`Bundle ${bundleId} provider must be 0 or 1.`);
    }
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
    curated,
    provider,
    packages
  };
}
