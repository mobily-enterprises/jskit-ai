import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createLocalDbBackend } from "../lib/dbBackend.js";

const AuthLocalDatabaseBackendProvider = defineProvider({
  id: "auth.local.database-backend",
  requires: {
    database: "runtime.database"
  },
  provides: {
    backend: "auth.local.backend"
  },
  setup({ database }) {
    return {
      backend: createLocalDbBackend({
        knex: database.knex,
        transactionManager: database.transactionManager
      })
    };
  }
});

export { AuthLocalDatabaseBackendProvider };
