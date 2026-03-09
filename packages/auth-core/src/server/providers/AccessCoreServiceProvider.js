import * as authConstraints from "../../shared/authConstraints.js";
import * as authMethods from "../../shared/authMethods.js";
import * as oauthProviders from "../../shared/oauthProviders.js";
import * as oauthCallbackParams from "../../shared/oauthCallbackParams.js";
import * as membershipAccess from "../membershipAccess.js";
import * as inviteTokens from "../inviteTokens.js";
import * as utils from "../utils.js";
import * as validators from "../validators.js";

const ACCESS_CORE_API = Object.freeze({
  authConstraints,
  authMethods,
  oauthProviders,
  oauthCallbackParams,
  membershipAccess,
  inviteTokens,
  utils,
  validators
});

class AccessCoreServiceProvider {
  static id = "auth.access";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("AccessCoreServiceProvider requires application singleton().");
    }

    app.singleton("auth.access", () => ACCESS_CORE_API);
  }

  boot() {}
}

export { AccessCoreServiceProvider };
