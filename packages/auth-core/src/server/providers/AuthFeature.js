import { defineFeature } from "@jskit-ai/kernel/server/features";
import { buildAuthActions } from "../actions/auth.contributor.js";

const AuthFeature = defineFeature({
  id: "auth.actions",
  domain: "auth",
  optional: {
    authService: "auth.service"
  },
  actions({ authService }) {
    return authService ? buildAuthActions({ authService }) : [];
  }
});

export { AuthFeature };
