import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createLocalDbBackend, createLocalDbOwners } from "../lib/dbBackend.js";

const AuthLocalDatabaseBackendProvider = defineProvider({
  id: "auth.local.database-backend",
  requires: {
    database: "runtime.database"
  },
  provides: {
    backend: "auth.local.backend",
    accounts: "auth.local.accounts",
    sessions: "auth.local.sessions",
    recovery: "auth.local.recovery"
  },
  /**
   * @param {object} dependencies
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} dependencies.database
   */
  setup({ database }) {
    const owners = createLocalDbOwners({ knex: database.knex });
    return {
      backend: createLocalDbBackend({
        knex: database.knex,
        transactionManager: database.transactionManager
      }),
      accounts: owners.accounts,
      sessions: owners.sessions,
      recovery: owners.recovery
    };
  }
});

export { AuthLocalDatabaseBackendProvider };
