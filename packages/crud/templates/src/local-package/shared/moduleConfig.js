import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { resolveUsersApiBasePath } from "@jskit-ai/users-core/shared/support/usersApiPaths";

const crudModuleConfig = Object.freeze({
  namespace: "${option:namespace|snake}",
  visibility: normalizeRouteVisibility("${option:visibility}", {
    fallback: "workspace"
  }),
  relativePath: "/${option:directory-prefix|pathprefix}${option:namespace|kebab}"
});

const crudRouteBasePath = resolveUsersApiBasePath({
  visibility: crudModuleConfig.visibility,
  relativePath: crudModuleConfig.relativePath
});

export { crudModuleConfig, crudRouteBasePath };
