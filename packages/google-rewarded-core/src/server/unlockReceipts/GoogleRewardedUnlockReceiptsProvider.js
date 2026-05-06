import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { resolveCrudSurfacePolicyFromAppConfig } from "@jskit-ai/crud-core/server/crudModuleConfig";
import { createCrudJsonApiServiceEvents } from "@jskit-ai/crud-core/server/serviceEvents";
import {
  INTERNAL_JSON_REST_API,
  addResourceIfMissing,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { createRepository } from "./repository.js";
import { createService } from "./service.js";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { resource } from "../../shared/googleRewardedUnlockReceiptResource.js";
const CRUD_MODULE_CONFIG = Object.freeze({
  namespace: "google_rewarded_unlock_receipts",
  surface: "admin",
  ownershipFilter: "workspace_user",
  relativePath: "/google-rewarded-unlock-receipts"
});
const baseServiceEvents = createCrudJsonApiServiceEvents(CRUD_MODULE_CONFIG.namespace);
const serviceEvents = {
  ...baseServiceEvents
};

function resolveCrudPolicyFromApp(app) {
  return resolveCrudSurfacePolicyFromAppConfig(CRUD_MODULE_CONFIG, resolveAppConfig(app), {
    context: "GoogleRewardedUnlockReceiptsProvider"
  });
}

class GoogleRewardedUnlockReceiptsProvider {
  static id = "crud.google_rewarded_unlock_receipts";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "local.main", "json-rest-api.core"];

  register(app) {
    const crudPolicy = resolveCrudPolicyFromApp(app);

    app.singleton("repository.google_rewarded_unlock_receipts", (scope) => {
      const api = scope.make(INTERNAL_JSON_REST_API);
      const knex = scope.make("jskit.database.knex");
      return createRepository({
        api,
        knex
      });
    });

    app.service(
      "crud.google_rewarded_unlock_receipts",
      (scope) => {
        return createService({
          googleRewardedUnlockReceiptsRepository: scope.make("repository.google_rewarded_unlock_receipts")
        });
      },
      {
        events: serviceEvents
      }
    );

    app.actions(
      withActionDefaults(
        createActions({
          surface: crudPolicy.surfaceId
        }),
        {
          domain: "crud",
          dependencies: {
            googleRewardedUnlockReceiptsService: "crud.google_rewarded_unlock_receipts"
          }
        }
      )
    );
  }

  async boot(app) {
    const crudPolicy = resolveCrudPolicyFromApp(app);
    const api = app.make(INTERNAL_JSON_REST_API);
    await addResourceIfMissing(
      api,
      "googleRewardedUnlockReceipts",
      createJsonRestResourceScopeOptions(resource, {
        writeSerializers: {
          "datetime-utc": toDatabaseDateTimeUtc
        }
      })
    );
    registerRoutes(app, {
      routeOwnershipFilter: crudPolicy.ownershipFilter,
      routeSurface: crudPolicy.surfaceId,
      routeSurfaceRequiresWorkspace: crudPolicy.surfaceDefinition.requiresWorkspace === true,
      routeRelativePath: crudPolicy.relativePath
    });
  }
}

export { GoogleRewardedUnlockReceiptsProvider };
