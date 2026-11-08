import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { checkIncludedFields } from "./jsonApiModule/service.js";

/**
 * The CRUD contracts an application serves, one per namespace. Each CRUD
 * feature registers its contract during setup, and the registry is sealed at
 * boot. A contract never shapes another contract's answers: an included
 * record shows only what the including contract names (see the CRUD service).
 */
function createCrudContracts() {
  /** @type {import("./types.js").CrudContract[]} */
  const registered = [];
  let sealed = false;

  /**
   * Adds a served contract. One contract served on several surfaces registers once; two contracts under one namespace
   * are refused, since the namespace names one API.
   * @param {import("./types.js").CrudContract} crud
   */
  function register(crud) {
    if (sealed) {
      throw new Error(`CRUD contract "${crud.namespace}" registered after boot: CRUD features register their contracts during setup.`);
    }
    const same = registered.find((entry) => entry.namespace === crud.namespace);
    if (same && same !== crud) {
      throw new Error(`Two CRUD contracts are served under the namespace "${crud.namespace}". Give each contract its own namespace.`);
    }
    if (!same) {
      registered.push(crud);
    }
  }

  /**
   * Ends registration. Given the resource runtime's owned table resources by name, it first checks each contract's
   * includes against the tables they include (see checkIncludedFields): at boot every feature owns its tables.
   * @param {(name: string) => ({ name: string, schema: Record<string, any> } | null)} [tableResource]
   */
  function seal(tableResource) {
    if (tableResource) {
      for (const crud of registered) {
        checkIncludedFields(crud, tableResource);
      }
    }
    sealed = true;
  }

  return Object.freeze({
    register,
    seal
  });
}

const CrudContractsProvider = defineProvider({
  id: "crud.contracts",
  optional: {
    resources: "runtime.resources"
  },
  provides: {
    contracts: "crud.contracts"
  },
  setup: () => ({ contracts: createCrudContracts() }),
  /**
   * @param {{ resources?: import("@jskit-ai/resource-runtime/server/types").ResourceRuntime }} dependencies
   * @param {{ outputs: { contracts: ReturnType<typeof createCrudContracts> } }} context
   */
  boot({ resources }, { outputs }) {
    outputs.contracts.seal(resources?.tableResource);
  }
});

export { CrudContractsProvider, createCrudContracts };
