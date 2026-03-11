import { computed } from "vue";
import { useRoute } from "vue-router";
import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveShellLinkPath } from "@jskit-ai/shell-web/client/navigation/linkResolver";
import { useUsersWebWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useUsersWebWorkspaceRouteContext";
import {
  isWorkspaceVisibility,
  normalizeContactsNamespace,
  normalizeContactsVisibility,
  resolveContactsRelativePath
} from "../../shared/contacts/contactsModuleConfig.js";
import { contactsResource } from "../../shared/contacts/contactsResource.js";

function resolveContactsClientConfig(source = {}) {
  const namespace = normalizeContactsNamespace(source?.namespace);
  const visibility = normalizeContactsVisibility(source?.visibility);

  return Object.freeze({
    namespace,
    visibility,
    workspaceScoped: isWorkspaceVisibility(visibility),
    relativePath: resolveContactsRelativePath(namespace)
  });
}

function resolveContactsClientConfigFromPublicConfig() {
  const appConfig = getClientAppConfig();
  return resolveContactsClientConfig(appConfig?.crud?.contacts);
}

function useContactsClientContext() {
  const route = useRoute();
  const routeContext = useUsersWebWorkspaceRouteContext();
  const contactsConfig = resolveContactsClientConfigFromPublicConfig();
  const placementContext = routeContext.placementContext;
  const workspaceSlugFromRoute = computed(() =>
    contactsConfig.workspaceScoped ? routeContext.workspaceSlugFromRoute.value : ""
  );
  const queryWorkspaceSlug = computed(() => workspaceSlugFromRoute.value);
  const listPath = computed(() =>
    resolveAdminContactsListPath(placementContext.value, workspaceSlugFromRoute.value, contactsConfig)
  );
  const createPath = computed(() =>
    resolveAdminContactNewPath(placementContext.value, workspaceSlugFromRoute.value, contactsConfig)
  );

  function listQueryKey(surfaceId = "") {
    return contactsListQueryKey(surfaceId, queryWorkspaceSlug.value, contactsConfig.namespace);
  }

  function viewQueryKey(surfaceId = "", contactId = 0) {
    return contactViewQueryKey(surfaceId, queryWorkspaceSlug.value, contactId, contactsConfig.namespace);
  }

  function resolveViewPath(contactIdLike) {
    return resolveAdminContactViewPath(
      contactIdLike,
      placementContext.value,
      workspaceSlugFromRoute.value,
      contactsConfig
    );
  }

  function resolveEditPath(contactIdLike) {
    return resolveAdminContactEditPath(
      contactIdLike,
      placementContext.value,
      workspaceSlugFromRoute.value,
      contactsConfig
    );
  }

  return Object.freeze({
    route,
    contactsConfig,
    placementContext,
    workspaceSlugFromRoute,
    listPath,
    createPath,
    listQueryKey,
    viewQueryKey,
    resolveViewPath,
    resolveEditPath
  });
}

function contactsListQueryKey(surfaceId = "", workspaceSlug = "", namespace = "") {
  return [
    "crud",
    "contacts",
    normalizeQueryToken(namespace),
    "list",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug)
  ];
}

function contactViewQueryKey(surfaceId = "", workspaceSlug = "", contactId = 0, namespace = "") {
  return [
    "crud",
    "contacts",
    normalizeQueryToken(namespace),
    "view",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug),
    Number(contactId) || 0
  ];
}

function resolveAdminContactsListPath(context = null, workspaceSlug = "", source = {}) {
  const config = resolveContactsClientConfig(source);
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: config.relativePath,
    mode: "auto"
  });
}

function resolveAdminContactNewPath(context = null, workspaceSlug = "", source = {}) {
  const config = resolveContactsClientConfig(source);
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: `${config.relativePath}/new`,
    mode: "auto"
  });
}

function resolveAdminContactViewPath(contactIdLike, context = null, workspaceSlug = "", source = {}) {
  const contactId = Number(contactIdLike);
  if (!Number.isInteger(contactId) || contactId < 1) {
    return "";
  }

  const config = resolveContactsClientConfig(source);
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: `${config.relativePath}/${contactId}`,
    mode: "auto"
  });
}

function resolveAdminContactEditPath(contactIdLike, context = null, workspaceSlug = "", source = {}) {
  const contactId = Number(contactIdLike);
  if (!Number.isInteger(contactId) || contactId < 1) {
    return "";
  }

  const config = resolveContactsClientConfig(source);
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug: config.workspaceScoped ? workspaceSlug : "",
    relativePath: `${config.relativePath}/${contactId}/edit`,
    mode: "auto"
  });
}

function toRouteContactId(value) {
  if (Array.isArray(value)) {
    return toRouteContactId(value[0]);
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export {
  contactsResource,
  resolveContactsClientConfig,
  resolveContactsClientConfigFromPublicConfig,
  useContactsClientContext,
  contactsListQueryKey,
  contactViewQueryKey,
  resolveAdminContactsListPath,
  resolveAdminContactNewPath,
  resolveAdminContactViewPath,
  resolveAdminContactEditPath,
  toRouteContactId
};
