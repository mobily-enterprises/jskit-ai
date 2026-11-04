import { resolveBootstrapErrorStatusCode } from "@jskit-ai/shell-web/client/bootstrap";
import { resolvePlacementUserFromBootstrapPayload } from "../lib/bootstrap.js";
import { resolveBootstrapAccountLocale, setAccountLocale } from "../lib/accountLocale.js";

function createUsersBootstrapUserHandler() {
  /** @param {import("../types.js").UsersBootstrapContext} context */
  function applyBootstrapPayload({ payload = {}, placementRuntime, source }) {
    setAccountLocale(resolveBootstrapAccountLocale(payload));
    const context = placementRuntime.getContext();
    placementRuntime.setContext(
      {
        user: resolvePlacementUserFromBootstrapPayload(payload, context.user)
      },
      {
        source
      }
    );
  }

  /** @param {import("../types.js").UsersBootstrapContext} context */
  function handleBootstrapError({ error, placementRuntime, source }) {
    if (resolveBootstrapErrorStatusCode(error) !== 401) {
      return;
    }
    setAccountLocale("");
    placementRuntime.setContext(
      {
        user: null
      },
      {
        source
      }
    );
  }

  return Object.freeze({
    handlerId: "users.web.bootstrap.user",
    order: 50,
    applyBootstrapPayload,
    handleBootstrapError
  });
}

export { createUsersBootstrapUserHandler };
