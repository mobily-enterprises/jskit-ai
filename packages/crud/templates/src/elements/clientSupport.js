import { createCrudClientSupport } from "@jskit-ai/crud-core/client";
import { crudResource } from "../shared/crudResource.js";
import { crudModuleConfig } from "../shared/moduleConfig.js";

const crudClientSupport = createCrudClientSupport(crudModuleConfig);

const {
  useCrudClientContext,
  useCrudListRuntime,
  useCrudCreateRuntime,
  useCrudRecordRuntime,
  toRouteRecordId
} = crudClientSupport;

export {
  crudResource,
  useCrudClientContext,
  useCrudListRuntime,
  useCrudCreateRuntime,
  useCrudRecordRuntime,
  toRouteRecordId
};
