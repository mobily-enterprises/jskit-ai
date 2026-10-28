import { resolveBootstrapErrorStatusCode } from "@jskit-ai/shell-web/client/bootstrap";
import { resolvePlacementUserFromBootstrapPayload } from "../lib/bootstrap.js";
import { resolveBootstrapAccountLocale, setAccountLocale } from "../lib/accountLocale.js";

function createUsersBootstrapUserHandler() {
  return Object.freeze({
    handlerId: "users.web.bootstrap.user",
    order: 50,
    applyBootstrapPayload({ payload = {}, placementRuntime, source } = {}) {
      setAccountLocale(resolveBootstrapAccountLocale(payload));
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
      if (resolveBootstrapErrorStatusCode(error) !== 401) {
        return;
      }
      setAccountLocale("");
      if (!placementRuntime || typeof placementRuntime.setContext !== "function") {
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

export { createUsersBootstrapUserHandler };
