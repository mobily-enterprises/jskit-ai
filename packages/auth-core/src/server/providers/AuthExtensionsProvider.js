import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createAuthExtensions } from "../authExtensions.js";

const AuthExtensionsProvider = defineProvider({
  id: "auth.extensions",
  provides: {
    extensions: "auth.extensions"
  },
  setup() {
    return { extensions: createAuthExtensions() };
  }
});

export { AuthExtensionsProvider };
