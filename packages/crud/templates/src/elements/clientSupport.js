import { createCrudClientSupport } from "@jskit-ai/crud-core/client/composables/createCrudClientSupport";
import { crudResource } from "../shared/crudResource.js";
import { crudModuleConfig } from "../shared/moduleConfig.js";

const crudClientSupport = createCrudClientSupport(crudModuleConfig);

const {
  useCrudClientContext,
  toRouteRecordId
} = crudClientSupport;

export {
  crudResource,
  useCrudClientContext,
  toRouteRecordId
};
