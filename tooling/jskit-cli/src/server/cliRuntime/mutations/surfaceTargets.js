import path from "node:path";
import { createCliError } from "../../shared/cliError.js";
import { ensureObject } from "../../shared/collectionUtils.js";
import {
  normalizeSurfaceIdForMutation,
  parseSurfaceIdListForMutation
} from "../packageOptions.js";

function normalizeSurfacePagesRootForMutation(value = "") {
  const rawValue = String(value || "").trim();
  if (!rawValue || rawValue === "/") {
    return "";
  }

  return rawValue
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function normalizeSurfacePathForMutation(value = "", { context = "toSurfacePath" } = {}) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  const normalized = rawValue
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
  const segments = normalized.split("/");
  const materializedSegments = [];
  for (const segmentValue of segments) {
    const segment = String(segmentValue || "").trim();
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      throw createCliError(`Invalid ${context}: path traversal is not allowed.`);
    }
    materializedSegments.push(segment);
  }

  return materializedSegments.join("/");
}

function resolveSurfaceDefinitionFromConfigForMutation({
  configContext = {},
  surfaceId = "",
  packageId = ""
} = {}) {
  const normalizedSurfaceId = normalizeSurfaceIdForMutation(surfaceId);
  if (!normalizedSurfaceId) {
    throw createCliError(`Invalid files mutation in ${packageId}: "toSurface" is required when using surface targeting.`);
  }

  const publicConfig = ensureObject(configContext.public);
  const mergedConfig = ensureObject(configContext.merged);
  const sourceDefinitions = ensureObject(publicConfig.surfaceDefinitions);
  const fallbackDefinitions = ensureObject(mergedConfig.surfaceDefinitions);
  const surfaceDefinitions =
    Object.keys(sourceDefinitions).length > 0 ? sourceDefinitions : fallbackDefinitions;

  for (const [key, value] of Object.entries(surfaceDefinitions)) {
    const definition = ensureObject(value);
    const definitionId = normalizeSurfaceIdForMutation(definition.id || key);
    if (definitionId !== normalizedSurfaceId) {
      continue;
    }
    if (definition.enabled === false) {
      throw createCliError(
        `Invalid files mutation in ${packageId}: surface "${normalizedSurfaceId}" is disabled.`
      );
    }
    if (!Object.prototype.hasOwnProperty.call(definition, "pagesRoot")) {
      throw createCliError(
        `Invalid files mutation in ${packageId}: surface "${normalizedSurfaceId}" is missing pagesRoot in config/public.js.`
      );
    }

    return Object.freeze({
      ...definition,
      id: definitionId,
      pagesRoot: normalizeSurfacePagesRootForMutation(definition.pagesRoot)
    });
  }

  throw createCliError(
    `Invalid files mutation in ${packageId}: unknown surface "${normalizedSurfaceId}" in config/public.js.`
  );
}

function resolveSurfaceTargetPathsForMutation({
  appRoot,
  packageId,
  mutation,
  configContext
} = {}) {
  const normalizedSurfaceIds = parseSurfaceIdListForMutation(mutation.toSurface);
  if (normalizedSurfaceIds.length < 1) {
    throw createCliError(`Invalid files mutation in ${packageId}: "toSurface" is required when using surface targeting.`);
  }

  if (mutation.toSurfaceRoot === true) {
    if (String(mutation.toSurfacePath || "").trim()) {
      throw createCliError(
        `Invalid files mutation in ${packageId}: "toSurfacePath" cannot be combined with "toSurfaceRoot".`
      );
    }

    const targetPaths = [];
    for (const surfaceId of normalizedSurfaceIds) {
      const definition = resolveSurfaceDefinitionFromConfigForMutation({
        configContext,
        surfaceId,
        packageId
      });
      if (!definition.pagesRoot) {
        throw createCliError(
          `Invalid files mutation in ${packageId}: root surface "${surfaceId}" cannot use "toSurfaceRoot".`
        );
      }
      targetPaths.push(path.join(appRoot, "src/pages", `${definition.pagesRoot}.vue`));
    }
    return Object.freeze(targetPaths);
  }

  const normalizedSurfacePath = normalizeSurfacePathForMutation(mutation.toSurfacePath, {
    context: "toSurfacePath"
  });
  if (!normalizedSurfacePath) {
    throw createCliError(
      `Invalid files mutation in ${packageId}: "toSurfacePath" is required when using "toSurface".`
    );
  }

  const targetPaths = [];
  for (const surfaceId of normalizedSurfaceIds) {
    const definition = resolveSurfaceDefinitionFromConfigForMutation({
      configContext,
      surfaceId,
      packageId
    });
    const basePagesDirectory = definition.pagesRoot
      ? path.join(appRoot, "src/pages", definition.pagesRoot)
      : path.join(appRoot, "src/pages");
    targetPaths.push(path.join(basePagesDirectory, normalizedSurfacePath));
  }
  return Object.freeze(targetPaths);
}

export {
  resolveSurfaceTargetPathsForMutation
};
