import { redirect } from "@tanstack/vue-router";
import { resolveRuntimeState } from "./routerGuards.js";

function createGodRouteGuards(stores, options) {
  const loginPath = String(options?.loginPath || "/login");
  const rootPath = String(options?.rootPath || "/");

  async function beforeLoadAuthenticated() {
    const state = await resolveRuntimeState(stores);
    if (state.sessionUnavailable) {
      return;
    }

    if (!state.authenticated) {
      throw redirect({ to: loginPath });
    }
  }

  async function beforeLoadRoot() {
    return beforeLoadAuthenticated();
  }

  async function beforeLoadPublic() {
    const state = await resolveRuntimeState(stores);
    if (state.sessionUnavailable) {
      return;
    }

    if (state.authenticated) {
      throw redirect({ to: rootPath });
    }
  }

  return {
    beforeLoadRoot,
    beforeLoadPublic,
    beforeLoadAuthenticated
  };
}

export { createGodRouteGuards };
