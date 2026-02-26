import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineModule } from "@jskit-ai/module-framework-core";

const CONTRIBUTION_KEYS = Object.freeze([
  "repositories",
  "services",
  "controllers",
  "runtimeServices",
  "routes",
  "appFeatureServices",
  "appFeatureControllers",
  "actionContributorModules",
  "realtimeTopics",
  "fastifyPlugins",
  "backgroundRuntimeServices"
]);

function normalizeExtensionModulePaths(extensionModulePaths) {
  if (extensionModulePaths == null) {
    return [];
  }

  const rawEntries = Array.isArray(extensionModulePaths)
    ? extensionModulePaths
    : String(extensionModulePaths || "")
        .split(",")
        .map((entry) => String(entry || "").trim());

  const normalized = [];
  const seen = new Set();
  for (const rawEntry of rawEntries) {
    const normalizedEntry = String(rawEntry || "").trim();
    if (!normalizedEntry || seen.has(normalizedEntry)) {
      continue;
    }
    seen.add(normalizedEntry);
    normalized.push(normalizedEntry);
  }

  return normalized;
}

function resolveExtensionPath(rawPath, cwd) {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  return path.resolve(cwd, rawPath);
}

function toExtensionModuleList(source, sourcePath) {
  const candidate = source?.default ?? source?.module ?? source?.extension ?? source;
  if (Array.isArray(candidate)) {
    return candidate;
  }
  if (candidate && typeof candidate === "object") {
    return [candidate];
  }
  throw new TypeError(`Extension module "${sourcePath}" must export a descriptor object or array.`);
}

function normalizeContributionIdList(rawIds, { key, moduleId, sourcePath }) {
  if (rawIds == null) {
    return Object.freeze([]);
  }

  if (!Array.isArray(rawIds)) {
    throw new TypeError(
      `Extension module "${moduleId}" from "${sourcePath}" has invalid contributions.${key}; expected an array.`
    );
  }

  const normalized = [];
  const seen = new Set();
  for (const rawId of rawIds) {
    const normalizedId = String(rawId || "").trim();
    if (!normalizedId || seen.has(normalizedId)) {
      continue;
    }
    seen.add(normalizedId);
    normalized.push(normalizedId);
  }

  return Object.freeze(normalized);
}

function normalizeContributions(rawContributions, { moduleId, sourcePath }) {
  if (rawContributions == null) {
    return Object.freeze({});
  }

  if (typeof rawContributions !== "object" || Array.isArray(rawContributions)) {
    throw new TypeError(
      `Extension module "${moduleId}" from "${sourcePath}" must provide contributions as an object.`
    );
  }

  const normalized = {};
  for (const [key, rawIds] of Object.entries(rawContributions)) {
    if (!CONTRIBUTION_KEYS.includes(key)) {
      throw new TypeError(
        `Extension module "${moduleId}" from "${sourcePath}" uses unsupported contribution key "${key}".`
      );
    }

    const contributionIds = normalizeContributionIdList(rawIds, {
      key,
      moduleId,
      sourcePath
    });
    if (contributionIds.length > 0) {
      normalized[key] = contributionIds;
    }
  }

  return Object.freeze(normalized);
}

function normalizeExtensionDescriptor(descriptor, sourcePath) {
  const normalizedDescriptor = defineModule(descriptor);
  const contributions = normalizeContributions(descriptor?.contributions, {
    moduleId: normalizedDescriptor.id,
    sourcePath
  });

  return Object.freeze({
    ...normalizedDescriptor,
    contributions
  });
}

async function loadFrameworkExtensions({ extensionModulePaths = [], cwd = process.cwd() } = {}) {
  const normalizedPaths = normalizeExtensionModulePaths(extensionModulePaths);
  if (normalizedPaths.length < 1) {
    return Object.freeze([]);
  }

  const loadedModules = [];
  const seenIds = new Set();

  for (const rawPath of normalizedPaths) {
    const resolvedPath = resolveExtensionPath(rawPath, cwd);
    const imported = await import(pathToFileURL(resolvedPath).href);
    const descriptors = toExtensionModuleList(imported, resolvedPath);

    for (const descriptor of descriptors) {
      const normalized = normalizeExtensionDescriptor(descriptor, resolvedPath);
      if (seenIds.has(normalized.id)) {
        throw new TypeError(`Duplicate extension module id "${normalized.id}" from "${resolvedPath}".`);
      }
      seenIds.add(normalized.id);
      loadedModules.push(normalized);
    }
  }

  return Object.freeze(loadedModules);
}

const __testables = {
  normalizeExtensionModulePaths,
  resolveExtensionPath,
  toExtensionModuleList,
  normalizeContributionIdList,
  normalizeContributions,
  normalizeExtensionDescriptor
};

export { loadFrameworkExtensions, __testables };
