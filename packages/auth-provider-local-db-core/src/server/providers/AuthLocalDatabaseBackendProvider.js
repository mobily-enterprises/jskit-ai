import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createLocalDbBackend, createLocalDbOwners } from "../lib/dbBackend.js";
import { createIdentityStore } from "../lib/identityStore.js";
import { LOCAL_AUTH_RESOURCES } from "../lib/localAuthResources.js";

// Local sign-in's ids are text (generated ids, token hashes, and account emails, which local sign-in trims and lower-cases
// before they get here), so the handles take every id as a string and never as a number.
function textRecordId(value) {
  return value == null ? null : String(value);
}

const AuthLocalDatabaseBackendProvider = defineFeature({
  id: "auth.local.database-backend",
  owns: LOCAL_AUTH_RESOURCES.map((resource) => ({ resource, normalizeId: textRecordId })),
  requires: {
    // Only the identity links, whose composite key no table resource names, use the database itself.
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
   * @param {import("../lib/dbBackend.js").LocalAuthHandles} dependencies.resources
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} dependencies.database
   */
  setup({ resources, database }) {
    const identities = createIdentityStore({ database });
    const owners = createLocalDbOwners({ resources, identities });
    return {
      backend: createLocalDbBackend({ resources, identities }),
      accounts: owners.accounts,
      sessions: owners.sessions,
      recovery: owners.recovery
    };
  }
});

export { AuthLocalDatabaseBackendProvider };
