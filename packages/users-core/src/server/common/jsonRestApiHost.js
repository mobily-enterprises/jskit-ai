import { Api } from "hooked-api";
import { RestApiPlugin, RestApiKnexPlugin } from "json-rest-api";
import { resource as userProfilesResource } from "./resources/userProfilesResource.js";
import { userSettingsResource } from "./resources/userSettingsResource.js";

const INTERNAL_JSON_REST_API = "internal.json-rest-api";

async function addResourceIfMissing(api, scopeName, resourceConfig) {
  if (api?.resources?.[scopeName]) {
    return api.resources[scopeName];
  }

  await api.addResource(scopeName, resourceConfig);
  return api.resources[scopeName];
}

async function createJsonRestApiHost({ knex }) {
  if (typeof knex !== "function") {
    throw new TypeError("createJsonRestApiHost requires knex.");
  }

  const api = new Api({
    name: "jskit-internal-json-rest-api",
    logLevel: "error"
  });

  await api.use(RestApiPlugin, {
    simplifiedApi: true,
    simplifiedTransport: false,
    returnRecordApi: {
      post: "full",
      put: "full",
      patch: "full"
    }
  });

  await api.use(RestApiKnexPlugin, { knex });
  await addResourceIfMissing(api, "userProfiles", userProfilesResource);
  await addResourceIfMissing(api, "userSettings", userSettingsResource);

  return api;
}

async function registerJsonRestApiHost(app) {
  if (
    !app ||
    typeof app.singleton !== "function" ||
    typeof app.make !== "function" ||
    typeof app.has !== "function"
  ) {
    throw new Error("registerJsonRestApiHost requires application singleton()/make()/has().");
  }

  if (app.has(INTERNAL_JSON_REST_API)) {
    return app.make(INTERNAL_JSON_REST_API);
  }

  app.singleton(INTERNAL_JSON_REST_API, async (scope) => {
    const knex = scope.make("jskit.database.knex");
    return createJsonRestApiHost({ knex });
  });

  return null;
}

export {
  INTERNAL_JSON_REST_API,
  addResourceIfMissing,
  createJsonRestApiHost,
  registerJsonRestApiHost
};
