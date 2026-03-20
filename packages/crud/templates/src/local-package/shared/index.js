export { crudResource } from "./${option:namespace|singular|camel}Resource.js";
export {
  CRUD_MODULE_VISIBILITY_AUTO,
  crudModuleConfig,
  resolveCrudModulePolicy,
  resolveCrudModulePolicyFromAppConfig,
  resolveCrudModulePolicyFromPlacementContext
} from "./moduleConfig.js";
