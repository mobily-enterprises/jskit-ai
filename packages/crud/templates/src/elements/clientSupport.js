import { createCrudClientSupport } from "@jskit-ai/crud-core/client/composables/createCrudClientSupport";
import { crudResource } from "../shared/crudResource.js";

const crudClientSupport = createCrudClientSupport({
  namespace: "${option:namespace|snake}",
  visibility: "${option:visibility}",
  relativePath: "/${option:directory-prefix|pathprefix}${option:namespace|kebab}"
});

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
