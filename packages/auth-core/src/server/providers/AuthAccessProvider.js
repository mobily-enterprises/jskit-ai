import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import * as authConstraints from "../../shared/authConstraints.js";
import * as authMethods from "../../shared/authMethods.js";
import * as oauthProviders from "../../shared/oauthProviders.js";
import * as oauthCallbackParams from "../../shared/oauthCallbackParams.js";
import * as membershipAccess from "../membershipAccess.js";
import * as inviteTokens from "../inviteTokens.js";
import * as utils from "../utils.js";
import * as validators from "../validators.js";

const access = Object.freeze({
  authConstraints,
  authMethods,
  oauthProviders,
  oauthCallbackParams,
  membershipAccess,
  inviteTokens,
  utils,
  validators
});

const AuthAccessProvider = defineProvider({
  id: "auth.access",
  provides: {
    access: "auth.access"
  },
  setup() {
    return { access };
  }
});

export { AuthAccessProvider };
