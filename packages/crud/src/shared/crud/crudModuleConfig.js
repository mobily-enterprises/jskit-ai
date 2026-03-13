import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import {
  isWorkspaceVisibility,
  resolveUsersApiBasePath
} from "@jskit-ai/users-core/shared/support/usersApiPaths";

const DEFAULT_VISIBILITY = "workspace";
const CRUD_MODULE_ID = "crud";

function normalizeCrudNamespace(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCrudVisibility(value, { fallback = DEFAULT_VISIBILITY } = {}) {
  return normalizeRouteVisibility(value, { fallback });
}

function resolveCrudNamespacePath(namespace = "") {
  const normalizedNamespace = normalizeCrudNamespace(namespace);
  return normalizedNamespace ? `/${normalizedNamespace}` : "";
}

function resolveCrudRelativePath(namespace = "") {
  const namespacePath = resolveCrudNamespacePath(namespace);
  return namespacePath || "/crud";
}

function resolveCrudApiBasePath({ namespace = "", visibility = DEFAULT_VISIBILITY } = {}) {
  const normalizedVisibility = normalizeCrudVisibility(visibility);
  const relativePath = resolveCrudRelativePath(namespace);
  return resolveUsersApiBasePath({
    visibility: normalizedVisibility,
    relativePath
  });
}

function resolveCrudTableName(namespace = "") {
  const normalizedNamespace = normalizeCrudNamespace(namespace);
  if (!normalizedNamespace) {
    return "crud";
  }

  return `crud_${normalizedNamespace.replace(/-/g, "_")}`;
}

function resolveCrudTokenPart(namespace = "") {
  const normalizedNamespace = normalizeCrudNamespace(namespace);
  return normalizedNamespace ? normalizedNamespace.replace(/-/g, "_") : "";
}

function resolveCrudActionIdPrefix(namespace = "") {
  const tokenPart = resolveCrudTokenPart(namespace);
  if (!tokenPart) {
    return "crud";
  }

  return `crud.${tokenPart}`;
}

function resolveCrudContributorId(namespace = "") {
  const tokenPart = resolveCrudTokenPart(namespace);
  if (!tokenPart) {
    return "crud";
  }

  return `crud.${tokenPart}`;
}

function resolveCrudDomain(namespace = "") {
  return "crud";
}

function resolveCrudToken(namespace = "", suffix = "") {
  const contributorId = resolveCrudContributorId(namespace);
  return suffix ? `${contributorId}.${suffix}` : contributorId;
}

function resolveCrudConfig(source = {}) {
  const settings = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const namespace = normalizeCrudNamespace(settings.namespace);
  const visibility = normalizeCrudVisibility(settings.visibility);

  return Object.freeze({
    namespace,
    visibility,
    workspaceScoped: isWorkspaceVisibility(visibility),
    namespacePath: resolveCrudNamespacePath(namespace),
    relativePath: resolveCrudRelativePath(namespace),
    apiBasePath: resolveCrudApiBasePath({ namespace, visibility }),
    tableName: resolveCrudTableName(namespace),
    actionIdPrefix: resolveCrudActionIdPrefix(namespace),
    contributorId: resolveCrudContributorId(namespace),
    domain: resolveCrudDomain(namespace),
    repositoryToken: resolveCrudToken(namespace, "repository"),
    serviceToken: resolveCrudToken(namespace, "service")
  });
}

function resolveCrudConfigsFromModules(modulesSource = {}) {
  const modules = modulesSource && typeof modulesSource === "object" && !Array.isArray(modulesSource)
    ? modulesSource
    : {};
  const configs = [];
  const seenContributorIds = new Set();

  for (const moduleConfig of Object.values(modules)) {
    const source = moduleConfig && typeof moduleConfig === "object" && !Array.isArray(moduleConfig)
      ? moduleConfig
      : {};

    if (normalizeText(source.module).toLowerCase() !== CRUD_MODULE_ID) {
      continue;
    }

    const resolved = resolveCrudConfig(source);
    if (seenContributorIds.has(resolved.contributorId)) {
      throw new Error(`Duplicate CRUD namespace in config.modules: "${resolved.namespace || "default"}".`);
    }
    seenContributorIds.add(resolved.contributorId);
    configs.push(resolved);
  }

  return configs;
}

function resolveCrudConfigFromModules(modulesSource = {}, options = {}) {
  const configs = resolveCrudConfigsFromModules(modulesSource);
  const hasNamespace = Object.hasOwn(options, "namespace");
  if (hasNamespace) {
    const normalizedNamespace = normalizeCrudNamespace(options.namespace);
    return configs.find((entry) => entry.namespace === normalizedNamespace) || null;
  }

  if (configs.length === 1) {
    return configs[0];
  }

  return null;
}

export {
  CRUD_MODULE_ID,
  DEFAULT_VISIBILITY,
  normalizeCrudNamespace,
  normalizeCrudVisibility,
  isWorkspaceVisibility,
  resolveCrudNamespacePath,
  resolveCrudRelativePath,
  resolveCrudApiBasePath,
  resolveCrudTableName,
  resolveCrudActionIdPrefix,
  resolveCrudContributorId,
  resolveCrudDomain,
  resolveCrudConfig,
  resolveCrudConfigsFromModules,
  resolveCrudConfigFromModules
};
