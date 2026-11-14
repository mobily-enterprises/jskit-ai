import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAuthActions } from "../actions/authActions.js";
import { createEmailChangeActions } from "../actions/emailChangeActions.js";
import { createSecondFactorActions } from "../actions/secondFactorActions.js";

// Without an auth provider installed there is no auth.service, so no auth actions.
const NO_AUTH_ACTIONS = Object.freeze([]);

const AuthFeature = defineFeature({
  id: "auth.actions",
  domain: "auth",
  optional: {
    authService: "auth.service"
  },
  actions({ authService }) {
    return authService
      ? Object.freeze([
        ...createAuthActions({ authService }),
        ...createSecondFactorActions({ authService }),
        ...createEmailChangeActions({ authService })
      ])
      : NO_AUTH_ACTIONS;
  }
});

export { AuthFeature };
