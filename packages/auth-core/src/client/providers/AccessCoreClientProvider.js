import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createApi as createAuthApi } from "../authApi.js";
import { runAuthSignOutFlow } from "../signOutFlow.js";

const CLIENT_API = Object.freeze({
  createAuthApi,
  runAuthSignOutFlow
});

const AccessCoreClientProvider = defineProvider({
  id: "auth.access.client",
  provides: {
    auth: "auth.access.client"
  },
  setup() {
    return {
      auth: CLIENT_API
    };
  }
});

export { AccessCoreClientProvider };
