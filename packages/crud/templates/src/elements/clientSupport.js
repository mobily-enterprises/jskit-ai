import { createCrudClientSupport } from "@jskit-ai/crud-core/client/composables/createCrudClientSupport";
import { crudResource } from "../shared/crudResource.js";
import { crudModuleConfig } from "../shared/moduleConfig.js";

const crudClientSupport = createCrudClientSupport(crudModuleConfig);

const {
  crudConfig,
  useCrudClientContext,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId
} = crudClientSupport;

export {
  crudResource,
  crudConfig,
  useCrudClientContext,
  crudListQueryKey,
  crudViewQueryKey,
  toRouteRecordId
};
