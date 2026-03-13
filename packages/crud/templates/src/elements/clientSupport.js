import { createCrudClientSupport } from "@jskit-ai/crud-core/client/composables/createCrudClientSupport";
import { crudResource } from "../shared/crudResource.js";

const CRUD_NAMESPACE = "${option:namespace|snake|default(crud)}";
const CRUD_ROUTE_SEGMENT = "${option:namespace|kebab|default(crud)}";
const CRUD_DIRECTORY_PREFIX = "${option:directory-prefix|path}";
const CRUD_RELATIVE_PATH = CRUD_DIRECTORY_PREFIX
  ? `/${CRUD_DIRECTORY_PREFIX}/${CRUD_ROUTE_SEGMENT}`
  : `/${CRUD_ROUTE_SEGMENT}`;

const crudClientSupport = createCrudClientSupport({
  namespace: CRUD_NAMESPACE,
  visibility: "${option:visibility}",
  relativePath: CRUD_RELATIVE_PATH
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
