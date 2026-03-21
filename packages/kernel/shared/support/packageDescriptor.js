import { access, constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDescriptorCandidatePaths({ appRoot, packageId, installedPackageState }) {
  const normalizedAppRoot = String(appRoot || "").trim();
  if (!normalizedAppRoot) {
    throw new TypeError("resolveDescriptorCandidatePaths requires appRoot.");
  }

  const normalizedPackageId = String(packageId || "").trim();
  if (!normalizedPackageId) {
    throw new TypeError("resolveDescriptorCandidatePaths requires packageId.");
  }

  const source = ensureObject(installedPackageState?.source);
  const descriptorPathFromSource = String(source.descriptorPath || "").trim();
  const packagePathFromSource = String(source.packagePath || "").trim();
  const jskitRoot = path.join(normalizedAppRoot, "node_modules", "@jskit-ai", "jskit-cli");

  const candidatePaths = [path.resolve(normalizedAppRoot, "node_modules", normalizedPackageId, "package.descriptor.mjs")];
  if (packagePathFromSource) {
    candidatePaths.push(path.resolve(normalizedAppRoot, packagePathFromSource, "package.descriptor.mjs"));
  }
  if (descriptorPathFromSource) {
    candidatePaths.push(path.resolve(normalizedAppRoot, descriptorPathFromSource));
    candidatePaths.push(path.resolve(jskitRoot, descriptorPathFromSource));
  }

  const uniqueCandidatePaths = [];
  const seenPaths = new Set();
  for (const candidatePath of candidatePaths) {
    const normalizedCandidatePath = String(candidatePath || "").trim();
    if (!normalizedCandidatePath || seenPaths.has(normalizedCandidatePath)) {
      continue;
    }
    seenPaths.add(normalizedCandidatePath);
    uniqueCandidatePaths.push(normalizedCandidatePath);
  }

  return uniqueCandidatePaths;
}

async function resolveDescriptorPathForInstalledPackage({ appRoot, packageId, installedPackageState, required = false }) {
  const candidatePaths = resolveDescriptorCandidatePaths({
    appRoot,
    packageId,
    installedPackageState
  });

  for (const candidatePath of candidatePaths) {
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  if (required === true) {
    throw new Error(`Unable to resolve package descriptor for ${String(packageId || "").trim()}.`);
  }

  return "";
}

function normalizeDescriptorPayload(descriptorModule) {
  return ensureObject(descriptorModule?.default);
}

async function loadInstalledPackageDescriptor({ appRoot, packageId, installedPackageState, required = false }) {
  const descriptorPath = await resolveDescriptorPathForInstalledPackage({
    appRoot,
    packageId,
    installedPackageState,
    required
  });

  if (!descriptorPath) {
    return Object.freeze({
      descriptorPath: "",
      descriptor: Object.freeze({})
    });
  }

  try {
    const descriptorModule = await import(pathToFileURL(descriptorPath).href + `?t=${Date.now()}_${Math.random()}`);
    return Object.freeze({
      descriptorPath,
      descriptor: normalizeDescriptorPayload(descriptorModule)
    });
  } catch (error) {
    if (required === true) {
      throw error;
    }

    return Object.freeze({
      descriptorPath: "",
      descriptor: Object.freeze({})
    });
  }
}

export { loadInstalledPackageDescriptor, resolveDescriptorPathForInstalledPackage };
