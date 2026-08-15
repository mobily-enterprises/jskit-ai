import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createUsersExtensions } from "./usersExtensions.js";

const UsersExtensionsProvider = defineProvider({
  id: "users.extensions",
  provides: {
    extensions: "users.extensions"
  },
  setup() {
    return { extensions: createUsersExtensions() };
  }
});

export { UsersExtensionsProvider };
