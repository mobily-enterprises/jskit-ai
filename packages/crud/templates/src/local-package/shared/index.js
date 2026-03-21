export { crudResource } from "./${option:namespace|singular|camel}Resource.js";
export {
  CRUD_MODULE_OWNERSHIP_FILTER_AUTO,
  crudModuleConfig,
  resolveCrudModulePolicy,
  resolveCrudModulePolicyFromAppConfig,
  resolveCrudModulePolicyFromPlacementContext
} from "./moduleConfig.js";
