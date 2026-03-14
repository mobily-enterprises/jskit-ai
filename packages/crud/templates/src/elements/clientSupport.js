import { createCrudClientSupport } from "@jskit-ai/crud-core/client/composables/createCrudClientSupport";
import { crudResource } from "../shared/crudResource.js";

const crudClientSupport = createCrudClientSupport({
  namespace: "${option:namespace|snake|default(crud)}",
  visibility: "${option:visibility}",
  relativePath: "/${option:directory-prefix|pathprefix}${option:namespace|kebab|default(crud)}"
});

const {
  crudConfig,
  useCrudClientContext,
  crudListQueryKey,
  crudViewQueryKey,
  resolveAdminCrudListPath,
  resolveAdminCrudNewPath,
  resolveAdminCrudViewPath,
  resolveAdminCrudEditPath,
  toRouteRecordId
} = crudClientSupport;

export {
  crudResource,
  crudConfig,
  useCrudClientContext,
  crudListQueryKey,
  crudViewQueryKey,
  resolveAdminCrudListPath,
  resolveAdminCrudNewPath,
  resolveAdminCrudViewPath,
  resolveAdminCrudEditPath,
  toRouteRecordId
};
