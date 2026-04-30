import {
  registerBootstrapPayloadHandler,
  resolveBootstrapErrorStatusCode
} from "@jskit-ai/shell-web/client/bootstrap";
import { resolvePlacementUserFromBootstrapPayload } from "../lib/bootstrap.js";

function createUsersBootstrapUserHandler() {
  return Object.freeze({
    handlerId: "users.web.bootstrap.user",
    order: 50,
    applyBootstrapPayload({ payload = {}, placementRuntime, source } = {}) {
      if (!placementRuntime || typeof placementRuntime.setContext !== "function") {
        return;
      }

      const context = placementRuntime.getContext?.() || {};
      placementRuntime.setContext(
        {
          user: resolvePlacementUserFromBootstrapPayload(payload, context?.user)
        },
        {
          source
        }
      );
    },
    handleBootstrapError({ error, placementRuntime, source } = {}) {
      if (!placementRuntime || typeof placementRuntime.setContext !== "function") {
        return;
      }
      if (resolveBootstrapErrorStatusCode(error) !== 401) {
        return;
      }

      placementRuntime.setContext(
        {
          user: null
        },
        {
          source
        }
      );
    }
  });
}

function registerUsersBootstrapPayloadHandlers(app) {
  registerBootstrapPayloadHandler(app, "users.web.bootstrap.user-handler", () => createUsersBootstrapUserHandler());
}

export {
  createUsersBootstrapUserHandler,
  registerUsersBootstrapPayloadHandlers
};
