import { getClientAppConfig } from "@jskit-ai/kernel/client";
import {
  createCrudClientSupport,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId
} from "@jskit-ai/crud-core/client/composables/createCrudClientSupport";
import {
  resolveCrudConfigFromModules,
  resolveCrudConfigsFromModules,
  resolveCrudConfig
} from "../shared/crud/crudModuleConfig.js";
import { crudResource } from "../shared/crud/crudResource.js";

function resolveCrudClientConfig(source = {}) {
  const resolved = resolveCrudConfig(source);
  return Object.freeze({
    namespace: resolved.namespace,
    visibility: resolved.visibility
  });
}

function resolveCrudClientConfigFromPublicConfig(options = {}) {
  const appConfig = getClientAppConfig();
  const resolved = resolveCrudConfigFromModules(appConfig?.modules, options);
  if (resolved) {
    return resolveCrudClientConfig(resolved);
  }

  const allCrudConfigs = resolveCrudConfigsFromModules(appConfig?.modules);
  if (Object.hasOwn(options, "namespace")) {
    const requestedNamespace = String(options.namespace || "");
    throw new Error(`Unable to resolve CRUD module config for namespace "${requestedNamespace}".`);
  }

  if (allCrudConfigs.length < 1) {
    throw new Error('Missing config.modules entry for module "crud".');
  }

  throw new Error("Multiple CRUD module configs found. Pass namespace explicitly.");
}

function useCrudClientContext(options = {}) {
  const crudConfig = resolveCrudClientConfigFromPublicConfig(options);
  return createCrudClientSupport(crudConfig).useCrudClientContext();
}

export {
  crudResource,
  resolveCrudClientConfig,
  resolveCrudClientConfigFromPublicConfig,
  useCrudClientContext,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId
};
