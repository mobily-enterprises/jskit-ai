import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";

const DEFAULT_VISIBILITY = "workspace";

function normalizeContactsNamespace(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeContactsVisibility(value, { fallback = DEFAULT_VISIBILITY } = {}) {
  return normalizeRouteVisibility(value, { fallback });
}

function isWorkspaceVisibility(visibility) {
  return visibility === "workspace" || visibility === "workspace_user";
}

function resolveContactsNamespacePath(namespace = "") {
  const normalizedNamespace = normalizeContactsNamespace(namespace);
  return normalizedNamespace ? `/${normalizedNamespace}` : "";
}

function resolveContactsRelativePath(namespace = "") {
  const namespacePath = resolveContactsNamespacePath(namespace);
  return namespacePath || "/crud";
}

function resolveContactsApiBasePath({ namespace = "", visibility = DEFAULT_VISIBILITY } = {}) {
  const normalizedVisibility = normalizeContactsVisibility(visibility);
  const relativePath = resolveContactsRelativePath(namespace);

  if (isWorkspaceVisibility(normalizedVisibility)) {
    return `/api/w/:workspaceSlug/workspace${relativePath}`;
  }

  return `/api${relativePath}`;
}

function resolveContactsTableName(namespace = "") {
  const normalizedNamespace = normalizeContactsNamespace(namespace);
  if (!normalizedNamespace) {
    return "crud";
  }

  return `crud_${normalizedNamespace.replace(/-/g, "_")}`;
}

function resolveContactsTokenPart(namespace = "") {
  const normalizedNamespace = normalizeContactsNamespace(namespace);
  return normalizedNamespace ? normalizedNamespace.replace(/-/g, "_") : "";
}

function resolveContactsActionIdPrefix(namespace = "") {
  const tokenPart = resolveContactsTokenPart(namespace);
  if (!tokenPart) {
    return "crud";
  }

  return `crud.${tokenPart}`;
}

function resolveContactsContributorId(namespace = "") {
  const tokenPart = resolveContactsTokenPart(namespace);
  if (!tokenPart) {
    return "crud";
  }

  return `crud.${tokenPart}`;
}

function resolveContactsDomain(namespace = "") {
  return "contacts";
}

function resolveContactsToken(namespace = "", suffix = "") {
  const contributorId = resolveContactsContributorId(namespace);
  return suffix ? `${contributorId}.${suffix}` : contributorId;
}

function resolveContactsConfig(source = {}) {
  const settings = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const namespace = normalizeContactsNamespace(settings.namespace);
  const visibility = normalizeContactsVisibility(settings.visibility);

  return Object.freeze({
    namespace,
    visibility,
    workspaceScoped: isWorkspaceVisibility(visibility),
    namespacePath: resolveContactsNamespacePath(namespace),
    relativePath: resolveContactsRelativePath(namespace),
    apiBasePath: resolveContactsApiBasePath({ namespace, visibility }),
    tableName: resolveContactsTableName(namespace),
    actionIdPrefix: resolveContactsActionIdPrefix(namespace),
    contributorId: resolveContactsContributorId(namespace),
    domain: resolveContactsDomain(namespace),
    repositoryToken: resolveContactsToken(namespace, "repository"),
    serviceToken: resolveContactsToken(namespace, "service"),
    actionDefinitionsToken: resolveContactsToken(namespace, "actionDefinitions")
  });
}

export {
  DEFAULT_VISIBILITY,
  normalizeContactsNamespace,
  normalizeContactsVisibility,
  isWorkspaceVisibility,
  resolveContactsNamespacePath,
  resolveContactsRelativePath,
  resolveContactsApiBasePath,
  resolveContactsTableName,
  resolveContactsActionIdPrefix,
  resolveContactsContributorId,
  resolveContactsDomain,
  resolveContactsConfig
};
