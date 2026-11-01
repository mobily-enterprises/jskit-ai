import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAuthActions } from "../actions/authActions.js";

// Without an auth provider installed there is no auth.service, so no auth actions.
const NO_AUTH_ACTIONS = Object.freeze([]);

const AuthFeature = defineFeature({
  id: "auth.actions",
  domain: "auth",
  optional: {
    authService: "auth.service"
  },
  actions({ authService }) {
    return authService ? createAuthActions({ authService }) : NO_AUTH_ACTIONS;
  }
});

export { AuthFeature };
