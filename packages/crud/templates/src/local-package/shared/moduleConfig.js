import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";

const DEFAULT_VISIBILITY = "workspace";
const RAW_NAMESPACE = "${option:namespace|kebab}";
const RAW_VISIBILITY = "${option:visibility}";

function normalizeCrudNamespace(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isWorkspaceVisibility(visibility) {
  return visibility === "workspace" || visibility === "workspace_user";
}

function resolveTokenPart(namespace = "") {
  return namespace ? namespace.replace(/-/g, "_") : "";
}

const namespace = normalizeCrudNamespace(RAW_NAMESPACE);
const visibility = normalizeRouteVisibility(RAW_VISIBILITY, {
  fallback: DEFAULT_VISIBILITY
});
const workspaceScoped = isWorkspaceVisibility(visibility);
const relativePath = namespace ? `/${namespace}` : "/crud";
const apiBasePath = workspaceScoped ? `/api/w/:workspaceSlug/workspace${relativePath}` : `/api${relativePath}`;
const tableName = namespace ? `crud_${namespace.replace(/-/g, "_")}` : "crud";
const tokenPart = resolveTokenPart(namespace);
const actionIdPrefix = tokenPart ? `crud.${tokenPart}` : "crud";
const contributorId = tokenPart ? `crud.${tokenPart}` : "crud";
const repositoryToken = tokenPart ? `crud.${tokenPart}.repository` : "crud.repository";
const serviceToken = tokenPart ? `crud.${tokenPart}.service` : "crud.service";
const actionDefinitionsToken = tokenPart ? `crud.${tokenPart}.actionDefinitions` : "crud.actionDefinitions";

const crudModuleConfig = Object.freeze({
  namespace,
  visibility,
  workspaceScoped,
  relativePath,
  apiBasePath,
  tableName,
  actionIdPrefix,
  contributorId,
  domain: "crud",
  repositoryToken,
  serviceToken,
  actionDefinitionsToken
});

export {
  DEFAULT_VISIBILITY,
  normalizeCrudNamespace,
  isWorkspaceVisibility,
  crudModuleConfig
};
