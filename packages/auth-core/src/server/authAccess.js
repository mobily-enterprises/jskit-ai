import * as authConstraints from "../shared/authConstraints.js";
import * as authMethods from "../shared/authMethods.js";
import * as oauthProviders from "../shared/oauthProviders.js";
import * as oauthCallbackParams from "../shared/oauthCallbackParams.js";
import * as membershipAccess from "./membershipAccess.js";
import * as inviteTokens from "./inviteTokens.js";
import * as utils from "./utils.js";
import * as validators from "./validators.js";

/** The auth helpers other packages reach through the `auth.access` capability. */
function createAuthAccess() {
  return Object.freeze({
    authConstraints,
    authMethods,
    oauthProviders,
    oauthCallbackParams,
    membershipAccess,
    inviteTokens,
    utils,
    validators
  });
}

export { createAuthAccess };
