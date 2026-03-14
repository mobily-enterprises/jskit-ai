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

function requireCrudNamespace(namespace, { context = "CRUD config" } = {}) {
  const normalizedNamespace = normalizeCrudNamespace(namespace);
  if (!normalizedNamespace) {
    throw new TypeError(`${context} requires a non-empty namespace.`);
  }

  return normalizedNamespace;
}

function resolveCrudNamespacePath(namespace = "") {
  const normalizedNamespace = requireCrudNamespace(namespace, {
    context: "resolveCrudNamespacePath"
  });
  return `/${normalizedNamespace}`;
}

function resolveCrudRelativePath(namespace = "") {
  return resolveCrudNamespacePath(namespace);
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
  const normalizedNamespace = requireCrudNamespace(namespace, {
    context: "resolveCrudTableName"
  });
  return `crud_${normalizedNamespace.replace(/-/g, "_")}`;
}

function resolveCrudTokenPart(namespace = "") {
  const normalizedNamespace = requireCrudNamespace(namespace, {
    context: "resolveCrudTokenPart"
  });
  return normalizedNamespace.replace(/-/g, "_");
}

function resolveCrudActionIdPrefix(namespace = "") {
  const tokenPart = resolveCrudTokenPart(namespace);
  return `crud.${tokenPart}`;
}

function resolveCrudContributorId(namespace = "") {
  const tokenPart = resolveCrudTokenPart(namespace);
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
  const namespace = requireCrudNamespace(settings.namespace, {
    context: "resolveCrudConfig"
  });
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
      throw new Error(`Duplicate CRUD namespace in config.modules: "${resolved.namespace}".`);
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
    const normalizedNamespace = requireCrudNamespace(options.namespace, {
      context: "resolveCrudConfigFromModules"
    });
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
  requireCrudNamespace,
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
