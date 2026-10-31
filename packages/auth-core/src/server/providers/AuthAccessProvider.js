import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createAuthAccess } from "../authAccess.js";

const AuthAccessProvider = defineProvider({
  id: "auth.access",
  provides: {
    access: "auth.access"
  },
  setup() {
    return { access: createAuthAccess() };
  }
});

export { AuthAccessProvider };
