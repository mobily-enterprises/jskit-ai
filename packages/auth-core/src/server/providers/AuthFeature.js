import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAuthActions } from "../actions/auth.contributor.js";

const AuthFeature = defineFeature({
  id: "auth.actions",
  domain: "auth",
  optional: {
    authService: "auth.service"
  },
  actions({ authService }) {
    return authService ? createAuthActions({ authService }) : [];
  }
});

export { AuthFeature };
