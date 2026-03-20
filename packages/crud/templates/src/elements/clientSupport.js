import { createCrudClientSupport } from "@jskit-ai/crud-core/client";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { crudResource } from "../shared/${option:namespace|singular|camel}Resource.js";
import {
  crudModuleConfig,
  resolveCrudModulePolicyFromPlacementContext
} from "../shared/moduleConfig.js";

const crudClientSupport = createCrudClientSupport(crudModuleConfig);

const {
  useCrudClientContext,
  useCrudListRuntime,
  useCrudCreateRuntime,
  useCrudRecordRuntime,
  toRouteRecordId
} = crudClientSupport;

function useCrudModulePolicyRuntime() {
  const paths = usePaths();
  const modulePolicy = resolveCrudModulePolicyFromPlacementContext(paths.placementContext.value, {
    moduleConfig: crudModuleConfig,
    context: "crud client runtime"
  });

  return Object.freeze({
    modulePolicy,
    visibility: modulePolicy.visibility
  });
}

export {
  crudResource,
  useCrudModulePolicyRuntime,
  useCrudClientContext,
  useCrudListRuntime,
  useCrudCreateRuntime,
  useCrudRecordRuntime,
  toRouteRecordId
};
